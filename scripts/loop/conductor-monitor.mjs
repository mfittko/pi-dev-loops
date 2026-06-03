#!/usr/bin/env node
import { runChild, requireOptionValue } from "../_cli-primitives.mjs";
import { buildParseError, formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { autoDetectSnapshot } from "./detect-copilot-loop-state.mjs";
import { interpretLoopState, summarizeLoopInterpretation } from "@pi-dev-loops/core/loop/copilot-loop-state";

const USAGE = `Usage: conductor-monitor.mjs --repo <owner/name>

Aggregate Copilot-loop status across all open PRs in one repo.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)

Success output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/repo",
    "checkedAt": "...",
    "prCount": 2,
    "queueStatus": "queue_complete"|"monitoring"|"attention_needed",
    "needsAttentionCount": 1,
    "summary": {
      "waiting": 1,
      "needsAttention": 1,
      "blocked": 0,
      "done": 0
    },
    "prs": [
      {
        "number": 17,
        "title": "...",
        "url": "...",
        "isDraft": false,
        "headRefName": "...",
        "authorLogin": "...",
        "state": "waiting_for_copilot_review",
        "nextAction": "...",
        "loopDisposition": "pending",
        "terminal": false,
        "needsAttention": false,
        "snapshot": {
          "ciStatus": "none",
          "copilotReviewRequestStatus": "requested",
          "copilotReviewOnCurrentHead": false,
          "unresolvedThreadCount": 0,
          "actionableThreadCount": 0,
          "copilotReviewRoundCount": 0
        }
      }
    ]
  }

Queue status values:
  queue_complete   No open PRs remain in the repo queue
  monitoring       Open PRs exist, but all are in healthy wait states
  attention_needed At least one open PR needs human-in-the-loop follow-up

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }

Exit codes:
  0  Success
  1  Argument error, gh failure, or indeterminate PR status`.trim();

const parseError = buildParseError(USAGE);

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", parseError).trim();
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined) {
    throw parseError("conductor-monitor requires --repo <owner/name>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

async function listOpenPrs({ repo }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--json",
      "number,title,url,isDraft,headRefName,author",
    ],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  const payload = parseJsonText(result.stdout);
  const prs = Array.isArray(payload) ? payload : [];

  return prs
    .map((pr) => ({
      number: Number.isInteger(pr?.number) ? pr.number : null,
      title: typeof pr?.title === "string" ? pr.title : "",
      url: typeof pr?.url === "string" ? pr.url : null,
      isDraft: Boolean(pr?.isDraft),
      headRefName: typeof pr?.headRefName === "string" ? pr.headRefName : null,
      authorLogin: typeof pr?.author?.login === "string" ? pr.author.login : null,
    }))
    .filter((pr) => pr.number !== null)
    .sort((left, right) => left.number - right.number);
}

function summarizePrDisposition(loopDisposition) {
  switch (loopDisposition) {
    case "pending":
      return { bucket: "waiting", needsAttention: false };
    case "blocked":
      return { bucket: "blocked", needsAttention: true };
    case "done":
      return { bucket: "done", needsAttention: false };
    case "unresolved_feedback":
    case "clean_converged":
    case "action_required":
      return { bucket: "needsAttention", needsAttention: true };
    default:
      return { bucket: "needsAttention", needsAttention: true };
  }
}

function buildPrReport(pr, interpretation, interpretationSummary, snapshot) {
  const disposition = summarizePrDisposition(interpretationSummary.loopDisposition);

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    headRefName: pr.headRefName,
    authorLogin: pr.authorLogin,
    state: interpretation.state,
    nextAction: interpretation.nextAction,
    loopDisposition: interpretationSummary.loopDisposition,
    terminal: interpretationSummary.terminal,
    needsAttention: disposition.needsAttention,
    bucket: disposition.bucket,
    snapshot: {
      ciStatus: snapshot.ciStatus,
      copilotReviewRequestStatus: snapshot.copilotReviewRequestStatus,
      copilotReviewOnCurrentHead: snapshot.copilotReviewOnCurrentHead,
      unresolvedThreadCount: snapshot.unresolvedThreadCount,
      actionableThreadCount: snapshot.actionableThreadCount,
      copilotReviewRoundCount: snapshot.copilotReviewRoundCount,
    },
  };
}

export async function runConductorMonitor({ repo }, { env = process.env, ghCommand = "gh" } = {}) {
  const prs = await listOpenPrs({ repo }, { env, ghCommand });

  if (prs.length === 0) {
    return {
      ok: true,
      repo,
      checkedAt: new Date().toISOString(),
      prCount: 0,
      queueStatus: "queue_complete",
      needsAttentionCount: 0,
      summary: {
        waiting: 0,
        needsAttention: 0,
        blocked: 0,
        done: 0,
      },
      prs: [],
    };
  }

  const reports = [];
  for (const pr of prs) {
    const snapshot = await autoDetectSnapshot({ repo, pr: pr.number }, { env, ghCommand });
    const interpretation = interpretLoopState(snapshot);
    const interpretationSummary = summarizeLoopInterpretation(interpretation);
    reports.push(buildPrReport(pr, interpretation, interpretationSummary, snapshot));
  }

  const summary = reports.reduce((accumulator, pr) => {
    accumulator[pr.bucket] += 1;
    return accumulator;
  }, {
    waiting: 0,
    needsAttention: 0,
    blocked: 0,
    done: 0,
  });

  const needsAttentionCount = summary.needsAttention + summary.blocked;
  const queueStatus = needsAttentionCount > 0 ? "attention_needed" : "monitoring";

  return {
    ok: true,
    repo,
    checkedAt: new Date().toISOString(),
    prCount: reports.length,
    queueStatus,
    needsAttentionCount,
    summary,
    prs: reports.map(({ bucket, ...pr }) => pr),
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, env = process.env, ghCommand = "gh" } = {},
) {
  const options = parseCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runConductorMonitor(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

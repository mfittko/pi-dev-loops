#!/usr/bin/env node
import {
  formatCliError,
  isCopilotLogin,
  isDirectCliRun,
  parseJsonText,
  parseReviewThreads,
  summarizeCopilotReviews,
} from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";
import { buildSnapshotFromPrFacts, interpretLoopState, summarizeLoopInterpretation } from "../../packages/core/src/loop/copilot-loop-state.mjs";
import { evaluatePrGateCoordination } from "../../packages/core/src/loop/pr-gate-coordination.mjs";
import { fetchGithubReviewThreadsPayload } from "../github/capture-review-threads.mjs";
import { detectGateReviewEvidence } from "../github/detect-gate-review-evidence.mjs";

const USAGE = `Usage: detect-pr-gate-coordination-state.mjs --repo <owner/name> --pr <number>

Determine which PR gate/transition is legal next for a pull request.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/repo",
    "pr": 266,
    "currentHeadSha": "...",
    "lifecycleState": "pr_ready_no_feedback",
    "loopDisposition": "action_required",
    "gateBoundary": "post_draft_external_review",
    "draftGate": {
      "visible": true,
      "currentHead": false,
      "contractComplete": false,
      "currentHeadClean": false,
      "headSha": "c94679e",
      "verdict": "clean"
    },
    "preApprovalGate": {
      "visible": false,
      "currentHead": false,
      "contractComplete": false,
      "currentHeadClean": false,
      "headSha": null,
      "verdict": null
    },
    "allowedNextActions": ["request_copilot_review"],
    "forbiddenActions": ["run_pre_approval_gate", "declare_merge_ready"],
    "nextAction": "request_copilot_review",
    "reason": "..."
  }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or gh/runtime failure`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

export function parseDetectPrGateCoordinationCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
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

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr", parseError), parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("detect-pr-gate-coordination-state requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

function parseRequestedReviewersPayload(text) {
  const payload = parseJsonText(text, { label: "gh requested reviewers" });
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return {
    requested: users.some((user) => isCopilotLogin(user?.login)),
  };
}

async function fetchRequestedReviewers({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseRequestedReviewersPayload(result.stdout);
}

async function fetchPrFacts({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseJsonText(result.stdout, { label: "gh pr view" });
}

export async function detectPrGateCoordinationState(options, runtime = {}) {
  const prData = await fetchPrFacts(options, runtime);
  const requestedReviewers = await fetchRequestedReviewers(options, runtime);
  const threadsPayload = await fetchGithubReviewThreadsPayload(options, runtime);
  const parsedThreads = parseReviewThreads(threadsPayload);
  const gateEvidence = await detectGateReviewEvidence(options, runtime);

  const currentHeadSha = typeof prData?.headRefOid === "string" && prData.headRefOid.trim().length > 0
    ? prData.headRefOid.trim()
    : null;
  if (!currentHeadSha) {
    throw new Error("Invalid gh pr view payload: missing headRefOid");
  }

  const reviewSummary = summarizeCopilotReviews(prData?.reviews, { headSha: currentHeadSha });
  const reviewRequestStatus = requestedReviewers.requested
    ? "requested"
    : (reviewSummary.hasPendingReviewOnCurrentHead ? "already-requested" : "none");

  const snapshot = buildSnapshotFromPrFacts({
    prData,
    prNumber: options.pr,
    copilotReviewRequestStatus: reviewRequestStatus,
    copilotReviewPresent: reviewSummary.copilotReviewPresent,
    copilotReviewOnCurrentHead: reviewSummary.hasSubmittedReviewOnCurrentHead,
    unresolvedThreadCount: parsedThreads.summary.unresolvedThreads,
    actionableThreadCount: parsedThreads.summary.actionableThreads,
  });

  const interpretation = interpretLoopState(snapshot);
  const disposition = summarizeLoopInterpretation(interpretation);

  return evaluatePrGateCoordination({
    repo: options.repo,
    pr: options.pr,
    currentHeadSha,
    prDraft: Boolean(prData?.isDraft),
    prClosed: String(prData?.state || "").toUpperCase() === "CLOSED",
    prMerged: String(prData?.state || "").toUpperCase() === "MERGED",
    lifecycleState: interpretation.state,
    loopDisposition: disposition.loopDisposition,
    sameHeadCleanConverged: interpretation.sameHeadCleanConverged,
    draftGate: gateEvidence.draftGate,
    draftGateMarker: gateEvidence.draftGateMarker,
    preApprovalGate: gateEvidence.preApprovalGate,
    preApprovalGateMarker: gateEvidence.preApprovalGateMarker,
  });
}

async function main() {
  let options;
  try {
    options = parseDetectPrGateCoordinationCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  try {
    const result = await detectPrGateCoordinationState(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  main();
}

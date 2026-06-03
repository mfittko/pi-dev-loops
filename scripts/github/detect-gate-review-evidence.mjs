#!/usr/bin/env node
import {
  buildParseError,
  formatCliError,
  isDirectCliRun,
  parseJsonText,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";

const USAGE = `Usage: detect-gate-review-evidence.mjs --repo <owner/name> --pr <number>

Fetch the live PR head SHA and visible PR issue comments, then summarize the
latest valid draft-gate and pre-approval gate-review comments. Always fail
closed (exit 1) unless both required gate comments exist: a clean draft_gate
comment for the one-time draft boundary and a clean current-head
pre_approval_gate comment.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Output (stdout, JSON; always includes preMergeGateCheck):
  {
    "ok": true,
    "repo": "owner/repo",
    "pr": 17,
    "currentHeadSha": "abc1234",
    "draftGate": {
      "visible": true,
      "headSha": "abc1234",
      "verdict": "clean",
      "findingsSummary": "no issues found",
      "nextAction": "mark ready for review",
      "commentId": 101,
      "commentUrl": "https://github.com/owner/repo/pull/17#issuecomment-101",
      "updatedAt": "2026-05-29T22:00:00Z"
    },
    "draftGateMarker": {
      "visible": true,
      "headSha": "abc1234",
      "verdict": "clean",
      "findingsSummary": "no issues found",
      "nextAction": "mark ready for review",
      "contractComplete": true,
      "commentId": 101,
      "commentUrl": "https://github.com/owner/repo/pull/17#issuecomment-101",
      "updatedAt": "2026-05-29T22:00:00Z"
    },
    "draftGateSatisfied": true,
    "preApprovalGate": {
      "visible": false,
      "headSha": null,
      "verdict": null,
      "findingsSummary": null,
      "nextAction": null,
      "commentId": null,
      "commentUrl": null,
      "updatedAt": null
    },
    "preMergeGateCheck": {
      "ok": true,
      "failures": []
    }
  }

When --require-before-merge is omitted, the same evidence summary is emitted without preMergeGateCheck.

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success (gate evidence is valid)
  1  Argument error, gh failure, malformed gh JSON, or missing required pre-merge gate evidence`.trim();

const parseError = buildParseError(USAGE);


export function parseDetectGateReviewEvidenceCliArgs(argv) {
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

    if (token === "--require-before-merge") {
      throw parseError(`--require-before-merge has been removed: gate evidence enforcement is now always-on by default. Omit the flag.`);
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("detect-gate-review-evidence requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }
  return parseJsonText(result.stdout, { label: `gh ${args.slice(0, 2).join(" ")}` });
}

function normalizeIssueCommentsPayload(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid gh issue comments payload: expected an array");
  }

  if (payload.every((entry) => Array.isArray(entry))) {
    return payload.flat();
  }

  return payload;
}

function emptyGateSummary() {
  return {
    visible: false,
    headSha: null,
    verdict: null,
    findingsSummary: null,
    nextAction: null,
    commentId: null,
    commentUrl: null,
    updatedAt: null,
  };
}

function normalizeGateSummary(summary) {
  if (!summary) {
    return emptyGateSummary();
  }

  return {
    visible: true,
    headSha: summary.headSha,
    verdict: summary.verdict,
    findingsSummary: summary.findingsSummary,
    nextAction: summary.nextAction,
    commentId: summary.commentId,
    commentUrl: summary.commentUrl,
    updatedAt: summary.updatedAt,
  };
}

function emptyGateMarkerSummary() {
  return {
    visible: false,
    headSha: null,
    verdict: null,
    findingsSummary: null,
    nextAction: null,
    contractComplete: false,
    commentId: null,
    commentUrl: null,
    updatedAt: null,
  };
}

function normalizeGateMarkerSummary(summary) {
  if (!summary) {
    return emptyGateMarkerSummary();
  }

  return {
    visible: true,
    headSha: summary.headSha,
    verdict: summary.verdict,
    findingsSummary: summary.findingsSummary,
    nextAction: summary.nextAction,
    contractComplete: summary.contractComplete === true,
    commentId: summary.commentId,
    commentUrl: summary.commentUrl,
    updatedAt: summary.updatedAt,
  };
}

function buildPreMergeGateCheck(evidence) {
  const failures = [];

  if (!(evidence.draftGate.visible && evidence.draftGate.verdict === "clean")) {
    failures.push("missing visible clean draft_gate comment");
  }

  const preApproval = evidence.preApprovalGateMarker;
  if (!(
    preApproval.visible
    && preApproval.contractComplete
    && preApproval.verdict === "clean"
    && preApproval.headSha === evidence.currentHeadSha
  )) {
    failures.push("missing visible clean current-head pre_approval_gate comment");
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}


export async function detectGateReviewEvidence(options, { env = process.env, ghCommand = "gh" } = {}) {
  const prPayload = await runGhJson(["pr", "view", String(options.pr), "--repo", options.repo, "--json", "headRefOid"], { env, ghCommand });
  const commentsPayload = normalizeIssueCommentsPayload(await runGhJson(["api", "--paginate", "--slurp", `repos/${options.repo}/issues/${options.pr}/comments?per_page=100`], { env, ghCommand }));

  const currentHeadSha = typeof prPayload?.headRefOid === "string" && prPayload.headRefOid.trim().length > 0
    ? prPayload.headRefOid.trim()
    : null;

  if (!currentHeadSha) {
    throw new Error("Invalid gh pr view payload: missing headRefOid");
  }

  const commentSummary = summarizeGateReviewComments(commentsPayload);
  const markerSummary = summarizeGateReviewCommentMarkers(commentsPayload, { headSha: currentHeadSha });

  return {
    ok: true,
    repo: options.repo,
    pr: options.pr,
    currentHeadSha,
    draftGate: normalizeGateSummary(commentSummary.draft_gate),
    preApprovalGate: normalizeGateSummary(commentSummary.pre_approval_gate),
    draftGateMarker: normalizeGateMarkerSummary(markerSummary.draft_gate),
    preApprovalGateMarker: normalizeGateMarkerSummary(markerSummary.pre_approval_gate),
    draftGateSatisfied: commentSummary.draft_gate?.verdict === "clean" && typeof commentSummary.draft_gate?.headSha === "string",
  };
}

async function main() {
  let options;
  try {
    options = parseDetectGateReviewEvidenceCliArgs(process.argv.slice(2));
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
    const result = await detectGateReviewEvidence(options);
    const preMergeGateCheck = buildPreMergeGateCheck(result);
    const output = { ...result, preMergeGateCheck };

    if (!preMergeGateCheck.ok) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        error: `Pre-merge gate evidence check failed: ${preMergeGateCheck.failures.join("; ")}`,
        repo: result.repo,
        pr: result.pr,
        currentHeadSha: result.currentHeadSha,
        preMergeGateCheck,
      })}\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  await main();
}

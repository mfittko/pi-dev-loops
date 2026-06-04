#!/usr/bin/env node
import {
  buildParseError,
  formatCliError,
  isCopilotLogin,
  isDirectCliRun,
  parseJsonText,
  parseReviewThreads,
  summarizeCopilotReviews,
} from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { loadDevLoopConfig, resolveGateConfig, resolveRefinementConfig } from "@pi-dev-loops/core/config";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { buildSnapshotFromPrFacts, interpretLoopState, summarizeLoopInterpretation } from "@pi-dev-loops/core/loop/copilot-loop-state";
import { evaluatePrGateCoordination, PR_GATE_BOUNDARY, PR_GATE_ACTION } from "@pi-dev-loops/core/loop/pr-gate-coordination";
import { fetchGithubReviewThreadsPayload } from "../github/capture-review-threads.mjs";
import { detectGateReviewEvidence } from "../github/detect-gate-review-evidence.mjs";
import { autoDetectSnapshot } from "./detect-copilot-loop-state.mjs";

const UNMERGED_GIT_STATUS_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

const USAGE = `Usage: detect-pr-gate-coordination-state.mjs --repo <owner/name> --pr <number> [--review-mode internal_only] [--local-validation-head-sha <sha>]

Determine which PR gate/transition is legal next for a pull request.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Optional:
  --review-mode internal_only
  --local-validation-head-sha <sha>
                        Assert that local npm run verify already passed for
                        this exact head SHA so gate coordination can reuse the
                        bounded crediblyGreen CI exception from the Copilot
                        loop detector when GitHub created zero current-head
                        suites/statuses.

Output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/repo",
    "pr": 266,
    "currentHeadSha": "...",
    "mergeStateStatus": "DIRTY",
    "conflictFiles": ["config.test.mjs", "extension/README.md"],
    "lifecycleState": "pr_ready_no_feedback",
    "loopDisposition": "action_required",
    "gateBoundary": "conflict_resolution",
    "draftGate": {
      "visible": true,
      "markerVisible": false,
      "anyVisible": true,
      "currentHead": false,
      "contractComplete": false,
      "currentHeadClean": false,
      "headSha": "c94679e",
      "verdict": "clean"
    },
    "preApprovalGate": {
      "visible": false,
      "markerVisible": false,
      "anyVisible": false,
      "currentHead": false,
      "contractComplete": false,
      "currentHeadClean": false,
      "headSha": null,
      "verdict": null
    },
    "allowedNextActions": ["resolve_merge_conflicts"],
    "forbiddenActions": ["run_pre_approval_gate", "declare_merge_ready"],
    "nextAction": "resolve_merge_conflicts",
    "reason": "..."
  }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or gh/runtime failure`.trim();

const parseError = buildParseError(USAGE);


export function parseDetectPrGateCoordinationCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    reviewMode: undefined,
    localValidationHeadSha: undefined,
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

    if (token === "--review-mode") {
      const raw = requireOptionValue(args, "--review-mode", parseError).trim().toLowerCase();
      if (raw === "internal_only") {
        options.reviewMode = "internal_only";
        continue;
      }
      throw parseError(`--review-mode must be "internal_only", got: ${raw}`);
    }

    if (token === "--local-validation-head-sha") {
      const value = requireOptionValue(args, "--local-validation-head-sha", parseError).trim();
      if (value.length === 0) {
        throw parseError("--local-validation-head-sha must be a non-empty SHA");
      }
      options.localValidationHeadSha = value;
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

export function parseGitStatusConflictFiles(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const records = text.includes("\0")
    ? text.split("\0")
    : text.split(/\r?\n/);

  const conflictFiles = [];
  for (const rawRecord of records) {
    if (rawRecord.length < 4) {
      continue;
    }

    const status = rawRecord.slice(0, 2);
    if (!UNMERGED_GIT_STATUS_CODES.has(status)) {
      continue;
    }

    const rawPath = rawRecord.slice(3);
    if (rawPath.trim().length > 0 && !conflictFiles.includes(rawPath)) {
      conflictFiles.push(rawPath);
    }
  }

  return conflictFiles;
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
    ["pr", "view", String(pr), "--repo", repo, "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseJsonText(result.stdout, { label: "gh pr view" });
}

async function fetchLocalConflictFiles({ env = process.env, gitCommand = "git" } = {}) {
  let result;
  try {
    result = await runChild(
      gitCommand,
      ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=no"],
      env,
    );
  } catch {
    return [];
  }

  if (result.code !== 0) {
    return [];
  }

  return parseGitStatusConflictFiles(result.stdout);
}

export async function loadPrGateCoordinationContext(options, runtime = {}) {
  const prData = await fetchPrFacts(options, runtime);

  const currentHeadSha = typeof prData?.headRefOid === "string" && prData.headRefOid.trim().length > 0
    ? prData.headRefOid.trim()
    : null;
  if (!currentHeadSha) {
    throw new Error("Invalid gh pr view payload: missing headRefOid");
  }

  let snapshot;
  let gateEvidence;
  if (options.localValidationHeadSha === undefined) {
    const requestedReviewers = await fetchRequestedReviewers(options, runtime);
    const threadsPayload = await fetchGithubReviewThreadsPayload(options, runtime);
    const parsedThreads = parseReviewThreads(threadsPayload);
    gateEvidence = await detectGateReviewEvidence(options, runtime);
    const reviewSummary = summarizeCopilotReviews(prData?.reviews, { headSha: currentHeadSha });
    const reviewRequestStatus = requestedReviewers.requested
      ? "requested"
      : (reviewSummary.hasPendingReviewOnCurrentHead ? "already-requested" : "none");

    snapshot = buildSnapshotFromPrFacts({
      prData,
      prNumber: options.pr,
      copilotReviewRequestStatus: reviewRequestStatus,
      copilotReviewPresent: reviewSummary.copilotReviewPresent,
      copilotReviewOnCurrentHead: reviewSummary.hasSubmittedReviewOnCurrentHead,
      unresolvedThreadCount: parsedThreads.summary.unresolvedThreads,
      actionableThreadCount: parsedThreads.summary.actionableThreads,
      copilotReviewRoundCount: reviewSummary.completedCopilotReviewRounds,
    });
  } else {
    const requestedReviewers = await fetchRequestedReviewers(options, runtime);
    gateEvidence = await detectGateReviewEvidence(options, runtime);
    const reviewSummary = summarizeCopilotReviews(prData?.reviews, { headSha: currentHeadSha });
    const reviewRequestStatus = requestedReviewers.requested
      ? "requested"
      : (reviewSummary.hasPendingReviewOnCurrentHead ? "already-requested" : "none");
    snapshot = await autoDetectSnapshot({
      repo: options.repo,
      pr: options.pr,
      reviewRequestStatusOverride: reviewRequestStatus,
      localValidationHeadSha: options.localValidationHeadSha,
    }, runtime);
  }

  // #464: Auto-detect stop-at-local-fix without GitHub reply/resolve.
  // When unresolved threads exist AND the Copilot review was on an older
  // commit than current HEAD, auto-set agentFixStatus = "applied" so the
  // state machine routes to ALREADY_FIXED_NEEDS_REPLY_RESOLVE instead of
  // UNRESOLVED_FEEDBACK_PRESENT (implying code fixes still needed).
  if (snapshot.unresolvedThreadCount > 0
      && !snapshot.copilotReviewOnCurrentHead
      && snapshot.copilotReviewPresent) {
    snapshot.agentFixStatus = "applied";
  }

  const conflictFiles = await fetchLocalConflictFiles(runtime);

  if (gateEvidence.currentHeadSha !== currentHeadSha) {
    throw new Error(`PR head changed while loading gate coordination facts for ${options.repo}#${options.pr}; refuse to evaluate mixed-head gate state.`);
  }

  const interpretation = interpretLoopState(snapshot);
  const disposition = summarizeLoopInterpretation(interpretation);
  const mergeStateStatus = typeof prData?.mergeStateStatus === "string" && prData.mergeStateStatus.trim().length > 0
    ? prData.mergeStateStatus.trim().toUpperCase()
    : null;

  return {
    repo: options.repo,
    pr: options.pr,
    currentHeadSha,
    mergeStateStatus,
    conflictFiles,
    prData,
    snapshot,
    gateEvidence,
    interpretation,
    disposition,
  };
}

export async function detectPrGateCoordinationState(options, runtime = {}) {
  const context = await loadPrGateCoordinationContext(options, runtime);
  const { config } = await loadDevLoopConfig({ repoRoot: runtime.repoRoot ?? process.cwd() });
  const draftGateConfig = resolveGateConfig(config, "draft");
  const maxCopilotRounds = resolveRefinementConfig(config, "maxCopilotRounds");
  const result = evaluatePrGateCoordination({
    repo: context.repo,
    pr: context.pr,
    currentHeadSha: context.currentHeadSha,
    prDraft: Boolean(context.prData?.isDraft),
    prClosed: String(context.prData?.state || "").toUpperCase() === "CLOSED",
    prMerged: String(context.prData?.state || "").toUpperCase() === "MERGED",
    mergeStateStatus: context.mergeStateStatus,
    conflictFiles: context.conflictFiles,
    lifecycleState: context.interpretation.state,
    loopDisposition: context.disposition.loopDisposition,
    ciStatus: context.snapshot?.ciStatus ?? null,
    copilotReviewRoundCount: context.snapshot?.copilotReviewRoundCount ?? 0,
    maxCopilotRounds,
    sameHeadCleanConverged: context.interpretation.sameHeadCleanConverged,
    draftGateRequireCi: draftGateConfig.requireCi,
    reviewMode: options.reviewMode ?? null,
    draftGate: context.gateEvidence.draftGate,
    draftGateMarker: context.gateEvidence.draftGateMarker,
    preApprovalGate: context.gateEvidence.preApprovalGate,
    preApprovalGateMarker: context.gateEvidence.preApprovalGateMarker,
  });

  // #442: pre_approval_gate detector — if pre_approval_gate was never entered
  // for the current head (no visible contract-complete marker), force the
  // PRE_APPROVAL_GATE_NEEDED boundary regardless of what the state machine says.
  const preApprovalNeverEntered = !(result.preApprovalGate?.contractComplete === true);
  const gateBoundariesExpectingPreApproval = new Set([
    PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_NEEDED,
    PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW,
    PR_GATE_BOUNDARY.FINAL_APPROVAL_READY,
  ]);

  if (preApprovalNeverEntered && gateBoundariesExpectingPreApproval.has(result.gateBoundary)) {
    result.gateBoundary = PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_NEEDED;
    result.nextAction = PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE;
    result.reason = "No contract-complete pre_approval_gate marker exists for the current head SHA; run pre_approval_gate before proceeding.";
    result.allowedNextActions = [PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE];
  }
  // #460: draft_gate detector — if PR is non-draft and no visible
  // draft_gate evidence (comment or marker) exists at all
  // (one-time boundary), force the DRAFT_GATE_NEEDED boundary.
  const draftGateEvidenceMissing = !(result.draftGate?.anyVisible);
  const gateBoundariesExpectingDraftGate = new Set([
    PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW,
    PR_GATE_BOUNDARY.FEEDBACK_RESOLUTION,
    PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_NEEDED,
    PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW,
    PR_GATE_BOUNDARY.FINAL_APPROVAL_READY,
  ]);

  if (draftGateEvidenceMissing && gateBoundariesExpectingDraftGate.has(result.gateBoundary)) {
    result.gateBoundary = PR_GATE_BOUNDARY.DRAFT_GATE_NEEDED;
    result.nextAction = PR_GATE_ACTION.RECONCILE_DRAFT_GATE;
    result.reason = "The PR is non-draft but no visible draft_gate comment or marker exists at all (one-time boundary); run reconcile_draft_gate before proceeding.";
    result.allowedNextActions = [PR_GATE_ACTION.RECONCILE_DRAFT_GATE];
    result.forbiddenActions = [
      PR_GATE_ACTION.RUN_DRAFT_GATE,
      PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.WAIT_FOR_COPILOT_REVIEW,
      PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ];
    result.gateEvidenceNote = null;
  }

  return result;
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
  await main();
}

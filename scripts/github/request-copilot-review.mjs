#!/usr/bin/env node
import {
  formatCliError,
  isCopilotLogin,
  isDirectCliRun,
  parseReviewThreads,
  summarizeCopilotReviews,
} from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { fetchGithubReviewThreadsPayload } from "./capture-review-threads.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { buildSnapshotFromPrFacts, interpretLoopState } from "@pi-dev-loops/core/loop/copilot-loop-state";

const SUPPRESSED_SAME_HEAD_CLEAN_STATUS = "suppressed_same_head_clean";

const USAGE = `Usage: request-copilot-review.mjs --repo <owner/name> --pr <number> [--force-rerequest-review]

Request Copilot as a reviewer on a GitHub pull request.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Optional:
  --force-rerequest-review  Bypass same-head clean-convergence suppression and
                            attempt another explicit Copilot request anyway

Debug:
  PI_DEV_LOOPS_DEBUG=1      Emit stderr traces when best-effort same-head clean
                            convergence detection falls back to unsuppressed behavior

Output (stdout, JSON):
  { "ok": true, "status": "requested"|"already-requested"|"unavailable"|"suppressed_same_head_clean",
    "repo": "...", "pr": N, "reviewer": "Copilot", "detail"?: "...",
    "sameHeadCleanConverged"?: true, "bypassedSameHeadCleanSuppression"?: true }

Request statuses:
  requested           Copilot review was successfully requested
  already-requested   Copilot review was already observably in progress; no new request needed
  unavailable         Copilot review is not enabled/requestable and no in-progress evidence was found
  suppressed_same_head_clean  Current head is already clean-converged; no new request is made unless forced

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success (including unavailable)
  1  Argument error or gh failure`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

export function parseRequestCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    forceRerequestReview: false,
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

    if (token === "--force-rerequest-review") {
      options.forceRerequestReview = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("Requesting Copilot review requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

function parseRequestedReviewersPayload(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from gh: ${text.trim() || "<empty>"}`);
  }

  const users = Array.isArray(payload?.users) ? payload.users : [];
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];

  return {
    users,
    teams,
    requested: users.some((user) => isCopilotLogin(user?.login)),
  };
}

function parseReviewsPayload(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from gh: ${text.trim() || "<empty>"}`);
  }

  const headSha = typeof payload?.headRefOid === "string" && payload.headRefOid.trim().length > 0
    ? payload.headRefOid.trim()
    : null;
  const reviewSummary = summarizeCopilotReviews(payload?.reviews, { headSha });

  return {
    prData: payload,
    headSha,
    copilotReviewIds: reviewSummary.copilotReviewIds,
    copilotReviewPresent: reviewSummary.copilotReviewPresent,
    hasCopilotPendingReviewOnCurrentHead: reviewSummary.hasPendingReviewOnCurrentHead,
    hasCopilotSubmittedReviewOnCurrentHead: reviewSummary.hasSubmittedReviewOnCurrentHead,
    completedCopilotReviewRounds: reviewSummary.completedCopilotReviewRounds,
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

async function fetchCopilotReviewIds({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseReviewsPayload(result.stdout);
}

async function fetchCopilotReviewState(options, runtime) {
  const requestedReviewers = await fetchRequestedReviewers(options, runtime);
  const reviews = await fetchCopilotReviewIds(options, runtime);

  return {
    requested: requestedReviewers.requested,
    prData: reviews.prData,
    copilotReviewIds: reviews.copilotReviewIds,
    copilotReviewPresent: reviews.copilotReviewPresent,
    hasPendingReviewOnCurrentHead: reviews.hasCopilotPendingReviewOnCurrentHead,
    hasSubmittedReviewOnCurrentHead: reviews.hasCopilotSubmittedReviewOnCurrentHead,
    completedCopilotReviewRounds: reviews.completedCopilotReviewRounds,
  };
}

async function detectSameHeadCleanConvergence(options, runtime, priorReviewState = {}) {
  const {
    requested = false,
    prData = null,
    copilotReviewPresent = false,
    hasPendingReviewOnCurrentHead = false,
    hasSubmittedReviewOnCurrentHead = false,
  } = priorReviewState;

  if (typeof options.sameHeadCleanConverged === "boolean") {
    return options.sameHeadCleanConverged;
  }

  if (hasPendingReviewOnCurrentHead || !hasSubmittedReviewOnCurrentHead || prData === null) {
    return false;
  }

  try {
    const threadsPayload = await fetchGithubReviewThreadsPayload(
      { repo: options.repo, pr: options.pr },
      runtime,
    );
    const parsedThreads = parseReviewThreads(threadsPayload);
    const snapshot = buildSnapshotFromPrFacts({
      prData,
      prNumber: options.pr,
      copilotReviewRequestStatus: hasPendingReviewOnCurrentHead || requested ? "requested" : "none",
      copilotReviewPresent,
      copilotReviewOnCurrentHead: hasSubmittedReviewOnCurrentHead,
      unresolvedThreadCount: parsedThreads.summary.unresolvedThreads,
      actionableThreadCount: parsedThreads.summary.actionableThreads,
      copilotReviewRoundCount: priorReviewState.completedCopilotReviewRounds ?? 0,
    });
    const interpretation = interpretLoopState(snapshot);
    return interpretation.sameHeadCleanConverged;
  } catch (error) {
    if (runtime?.env?.PI_DEV_LOOPS_DEBUG === "1") {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[request-copilot-review] same-head clean-convergence detection unavailable: ${detail}\n`);
    }
    return false;
  }
}

function classifyRequestFailure(detail) {
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("not a collaborator") ||
    normalized.includes("not requestable") ||
    normalized.includes("copilot review") ||
    normalized.includes("reviews may only be requested")
  ) {
    return "unavailable";
  }

  return undefined;
}

async function requestCopilotReview({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "edit", String(pr), "--repo", repo, "--add-reviewer", "@copilot"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    const classified = classifyRequestFailure(detail);

    if (classified === "unavailable") {
      return {
        ok: true,
        status: "unavailable",
        repo,
        pr,
        reviewer: "Copilot",
        detail,
      };
    }

    throw new Error(`gh command failed: ${detail}`);
  }

  return {
    ok: true,
    status: "requested",
    repo,
    pr,
    reviewer: "Copilot",
  };
}

/**
 * Perform the full Copilot review-request logic and return the result payload.
 * Exported for use by higher-level orchestration helpers.
 */
export async function performCopilotReviewRequest(options, { env = process.env, ghCommand = "gh" } = {}) {
  const before = await fetchCopilotReviewState(options, { env, ghCommand });
  const sameHeadCleanConverged = await detectSameHeadCleanConvergence(
    options,
    { env, ghCommand },
    before,
  );
  const bypassedSameHeadCleanSuppression = sameHeadCleanConverged && options.forceRerequestReview === true;

  if (sameHeadCleanConverged && !options.forceRerequestReview) {
    return {
      ok: true,
      status: SUPPRESSED_SAME_HEAD_CLEAN_STATUS,
      repo: options.repo,
      pr: options.pr,
      reviewer: "Copilot",
      sameHeadCleanConverged: true,
      detail: "Current head already has a clean submitted Copilot review; rerun with --force-rerequest-review to bypass same-head clean-convergence suppression.",
    };
  }

  if (before.requested || before.hasPendingReviewOnCurrentHead) {
    return {
      ok: true,
      status: "already-requested",
      repo: options.repo,
      pr: options.pr,
      reviewer: "Copilot",
      ...(bypassedSameHeadCleanSuppression ? { bypassedSameHeadCleanSuppression: true } : {}),
    };
  }

  const requestResult = await requestCopilotReview(options, { env, ghCommand });

  if (requestResult.status === "unavailable") {
    // Post-failure verification: even when the explicit request path is rejected,
    // Copilot review may already be in progress if GitHub internally queued it.
    // Check for observable in-progress evidence before treating this as a terminal stop.
    const after = await fetchCopilotReviewState(options, { env, ghCommand });
    if (after.requested || after.hasPendingReviewOnCurrentHead) {
      return {
        ok: true,
        status: "already-requested",
        repo: options.repo,
        pr: options.pr,
        reviewer: "Copilot",
        ...(bypassedSameHeadCleanSuppression ? { bypassedSameHeadCleanSuppression: true } : {}),
      };
    }
    return {
      ...requestResult,
      ...(bypassedSameHeadCleanSuppression ? { bypassedSameHeadCleanSuppression: true } : {}),
    };
  }

  const after = await fetchCopilotReviewState(options, { env, ghCommand });
  const reviewCountIncreased = after.copilotReviewIds.length > before.copilotReviewIds.length;
  const reviewNowObservablyInProgress = after.requested || after.hasPendingReviewOnCurrentHead || reviewCountIncreased;

  if (!reviewNowObservablyInProgress) {
    throw new Error("Copilot review request did not appear in requested reviewers or fresh/in-progress Copilot reviews after gh pr edit");
  }

  return {
    ...requestResult,
    ...(bypassedSameHeadCleanSuppression ? { bypassedSameHeadCleanSuppression: true } : {}),
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseRequestCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await performCopilotReviewRequest(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
/**
 * Deterministic Copilot-loop state detector.
 *
 * Two modes:
 *
 * 1. Auto-detect (--repo <owner/name> --pr <number>)
 *    Fetches current PR/GitHub facts and interprets the loop state.
 *
 * 2. Snapshot interpretation (--input <path>)
 *    Reads a pre-built snapshot JSON and interprets it without any gh calls.
 *    Use this mode when the caller has already gathered facts (e.g. incorporating
 *    the result of scripts/github/request-copilot-review.mjs which can report
 *    historical request-attempt outcomes like "already-requested", "unavailable",
 *    or "failed" that are not fully observable from static state alone).
 *
 * Optional (auto-detect mode only):
 *   --steering-state-file <path>
 *     Path to a durable steering state JSON file (as written by steer-loop.mjs).
 *     When provided, the detector overlays the detected state with the current
 *     persisted steering state and reports steeringApplied,
 *     pendingStopAtNextSafeGate, terminalStopAtNextSafeGate, and
 *     effectiveConstraints. This detector is read-only: it does not promote
 *     queued steering or write
 *     the steering file. Snapshot mode does not accept this flag because repo/pr
 *     target identity cannot be proven from --input alone.
 *
 * Optional (auto-detect mode only):
 *   --review-request-status <requested|already-requested|unavailable|none|failed>
 *     Override the Copilot review request status with a known prior result.
 *     Useful when the caller already ran request-copilot-review.mjs and wants
 *     to inject its output status without re-probing the reviewers endpoint.
 *
 * Success output shape (no steering file):
 *   {
 *     "ok": true,
 *     "snapshot": { ... },
 *     "state": "...",
 *     "allowedTransitions": [...],
 *     "nextAction": "...",
 *     "autoRerequestEligible": true|false,
 *     "sameHeadCleanConverged": true|false,
 *     "loopDisposition": "...",
 *     "terminal": true|false
 *   }
 *
 * Success output shape (with steering file):
 *   { "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "...",
 *     "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false,
 *     "loopDisposition": "...", "terminal": true|false,
 *     "steeringApplied": true|false,
 *     "pendingStopAtNextSafeGate": true|false,
 *     "terminalStopAtNextSafeGate": true|false,
 *     "effectiveConstraints": { ... } }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   gh/GitHub failures and incomplete review-thread detection emit
 *   { "ok": false, "error": "..." } on stderr and exit non-zero.
 */
import { readFile } from "node:fs/promises";

import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import {
  formatCliError,
  isCopilotLogin,
  isDirectCliRun,
  parseJsonText,
  parseReviewThreads,
  summarizeCopilotReviews,
} from "../_core-helpers.mjs";
import { fetchGithubReviewThreadsPayload } from "../github/capture-review-threads.mjs";
import { parseRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";
import {
  buildSnapshotFromPrFacts,
  interpretLoopState,
  normalizeCiStatus,
  normalizeSnapshot,
  summarizeLoopInterpretation,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  normalizeHeadScopedCheckRunsStatus,
  normalizeHeadScopedCommitStatus,
  normalizeHeadScopedCiContract,
} from "../../packages/core/src/loop/copilot-ci-status.mjs";
import {
  createSteeringState,
  normalizeSteeringState,
  resolveEffectiveLoopState,
} from "../../packages/core/src/loop/steering.mjs";
import {
  loadStateFile,
  validateSteeringStateTarget,
} from "./_steering-state-file.mjs";

const USAGE = `Usage:
  detect-copilot-loop-state.mjs --repo <owner/name> --pr <number> [--review-request-status <status>]
  detect-copilot-loop-state.mjs --input <path>

Detect or interpret the current Copilot-loop state.

Modes:
  Auto-detect  Fetch live PR/GitHub facts and interpret loop state.
               Requires: --repo, --pr
  Snapshot     Interpret a pre-built snapshot JSON without any gh calls.
               Requires: --input

Required (auto-detect mode):
  --repo <owner/name>                        Repository slug (e.g. owner/repo)
  --pr <number>                              Pull request number

Required (snapshot mode):
  --input <path>                             Path to snapshot JSON file

Optional (auto-detect mode only):
  --steering-state-file <path>               Path to a durable steering state JSON file.
                                             When provided, nextAction is resolved through
                                             the current persisted steering contract state.
                                             This detector stays read-only: it never
                                             promotes queued steering or writes the file.
                                             Output includes steeringApplied,
                                             pendingStopAtNextSafeGate,
                                             terminalStopAtNextSafeGate, and
                                             effectiveConstraints. Cannot be combined with
                                             --input because snapshot mode cannot prove
                                             repo/pr identity.

Optional (auto-detect mode only):
  --review-request-status <status>           Inject a known prior request result.
                                             Values: requested|already-requested|unavailable|none|failed

Output (stdout, JSON):
  { "ok": true, "snapshot": {...}, "state": "...", "allowedTransitions": [...], "nextAction": "...",
    "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false,
    "loopDisposition": "...", "terminal": true|false }

  When --steering-state-file is provided, also includes:
  "steeringApplied": true|false,
  "pendingStopAtNextSafeGate": true|false,
  "terminalStopAtNextSafeGate": true|false,
  "effectiveConstraints": { ... }

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error, gh failure, or indeterminate state`.trim();

const VALID_OVERRIDE_STATUSES = new Set(["requested", "already-requested", "unavailable", "none", "failed"]);

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

export function parseDetectCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    inputPath: undefined,
    repo: undefined,
    pr: undefined,
    reviewRequestStatusOverride: undefined,
    steeringStateFile: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--input") {
      options.inputPath = requireOptionValue(args, "--input", parseError);
      continue;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", parseError).trim();
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr", parseError), parseError);
      continue;
    }

    if (token === "--review-request-status") {
      const val = requireOptionValue(args, "--review-request-status", parseError);
      if (!VALID_OVERRIDE_STATUSES.has(val)) {
        throw parseError(`--review-request-status must be one of: ${[...VALID_OVERRIDE_STATUSES].join(", ")}`);
      }
      options.reviewRequestStatusOverride = val;
      continue;
    }

    if (token === "--steering-state-file") {
      options.steeringStateFile = requireOptionValue(args, "--steering-state-file", parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.inputPath !== undefined) {
    if (options.repo !== undefined || options.pr !== undefined) {
      throw parseError("Choose exactly one input source: --input <path> or --repo/--pr auto-detect");
    }
    if (options.reviewRequestStatusOverride !== undefined) {
      throw parseError("--review-request-status cannot be combined with --input");
    }
    if (options.steeringStateFile !== undefined) {
      throw parseError("--steering-state-file cannot be combined with --input; use --repo/--pr auto-detect when steering integration is needed");
    }
    return options;
  }

  const hasRepo = options.repo !== undefined;
  const hasPr = options.pr !== undefined;

  if (hasRepo || hasPr) {
    if (!hasRepo || !hasPr) {
      throw parseError("Auto-detect mode requires both --repo <owner/name> and --pr <number>");
    }
    try {
      parseRepoSlug(options.repo);
    } catch (error) {
      throw parseError(error instanceof Error ? error.message : String(error));
    }
  } else {
    throw parseError("Provide either --input <path> or --repo <owner/name> --pr <number>");
  }

  return options;
}

/**
 * Fetch basic PR info: isDraft, state (OPEN/CLOSED/MERGED), number, headRefOid, reviews, statusCheckRollup.
 */
async function fetchPrView({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    // gh exits 1 with "no pull requests found" when the PR does not exist
    if (/no pull requests found/i.test(detail) || /could not find pull request/i.test(detail)) {
      return null;
    }
    throw new Error(`gh command failed: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }

  return payload;
}

/**
 * Fetch whether Copilot is currently in the PR's requested_reviewers list.
 */
async function fetchCopilotRequested({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }

  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.some((user) => isCopilotLogin(user?.login));
}

/**
 * Fetch the timestamp of the most recent review_requested event for Copilot
 * from the PR timeline. Returns an ISO string or null if not found.
 */
async function fetchLatestCopilotReviewRequestAt({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/issues/${pr}/timeline`, "--paginate", "--jq",
      '.[] | select(.event == "review_requested") | select(.requested_reviewer.login != null) | {login: .requested_reviewer.login, created_at: .created_at}'],
    env,
  );

  if (result.code !== 0) {
    // Non-fatal: if timeline is unavailable, fail open (trust requested_reviewers)
    return null;
  }

  let latestAt = null;
  for (const line of result.stdout.trim().split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (isCopilotLogin(event?.login)) {
        if (latestAt === null || event.created_at > latestAt) {
          latestAt = event.created_at;
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return latestAt;
}

async function fetchCurrentHeadCiStatus({ repo, headSha }, { env, ghCommand }) {
  const [checkRunsResult, statusesResult] = await Promise.all([
    runChild(
      ghCommand,
      ["api", `repos/${repo}/commits/${headSha}/check-runs?per_page=100`],
      env,
    ),
    runChild(
      ghCommand,
      ["api", `repos/${repo}/commits/${headSha}/status?per_page=100`],
      env,
    ),
  ]);

  let checkRunsStatus = null;
  if (checkRunsResult.code === 0) {
    try {
      checkRunsStatus = normalizeHeadScopedCheckRunsStatus(JSON.parse(checkRunsResult.stdout));
    } catch {
      checkRunsStatus = null;
    }
  }

  let commitStatus = null;
  if (statusesResult.code === 0) {
    try {
      commitStatus = normalizeHeadScopedCommitStatus(JSON.parse(statusesResult.stdout));
    } catch {
      commitStatus = null;
    }
  }

  if (checkRunsStatus === null && commitStatus === null) {
    return null;
  }

  return normalizeHeadScopedCiContract({
    checkRunsStatus: checkRunsStatus ?? "none",
    commitStatus: commitStatus ?? "none",
  }).overallStatus;
}

function hasSubmittedCopilotReviewOffCurrentHead(reviewSummary, currentHeadSha) {
  if (currentHeadSha == null) {
    return false;
  }

  const reviews = Array.isArray(reviewSummary?.copilotReviews) ? reviewSummary.copilotReviews : [];
  for (const review of reviews) {
    const state = typeof review?.state === "string" ? review.state.toUpperCase() : "";
    if (state === "PENDING") {
      continue;
    }

    const commitSha = typeof review?.commit?.oid === "string"
      ? review.commit.oid
      : (typeof review?.commit_id === "string" ? review.commit_id : null);
    if (commitSha && commitSha !== currentHeadSha) {
      return true;
    }
  }

  return false;
}

/**
 * Auto-detect the current loop snapshot by querying GitHub.
 * Exported for use by higher-level orchestration helpers.
 */
export async function autoDetectSnapshot({ repo, pr, reviewRequestStatusOverride }, { env = process.env, ghCommand = "gh" } = {}) {
  const prData = await fetchPrView({ repo, pr }, { env, ghCommand });

  if (prData === null) {
    return normalizeSnapshot({ prExists: false });
  }

  const prState = typeof prData.state === "string" ? prData.state.toUpperCase() : "OPEN";
  const prMerged = prState === "MERGED";
  const prClosed = prState === "CLOSED";

  // For merged/closed PRs we can return early without further gh calls
  if (prMerged || prClosed) {
    return normalizeSnapshot({
      prExists: true,
      prNumber: typeof prData.number === "number" ? prData.number : pr,
      prMerged,
      prClosed,
    });
  }

  const prHeadSha = typeof prData.headRefOid === "string" && prData.headRefOid.trim().length > 0
    ? prData.headRefOid.trim()
    : null;
  const reviewSummary = summarizeCopilotReviews(prData.reviews, { headSha: prHeadSha });
  const fallbackCiStatus = normalizeCiStatus(prData.statusCheckRollup);

  // Determine review request status
  let copilotReviewRequestStatus;
  if (reviewRequestStatusOverride !== undefined) {
    copilotReviewRequestStatus = reviewRequestStatusOverride;
  } else if (reviewSummary.hasPendingReviewOnCurrentHead) {
    // A PENDING Copilot review is observable evidence that review is already in progress,
    // so no additional requested_reviewers API probe is needed.
    copilotReviewRequestStatus = "requested";
  } else {
    const copilotRequested = await fetchCopilotRequested({ repo, pr }, { env, ghCommand });
    if (!copilotRequested) {
      copilotReviewRequestStatus = "none";
    } else if (!reviewSummary.hasSubmittedReviewOnCurrentHead) {
      // Copilot is requested and no submitted review on current head yet — genuinely pending.
      copilotReviewRequestStatus = "requested";
    } else {
      // Copilot is in requested_reviewers AND has a submitted review on current head.
      // This is ambiguous: either GitHub is stale (left Copilot after submission)
      // or a deliberate same-head re-request was made after the last review.
      // Resolve by comparing the latest review_requested timeline event against
      // the latest submitted review timestamp.
      const latestRequestAt = await fetchLatestCopilotReviewRequestAt({ repo, pr }, { env, ghCommand });
      const latestReviewAt = reviewSummary.latestSubmittedReviewOnCurrentHeadAt;
      if (latestRequestAt !== null && latestReviewAt !== null && latestRequestAt > latestReviewAt) {
        // The re-request is more recent than the last submitted review — genuinely active.
        copilotReviewRequestStatus = "requested";
      } else if (latestRequestAt === null) {
        // Timeline unavailable — fail open, trust requested_reviewers as authoritative.
        copilotReviewRequestStatus = "requested";
      } else {
        // The request predates the submitted review — stale; settle it.
        copilotReviewRequestStatus = "none";
      }
    }
  }

  // Fetch review threads for unresolved counts. This must fail closed: if we
  // cannot determine thread state, the loop cannot safely choose a wait or
  // re-request path.
  let unresolvedThreadCount = 0;
  let actionableThreadCount = 0;

  try {
    const threadsPayload = await fetchGithubReviewThreadsPayload({ repo, pr }, { env, ghCommand });
    const parsed = parseReviewThreads(threadsPayload);
    unresolvedThreadCount = parsed.summary.unresolvedThreads;
    actionableThreadCount = parsed.summary.actionableThreads;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not determine review-thread state: ${detail}`);
  }

  const shouldRefreshCurrentHeadCi =
    prHeadSha !== null
    && fallbackCiStatus === "success"
    && !reviewSummary.hasSubmittedReviewOnCurrentHead
    && hasSubmittedCopilotReviewOffCurrentHead(reviewSummary, prHeadSha);

  let currentHeadCiStatus = fallbackCiStatus;
  if (shouldRefreshCurrentHeadCi) {
    const refreshed = await fetchCurrentHeadCiStatus({ repo, headSha: prHeadSha }, { env, ghCommand });
    currentHeadCiStatus = refreshed ?? "none";
  }

  return buildSnapshotFromPrFacts({
    prData,
    prNumber: pr,
    copilotReviewRequestStatus,
    copilotReviewPresent: reviewSummary.copilotReviewPresent,
    copilotReviewOnCurrentHead: reviewSummary.hasSubmittedReviewOnCurrentHead,
    unresolvedThreadCount,
    actionableThreadCount,
    ciStatus: currentHeadCiStatus,
  });
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseDetectCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  let snapshot;

  if (options.inputPath !== undefined) {
    const text = await readFile(options.inputPath, "utf8");
    snapshot = normalizeSnapshot(parseJsonText(text));
  } else {
    snapshot = await autoDetectSnapshot(
      { repo: options.repo, pr: options.pr, reviewRequestStatusOverride: options.reviewRequestStatusOverride },
      { env, ghCommand },
    );
  }

  // Overlay steering state if a file was provided; keep this detector read-only.
  let interpretation;
  let steeringFields = {};

  if (options.steeringStateFile !== undefined) {
    const expectedPr = options.pr ?? snapshot.prNumber ?? null;
    const steeringState = await loadStateFile(options.steeringStateFile);
    const activeSteeringState = steeringState !== null
      ? normalizeSteeringState(steeringState)
      : createSteeringState(
          `pr-${options.pr}`,
          { repo: options.repo, pr: options.pr },
        );

    const validation = validateSteeringStateTarget(activeSteeringState, {
      repo: options.repo,
      pr: expectedPr,
      runId: `pr-${expectedPr}`,
    });
    if (!validation.ok) {
      throw new Error(`steering state target mismatch: ${validation.reason}`);
    }

    const resolved = resolveEffectiveLoopState(snapshot, activeSteeringState);
    interpretation = resolved;
    steeringFields = {
      steeringApplied: resolved.steeringApplied,
      pendingStopAtNextSafeGate: resolved.pendingStopAtNextSafeGate,
      terminalStopAtNextSafeGate: resolved.terminalStopAtNextSafeGate,
      effectiveConstraints: resolved.effectiveConstraints,
    };
  } else {
    interpretation = interpretLoopState(snapshot);
  }

  const interpretationSummary = summarizeLoopInterpretation(interpretation);

  stdout.write(`${JSON.stringify({
    ok: true,
    snapshot,
    state: interpretation.state,
    allowedTransitions: interpretation.allowedTransitions,
    nextAction: interpretation.nextAction,
    autoRerequestEligible: interpretation.autoRerequestEligible,
    sameHeadCleanConverged: interpretation.sameHeadCleanConverged,
    loopDisposition: interpretationSummary.loopDisposition,
    terminal: interpretationSummary.terminal,
    ...steeringFields,
  })}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

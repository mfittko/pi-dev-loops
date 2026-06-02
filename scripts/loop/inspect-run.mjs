#!/usr/bin/env node
/**
 * Read-only run inspection entrypoint for the Copilot PR outer-loop family.
 *
 * Composes a single JSON snapshot that answers, for one explicit target run:
 *   - what run is this?
 *   - which state family is interpreting it?
 *   - what outer-loop action/state is it in now?
 *   - what top-level status class applies?
 *   - what evidence produced that conclusion?
 *   - were facts live/authoritative, checkpoint-derived, or unavailable?
 *
 * This script is strictly read-only: it does not write checkpoints, mutate
 * GitHub state, or create any local artifacts as a side effect of inspection.
 *
 * Required:
 *   --repo <owner/name>                   Repository slug
 *   --pr <number>                         Pull request number
 *
 * Optional:
 *   --steering-state-file <path>          Path to a durable steering state JSON
 *                                         file (as written by steer-loop.mjs).
 *                                         When provided, steering is surfaced as
 *                                         a best-effort drill-down layer.
 *                                         When absent, steering is reported as
 *                                         unavailable (no_steering_locator).
 *
 * Test / snapshot-mode flags (skip live GitHub calls; for testing):
 *   --copilot-input <path>                Path to a pre-built copilot snapshot JSON
 *   --reviewer-input <path>               Path to a pre-built reviewer snapshot JSON
 *
 * Success output shape (stdout, JSON):
 *   { "ok": true, "schemaVersion": 1, "target": { "repo": "...", "pr": N },
 *     "inspectedAt": "...", "activeStateFamily": "copilot-pr-outer-loop",
 *     "outerState": "...", "allowedTransitions"?: [...], "outerAction": "...",
 *     "activeFamilyState": "...",
 *     "statusClass": "...", "needsAttention": false,
 *     "sourceMode": "...", "trust": "...",
 *     "evidence": { "summary": "...", "authoritative": [...], "checkpoint": [...] },
 *     "markers": { "missing": [], "stale": [], "conflicts": [] },
 *     "loopIterations": { "available": true|false, ... },
 *     "layers": { "copilot": {...}, "reviewer": {...}, "steering": {...} } }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   Unexpected runtime failures emit { "ok": false, "error": "..." } on stderr
 *   and exit non-zero.
 *
 * Exit codes:
 *   0  Success (including unknown/unavailable output for not-found targets)
 *   1  Argument error or unexpected runtime failure
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { buildParseError, formatCliError, parseJsonText, parseReviewThreads } from "../_core-helpers.mjs";
import { fetchGithubReviewThreadsPayload } from "../github/capture-review-threads.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { readExistingCheckpoint } from "./_checkpoint-io.mjs";
import { loadCopilotEvidence, loadReviewerEvidence } from "./_loop-evidence.mjs";
import { interpretOuterLoopState } from "@pi-dev-loops/core/loop/conductor-routing";
import {
  composeRunInspectionSnapshot,
  deriveRunIdForInspectionTarget,
} from "@pi-dev-loops/core/loop/run-inspection";
import { summarizeCopilotLoopIterations } from "@pi-dev-loops/core/loop/copilot-loop-iterations";
import {
  classifySafePoint,
  getSteeringStatus,
  normalizeSteeringState,
  resolveEffectiveLoopState,
  STEERING_KIND,
} from "@pi-dev-loops/core/loop/steering";
import { validateSteeringStateTarget } from "./_steering-state-file.mjs";

const USAGE = `Usage: inspect-run.mjs --repo <owner/name> --pr <number>

Read-only run inspection for the Copilot PR outer-loop family.

Produces a single JSON snapshot describing the current state of one
explicitly targeted run without attaching to a live worker process or
rewriting any local artifacts.

Required:
  --repo <owner/name>                   Repository slug (e.g. owner/repo)
  --pr <number>                         Pull request number

Optional:
  --steering-state-file <path>          Path to a durable steering state JSON
                                        file (as written by steer-loop.mjs).
                                        When absent, steering is reported as
                                        unavailable (no_steering_locator).
  --reviewer-login <login>              Reviewer login for live reviewer-loop
                                        detection. When omitted, reviewer
                                        detection uses aggregate all-reviewer
                                        scope for the PR.

Test / snapshot-mode flags:
  --copilot-input <path>                Pre-built copilot snapshot JSON
                                        (skips live copilot detection)
  --reviewer-input <path>               Pre-built reviewer snapshot JSON
                                        (skips live reviewer detection;
                                        cannot be combined with
                                        --reviewer-login)

Output (stdout, JSON):
  Always-present fields:
    ok, schemaVersion, target, inspectedAt, activeStateFamily,
    outerState, outerAction, activeFamilyState, statusClass, needsAttention,
    sourceMode, trust, evidence, markers, loopIterations
  Best-effort fields:
    allowedTransitions (when authoritative outerState is available),
    layers (copilot, reviewer, steering drill-down)

statusClass values:
  active    Outer loop needs to re-enter an inner loop
  waiting   Outer loop is waiting on an external event
  blocked   Outer loop is stopped and requires attention
  done      PR is merged or closed; loop complete
  unknown   Cannot determine state from available evidence

sourceMode values:
  live-detector-backed   All facts from live detectors (authoritative)
  checkpoint-only        Checkpoint drill-down only; top-level state stays unknown
  partial                Degraded mode. Mixed live + checkpoint fallback keeps top-level
                         state unknown; complete current-state input supplied by the
                         caller (including mixed live + input coverage) can still derive
                         a top-level state.
  unavailable            No usable evidence available

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  Runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or unexpected runtime failure`.trim();

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const parseError = buildParseError(USAGE);


function parseReviewerLogin(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw parseError("--reviewer-login must not be empty");
  }
  return normalized;
}

export function parseInspectRunCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    steeringStateFile: undefined,
    reviewerLogin: undefined,
    copilotInputPath: undefined,
    reviewerInputPath: undefined,
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

    if (token === "--steering-state-file") {
      options.steeringStateFile = requireOptionValue(args, "--steering-state-file", parseError);
      continue;
    }

    if (token === "--reviewer-login") {
      options.reviewerLogin = parseReviewerLogin(requireOptionValue(args, "--reviewer-login", parseError));
      continue;
    }

    if (token === "--copilot-input") {
      options.copilotInputPath = requireOptionValue(args, "--copilot-input", parseError);
      continue;
    }

    if (token === "--reviewer-input") {
      options.reviewerInputPath = requireOptionValue(args, "--reviewer-input", parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (!options.help) {
    if (options.repo === undefined || options.pr === undefined) {
      throw parseError("inspect-run requires both --repo <owner/name> and --pr <number>");
    }

    if (options.reviewerInputPath !== undefined && options.reviewerLogin !== undefined) {
      throw parseError("--reviewer-input cannot be combined with --reviewer-login");
    }

    try {
      parseRepoSlug(options.repo);
    } catch (error) {
      throw parseError(error instanceof Error ? error.message : String(error));
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// GitHub fact capture helpers
// ---------------------------------------------------------------------------

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }
}

function normalizeTimelineReviewRequestEvents(payload) {
  const events = Array.isArray(payload) ? payload : [];

  return events
    .filter((event) => event?.event === "review_requested")
    .map((event) => ({
      createdAt: event?.created_at,
      requestedReviewerLogin: event?.requested_reviewer?.login,
    }));
}

function normalizeReviewPayload(payload) {
  const reviews = Array.isArray(payload) ? payload : [];

  return reviews.map((review) => ({
    state: review?.state,
    submittedAt: review?.submitted_at ?? review?.created_at,
    authorLogin: review?.user?.login ?? review?.author?.login,
    commitSha: review?.commit_id ?? review?.commit?.oid,
  }));
}

function normalizeReviewCommentsPayload(payload) {
  const comments = Array.isArray(payload) ? payload : [];

  return comments.map((comment) => ({
    createdAt: comment?.created_at ?? comment?.createdAt,
    authorLogin: comment?.user?.login ?? comment?.author?.login,
  }));
}

function normalizeCommitsPayload(payload) {
  const commits = Array.isArray(payload) ? payload : [];

  return commits.map((item) => ({
    sha: item?.sha ?? item?.commit?.oid,
    committedAt: item?.commit?.committer?.date ?? item?.commit?.author?.date ?? item?.committed_at,
    authorLogin: item?.author?.login ?? item?.committer?.login ?? "",
  }));
}

async function fetchCopilotLoopIterations({ repo, pr, snapshot }, { env, ghCommand }) {
  const [prViewPayload, timelinePayload, reviewsPayload, reviewCommentsPayload, commitsPayload, reviewThreadsPayload] = await Promise.all([
    runGhJson(["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid"], { env, ghCommand }),
    runGhJson(
      ["api", "-H", "Accept: application/vnd.github+json", `repos/${repo}/issues/${pr}/timeline?per_page=100`],
      { env, ghCommand },
    ),
    runGhJson(["api", `repos/${repo}/pulls/${pr}/reviews?per_page=100`], { env, ghCommand }),
    runGhJson(["api", `repos/${repo}/pulls/${pr}/comments?per_page=100`], { env, ghCommand }),
    runGhJson(["api", `repos/${repo}/pulls/${pr}/commits?per_page=100`], { env, ghCommand }),
    fetchGithubReviewThreadsPayload({ repo, pr }, { env, ghCommand }),
  ]);

  const reviewThreads = parseReviewThreads(reviewThreadsPayload);
  const degradedReasons = [];
  if (Array.isArray(timelinePayload) && timelinePayload.length >= 100) degradedReasons.push("timeline_page_cap");
  if (Array.isArray(reviewsPayload) && reviewsPayload.length >= 100) degradedReasons.push("reviews_page_cap");
  if (Array.isArray(reviewCommentsPayload) && reviewCommentsPayload.length >= 100) degradedReasons.push("review_comments_page_cap");
  if (Array.isArray(commitsPayload) && commitsPayload.length >= 100) degradedReasons.push("commits_page_cap");
  if (reviewThreadsPayload?.data?.repository?.pullRequest?.reviewThreads?.pageInfo?.hasNextPage) {
    degradedReasons.push("review_threads_has_next_page");
  }

  return summarizeCopilotLoopIterations({
    reviewRequestEvents: normalizeTimelineReviewRequestEvents(timelinePayload),
    reviews: normalizeReviewPayload(reviewsPayload),
    reviewComments: normalizeReviewCommentsPayload(reviewCommentsPayload),
    commits: normalizeCommitsPayload(commitsPayload),
    reviewThreadSummary: reviewThreads.summary,
    currentHeadSha: typeof prViewPayload?.headRefOid === "string" ? prViewPayload.headRefOid : null,
    currentReviewRequestStatus: snapshot?.copilotReviewRequestStatus ?? "none",
    degraded: degradedReasons.length > 0,
    degradedReasons,
  });
}

// ---------------------------------------------------------------------------
// Steering state load (read-only)
// ---------------------------------------------------------------------------

/**
 * Attempt to load the steering state from the given path.
 *
 * @param {string} steeringStateFile
 * @returns {Promise<{ state: object | null, loadFailed: boolean }>}
 */
async function loadSteeringState(steeringStateFile) {
  try {
    const text = await readFile(steeringStateFile, "utf8");
    const raw = parseJsonText(text);
    return { state: normalizeSteeringState(raw), loadFailed: false };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { state: null, loadFailed: false };
    }
    return { state: null, loadFailed: true };
  }
}

// ---------------------------------------------------------------------------
// Main inspect function (pure I/O composition; no checkpoint writes)
// ---------------------------------------------------------------------------

/**
 * Compose a run inspection snapshot for one explicit target.
 *
 * This function performs live detection against GitHub (unless snapshot-mode
 * input files are provided), reads the existing checkpoint read-only, and
 * composes the canonical inspection snapshot via the pure core composer.
 *
 * No checkpoints are written. No GitHub state is mutated.
 *
 * @param {{ repo: string, pr: number, steeringStateFile?: string, reviewerLogin?: string,
 *           copilotInputPath?: string, reviewerInputPath?: string }} options
 * @param {{ env?: object, ghCommand?: string }} deps
 * @returns {Promise<object>} inspection snapshot
 */
export async function inspectRun(options, { env = process.env, ghCommand = "gh" } = {}) {
  const { repo, pr, steeringStateFile, reviewerLogin, copilotInputPath, reviewerInputPath } = options;
  parseRepoSlug(repo);
  const inspectedAt = new Date().toISOString();

  const evidenceSourceKinds = {
    copilot: copilotInputPath !== undefined ? "input" : "live",
    reviewer: reviewerInputPath !== undefined ? "input" : "live",
  };

  // -------------------------------------------------------------------------
  // Detect copilot inner-loop state
  // -------------------------------------------------------------------------

  let copilotEvidence = null;
  let copilotLiveStatus = "failed";

  try {
    copilotEvidence = await loadCopilotEvidence({ repo, pr, copilotInputPath }, { env, ghCommand });
    copilotLiveStatus = "ok";
  } catch {
    // Detection failure; copilotEvidence stays null, status stays "failed"
  }

  // -------------------------------------------------------------------------
  // Detect reviewer inner-loop state
  // -------------------------------------------------------------------------

  let reviewerEvidence = null;
  let reviewerLiveStatus = "failed";

  try {
    reviewerEvidence = await loadReviewerEvidence({ repo, pr, reviewerLogin, reviewerInputPath }, { env, ghCommand });
    reviewerLiveStatus = "ok";
  } catch {
    // Detection failure; reviewerEvidence stays null, status stays "failed"
  }

  let loopIterations = {
    available: false,
    source: "github_pr_timeline",
    reason: "requires_live_github_facts",
  };

  if (copilotEvidence?.snapshot?.prExists === false) {
    loopIterations = {
      available: false,
      source: "github_pr_timeline",
      reason: "no_pr",
    };
  } else if (copilotInputPath === undefined && copilotEvidence !== null) {
    try {
      loopIterations = await fetchCopilotLoopIterations(
        { repo, pr, snapshot: copilotEvidence.snapshot },
        { env, ghCommand },
      );
    } catch {
      loopIterations = {
        available: false,
        source: "github_pr_timeline",
        reason: "github_fact_capture_failed",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Read existing checkpoint (read-only)
  // -------------------------------------------------------------------------

  const { checkpoint: existingCheckpoint, filePath: checkpointEvidencePath } = await readExistingCheckpoint(repo, pr, { failSilently: true });

  // -------------------------------------------------------------------------
  // Derive authoritative outer state, allowed transitions, and compatibility
  // outerAction from best-available states
  //
  // Git status is out of scope for v1 inspection; neutral values are used so
  // that the outer action decision is based purely on PR/GitHub state.
  // -------------------------------------------------------------------------

  let outerState;
  let outerAllowedTransitions;
  let outerAction;
  let outerReason;

  const explicitTargetMissing =
    copilotEvidence?.snapshot?.prExists === false
    || reviewerEvidence?.snapshot?.prExists === false;

  const hasCompleteCurrentInnerLoopState =
    !explicitTargetMissing
    && copilotLiveStatus === "ok"
    && reviewerLiveStatus === "ok"
    && copilotEvidence !== null
    && reviewerEvidence !== null;

  if (hasCompleteCurrentInnerLoopState) {
    const outerInterpretation = interpretOuterLoopState({
      target: { repo, pr },
      copilotState: copilotEvidence.interpretation.state,
      reviewerState: reviewerEvidence.interpretation.state,
      sourceMode: evidenceSourceKinds.copilot === "live" && evidenceSourceKinds.reviewer === "live"
        ? "authoritative"
        : "snapshot",
      requiresLocalIsolation: false,
    });
    outerState = outerInterpretation.state;
    outerAllowedTransitions = outerInterpretation.allowedTransitions;
    outerAction = outerInterpretation.outerAction;
    outerReason = outerInterpretation.stopReason;
  }

  // -------------------------------------------------------------------------
  // Load steering state (best-effort)
  // -------------------------------------------------------------------------

  let steeringEvidence = null;
  let steeringLoadFailed = false;
  let steeringUnavailableReason = null;
  let steeringReadback = null;
  const steeringLocatorPath = steeringStateFile ?? null;

  if (steeringLocatorPath !== null) {
    const result = await loadSteeringState(steeringLocatorPath);
    steeringEvidence = result.state;
    steeringLoadFailed = result.loadFailed;

    if (steeringEvidence !== null) {
      const validation = validateSteeringStateTarget(steeringEvidence, {
        repo,
        pr,
        runId: deriveRunIdForInspectionTarget({ repo, pr }),
      });

      if (!validation.ok) {
        steeringEvidence = null;
        steeringUnavailableReason = "mismatched_steering_target";
      } else {
        const steeringStatus = getSteeringStatus(steeringEvidence);
        const resolved = copilotEvidence !== null
          ? resolveEffectiveLoopState(copilotEvidence.snapshot, steeringEvidence)
          : null;
        const queuedStopAtNextSafeGate = steeringEvidence.queuedEvents.some(
          (event) => event.kind === STEERING_KIND.STOP_AT_NEXT_SAFE_GATE,
        );
        const effectiveConstraints = resolved?.effectiveConstraints ?? steeringStatus.effectiveConstraints;
        const safePointCategory = copilotEvidence !== null
          ? classifySafePoint(copilotEvidence.interpretation.state)
          : null;

        steeringReadback = {
          latestAcknowledgement: steeringStatus.latestResult,
          effectiveConstraints,
          pendingSummary: {
            queuedCount: steeringStatus.queuedCount,
            queuedKinds: [...new Set(steeringEvidence.queuedEvents.map((event) => event.kind))],
            stopAtNextSafeGateQueued: queuedStopAtNextSafeGate,
          },
          stopAtNextSafeGate: {
            effective: effectiveConstraints.stopAtNextSafeGate,
            queued: queuedStopAtNextSafeGate,
            terminal: resolved?.terminalStopAtNextSafeGate ?? false,
            safePointCategory,
          },
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Compose and return snapshot
  // -------------------------------------------------------------------------

  return composeRunInspectionSnapshot({
    target: { repo, pr },
    inspectedAt,
    outerState,
    outerAllowedTransitions,
    outerAction,
    outerReason,
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint,
    checkpointEvidencePath,
    liveAvailability: { copilot: copilotLiveStatus, reviewer: reviewerLiveStatus },
    evidenceSourceKinds,
    explicitTargetMissing,
    steeringLocatorPath,
    steeringEvidence,
    steeringLoadFailed,
    steeringUnavailableReason,
    steeringReadback,
    loopIterations,
  });
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseInspectRunCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const snapshot = await inspectRun(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(snapshot)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

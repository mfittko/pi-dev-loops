#!/usr/bin/env node
/**
 * Thin outer-loop wrapper for the Copilot PR remediation loop.
 *
 * This script wraps the existing inner detectors:
 *   - detect-copilot-loop-state.mjs  (Copilot review/fix inner loop)
 *   - detect-reviewer-loop-state.mjs (Reviewer-side inner loop)
 *
 * It classifies the combined PR state into one machine-readable outer action:
 *   - continue_wait          Durable outer-loop wait; re-run after bounded wait
 *   - reenter_copilot_loop   Copilot inner loop needs action
 *   - reenter_reviewer_loop  Reviewer inner loop needs action
 *   - stop                   Terminal, blocked, or isolation-needed; do not proceed
 *   - done                   PR is merged or closed
 *
 * A minimal checkpoint is persisted to
 *   tmp/copilot-loop/<owner>/<repo>/pr-<n>/outer-loop-state.json
 * to support async continuation and debugging.  GitHub/PR state is always
 * authoritative; the checkpoint is advisory only.
 *
 * Success output shape:
 *   { "ok": true, "outerAction": "...", "copilotState": "...",
 *     "reviewerState": "...", "reason"?: "...",
 *     "conductorRouting": { "routingOutcome": "...", "outerAction": "...",
 *       "stopReason": null|"...", "handoffEnvelope": { ... } },
 *     "checkpoint": { "pr": N, "repo": "...", "outerAction": "...",
 *       "copilotState": "...", "reviewerState": "...", "reason": null|"...",
 *       "timestamp": "...", "waitCycles": N, "headSha": "..."|null } }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   gh/git failures emit { "ok": false, "error": "..." } on stderr and exit non-zero.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";
import { autoDetectSnapshot as autoDetectCopilotSnapshot } from "./detect-copilot-loop-state.mjs";
import {
  buildCheckpointFilePath,
  buildDefaultCheckpointDir,
  buildLegacyDefaultCheckpointDir,
} from "./_checkpoint-paths.mjs";
import { autoDetectReviewerSnapshot } from "./detect-reviewer-loop-state.mjs";
import {
  interpretLoopState,
  normalizeSnapshot as normalizeCopilotSnapshot,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  interpretReviewerLoopState,
  normalizeReviewerSnapshot,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";
import { interpretOuterLoopState } from "../../packages/core/src/loop/outer-loop-state.mjs";
import {
  ENTRYPOINT,
  evaluateConductorRouting,
  LOOP_FAMILY,
  ROUTING_OUTCOME,
  SOURCE_MODE,
} from "../../packages/core/src/loop/conductor-routing.mjs";
import {
  ASYNC_START_STATUS,
  buildAsyncStartRejection,
  validateAsyncStartContext,
} from "../../packages/core/src/loop/async-start-contract.mjs";

const USAGE = `Usage: outer-loop.mjs --repo <owner/name> --pr <number>

Thin outer-loop wrapper for the Copilot PR remediation loop.

Detects current PR state from both the Copilot inner loop and the reviewer
inner loop, decides the outer-loop action, and persists a minimal checkpoint.

Required:
  --repo <owner/name>                   Repository slug (e.g. owner/repo)
  --pr <number>                         Pull request number

Optional:
  --reviewer-login <login>              Reviewer login for reviewer-loop detection.
                                        When omitted, reviewer detection uses
                                        aggregate all-reviewer scope for the PR.
  --checkpoint-dir <dir>                Directory for checkpoint artifact
                                        (default: tmp/copilot-loop/<owner>/<repo>/pr-<n>/)
  --copilot-input <path>                Path to a pre-built copilot snapshot JSON
                                        (skips live copilot detection; for testing)
  --reviewer-input <path>               Path to a pre-built reviewer snapshot JSON
                                        (skips live reviewer detection; for testing;
                                        cannot be combined with --reviewer-login)

Output (stdout, JSON):
  { "ok": true, "outerAction": "...", "copilotState": "...",
    "reviewerState": "...", "reviewerScope": { "mode": "...",
      "reviewerLogin": "..."|null }, "reason"?: "...",
    "conductorRouting": { "routingOutcome": "...", "outerAction": "...",
      "stopReason": null|"...", "handoffEnvelope": { ... } },
    "checkpoint": { "pr": N, "repo": "...", "outerAction": "...",
      "copilotState": "...", "reviewerState": "...",
      "reviewerScope": "...", "reviewerLogin": "..."|null,
      "reason": null|"...", "timestamp": "...", "waitCycles": N,
      "headSha": "..."|null } }

Outer actions:
  continue_wait          Durable outer-loop wait state; re-run after bounded wait
  reenter_copilot_loop   Copilot inner loop needs action
  reenter_reviewer_loop  Reviewer inner loop needs action
  stop                   Terminal, blocked, or isolation-needed; do not proceed
  done                   PR is merged or closed; loop complete

Stop reasons:
  pr_not_ready                         PR does not exist
  copilot_blocked                      Copilot loop is blocked
  reviewer_blocked                     Reviewer loop is blocked
  review_unavailable                   Copilot review is unavailable
  unsafe_local_edit_requires_isolation Next step needs local mutation/execution
                                       but checkout is dirty or detached
  unsafe_local_branch_mismatch_requires_reconcile
                                       Next step needs PR-local work but local
                                       branch does not match PR head branch
  unsafe_local_head_mismatch_requires_reconcile
                                       Next step needs PR-local work but local
                                       HEAD does not match PR head commit
  unknown_state                        Unrecognized combined state

Async-start contract:
  This loop must run within a visible Pi-managed async context. It fails closed
  unless one of [PI_SUBAGENT_RUN_ID, PI_SESSION_ID, PI_ASYNC_CONTEXT] is set, to
  prevent hidden detached-process fallback (nohup, disowned shell jobs, etc.).
  Snapshot/test input mode (both --copilot-input and --reviewer-input) is exempt.
  Set PI_ASYNC_START_BYPASS=1 only for explicitly authorized standalone runs.

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/git/runtime failures:
    { "ok": false, "error": "..." }
  Async-start contract rejection:
    { "ok": false, "error": "...", "asyncStartContract": "rejected" }

Exit codes:
  0  Success
  1  Argument error, gh/git failure, or indeterminate state`.trim();

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function parseReviewerLogin(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw parseError("--reviewer-login must not be empty");
  }
  return normalized;
}

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw parseError(`Missing value for ${flag}`);
  }

  return value;
}

function parsePrNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw parseError("--pr must be a positive integer");
  }

  return Number(value);
}

export function parseOuterLoopCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    reviewerLogin: undefined,
    checkpointDir: undefined,
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
      options.repo = requireOptionValue(args, "--repo").trim();
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr"));
      continue;
    }

    if (token === "--reviewer-login") {
      options.reviewerLogin = parseReviewerLogin(requireOptionValue(args, "--reviewer-login"));
      continue;
    }

    if (token === "--checkpoint-dir") {
      options.checkpointDir = requireOptionValue(args, "--checkpoint-dir");
      continue;
    }

    if (token === "--copilot-input") {
      options.copilotInputPath = requireOptionValue(args, "--copilot-input");
      continue;
    }

    if (token === "--reviewer-input") {
      options.reviewerInputPath = requireOptionValue(args, "--reviewer-input");
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (!options.help) {
    if (options.repo === undefined || options.pr === undefined) {
      throw parseError("outer-loop requires both --repo <owner/name> and --pr <number>");
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
// Git dirty / detached check
// ---------------------------------------------------------------------------

function runChild(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Check whether the current git checkout is dirty or has a detached HEAD.
 *
 * @param {{ env?: object, gitCommand?: string }} deps
 * @returns {Promise<{ isDirty: boolean, isDetached: boolean, branchName: string|null, headSha: string|null }>}
 */
async function checkGitStatus({ env = process.env, gitCommand = "git" } = {}) {
  const [statusResult, headRefResult, headShaResult] = await Promise.all([
    runChild(gitCommand, ["status", "--porcelain"], env),
    runChild(gitCommand, ["rev-parse", "--abbrev-ref", "HEAD"], env),
    runChild(gitCommand, ["rev-parse", "HEAD"], env),
  ]);

  const isDirty = statusResult.code === 0
    ? statusResult.stdout.trim().length > 0
    : false;

  const headRef = headRefResult.code === 0
    ? headRefResult.stdout.trim()
    : "";

  const isDetached = headRef === "HEAD";
  const branchName = !isDetached && headRef.length > 0 ? headRef : null;
  const headSha = headShaResult.code === 0
    ? headShaResult.stdout.trim() || null
    : null;

  return { isDirty, isDetached, branchName, headSha };
}

async function fetchPrHeadIdentity({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "headRefName,headRefOid"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`Failed to read PR head identity: ${detail}`);
  }

  const payload = parseJsonText(result.stdout);
  const branchName = typeof payload.headRefName === "string" && payload.headRefName.trim().length > 0
    ? payload.headRefName.trim()
    : null;
  const headSha = typeof payload.headRefOid === "string" && payload.headRefOid.trim().length > 0
    ? payload.headRefOid.trim()
    : null;

  return { branchName, headSha };
}

function requiresPrLocalIdentityGate(outerAction) {
  return outerAction === "reenter_copilot_loop" || outerAction === "reenter_reviewer_loop";
}

function evaluatePrLocalIdentity({
  localBranch,
  localHeadSha,
  prBranch,
  prHeadSha,
}) {
  const branchMatches = typeof prBranch === "string" && prBranch.length > 0
    ? localBranch === prBranch
    : null;
  const headMatches = typeof prHeadSha === "string" && prHeadSha.length > 0
    ? localHeadSha === prHeadSha
    : null;

  const mismatchReason = branchMatches === false
    ? "unsafe_local_branch_mismatch_requires_reconcile"
    : (headMatches === false ? "unsafe_local_head_mismatch_requires_reconcile" : null);

  return {
    localBranch,
    localHeadSha,
    prBranch,
    prHeadSha,
    branchMatches,
    headMatches,
    mismatchReason,
  };
}

function buildPrLocalIdentityStopRouting({
  repo,
  pr,
  branchIdentity,
}) {
  const targetIdentity = { repo, pr };
  const reason = branchIdentity.mismatchReason === "unsafe_local_branch_mismatch_requires_reconcile"
    ? `Local branch '${branchIdentity.localBranch ?? "(unknown)"}' does not match PR head branch '${branchIdentity.prBranch ?? "(unknown)"}'; reconcile local branch/worktree before PR-local follow-up.`
    : `Local HEAD '${branchIdentity.localHeadSha ?? "(unknown)"}' does not match PR head '${branchIdentity.prHeadSha ?? "(unknown)"}'; reconcile local branch/worktree before PR-local follow-up.`;

  return {
    routingOutcome: ROUTING_OUTCOME.STOP_NEEDS_HUMAN,
    outerAction: "stop",
    stopReason: branchIdentity.mismatchReason,
    handoffEnvelope: {
      targetIdentity,
      loopFamily: LOOP_FAMILY.NONE,
      entrypoint: ENTRYPOINT.NONE,
      reason,
      requiredArgs: { repo, pr },
      requiresLocalIsolation: false,
      confidence: SOURCE_MODE.LOCAL,
    },
  };
}

// ---------------------------------------------------------------------------
// Checkpoint I/O
// ---------------------------------------------------------------------------

/**
 * Build the default checkpoint directory path from repo/pr.
 */
function defaultCheckpointDir(repo, pr) {
  return buildDefaultCheckpointDir(repo, pr);
}

/**
 * Read the previous checkpoint if it exists. Returns null if not found.
 *
 * @param {string} checkpointDir
 * @returns {Promise<object|null>}
 */
async function readCheckpoint(checkpointDir) {
  const filePath = buildCheckpointFilePath(checkpointDir);

  try {
    const text = await readFile(filePath, "utf8");
    return parseJsonText(text);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read checkpoint '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Write the checkpoint to disk.
 *
 * @param {string} checkpointDir
 * @param {object} checkpoint
 */
async function writeCheckpoint(checkpointDir, checkpoint) {
  await mkdir(checkpointDir, { recursive: true });
  const filePath = buildCheckpointFilePath(checkpointDir);
  await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

async function readResolvedCheckpoint({ repo, pr, checkpointDir }) {
  if (checkpointDir !== undefined) {
    return { checkpoint: await readCheckpoint(checkpointDir), filePath: buildCheckpointFilePath(checkpointDir) };
  }

  const preferredDir = defaultCheckpointDir(repo, pr);
  const preferredCheckpoint = await readCheckpoint(preferredDir);
  if (preferredCheckpoint !== null) {
    return {
      checkpoint: preferredCheckpoint,
      filePath: buildCheckpointFilePath(preferredDir),
    };
  }

  const legacyDir = buildLegacyDefaultCheckpointDir(pr);
  const legacyCheckpoint = await readCheckpoint(legacyDir);
  if (legacyCheckpoint !== null
    && legacyCheckpoint.repo === repo
    && legacyCheckpoint.pr === pr) {
    return {
      checkpoint: legacyCheckpoint,
      filePath: buildCheckpointFilePath(legacyDir),
    };
  }

  return {
    checkpoint: null,
    filePath: buildCheckpointFilePath(preferredDir),
  };
}

function shouldCarryForwardWaitCycles(previousCheckpoint, { repo, pr, headSha, outerAction }) {
  return previousCheckpoint !== null
    && previousCheckpoint.outerAction === "continue_wait"
    && outerAction === "continue_wait"
    && previousCheckpoint.repo === repo
    && previousCheckpoint.pr === pr
    && typeof previousCheckpoint.headSha === "string"
    && previousCheckpoint.headSha.length > 0
    && typeof headSha === "string"
    && headSha.length > 0
    && previousCheckpoint.headSha === headSha;
}

// ---------------------------------------------------------------------------
// Outer action decision (thin adapter around evaluateConductorRouting)
// ---------------------------------------------------------------------------

/**
 * Decide the outer-loop action from the two inner-machine states.
 *
 * This is a thin adapter around evaluateConductorRouting, which is the
 * conductor-owned routing authority. The routing logic lives there; this
 * function maps the routing result to the { outerAction, reason? } shape.
 *
 * A sentinel target is used here so that the routing evaluator can be
 * called without a concrete PR identity (e.g. from inspect-run.mjs or
 * unit tests). The sentinel target is discarded and does not affect routing.
 *
 * @param {{ copilotState: string, reviewerState: string, gitStatus: { isDirty: boolean, isDetached: boolean } }} params
 * @returns {{ outerAction: string, reason?: string }}
 */
export function decideOuterAction({ copilotState, reviewerState, gitStatus }) {
  const interpretation = interpretOuterLoopState({
    target: { repo: "routing/sentinel", pr: 1 },
    copilotState,
    reviewerState,
    requiresLocalIsolation: gitStatus.isDirty || gitStatus.isDetached,
  });
  return {
    outerAction: interpretation.outerAction,
    ...(interpretation.stopReason !== null ? { reason: interpretation.stopReason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

/**
 * Detect both inner-loop states, evaluate conductor routing (the routing
 * authority), persist checkpoint, and return the result payload.
 *
 * @param {{ repo: string, pr: number, reviewerLogin?: string, checkpointDir?: string,
 *           copilotInputPath?: string, reviewerInputPath?: string }} options
 * @param {{ env?: object, ghCommand?: string, gitCommand?: string }} deps
 * @returns {Promise<object>}
 */
export async function runOuterLoop(options, { env = process.env, ghCommand = "gh", gitCommand = "git" } = {}) {
  const { repo, pr, reviewerLogin, copilotInputPath, reviewerInputPath } = options;
  const normalizedRepo = repo.trim().toLowerCase();
  const checkpointDir = options.checkpointDir ?? defaultCheckpointDir(normalizedRepo, pr);

  // Async-start contract enforcement: fail closed when not in a Pi-managed context
  const isSnapshotMode = copilotInputPath !== undefined && reviewerInputPath !== undefined;
  const asyncStartValidation = validateAsyncStartContext({ env, isSnapshotMode });
  if (asyncStartValidation.status === ASYNC_START_STATUS.REJECTED) {
    return buildAsyncStartRejection(asyncStartValidation);
  }

  // Detect copilot state
  let copilotSnapshot;
  if (copilotInputPath !== undefined) {
    const text = await readFile(copilotInputPath, "utf8");
    copilotSnapshot = normalizeCopilotSnapshot(parseJsonText(text));
  } else {
    copilotSnapshot = await autoDetectCopilotSnapshot({ repo: normalizedRepo, pr }, { env, ghCommand });
  }
  const copilotInterpretation = interpretLoopState(copilotSnapshot);

  // Detect reviewer state
  let reviewerSnapshot;
  if (reviewerInputPath !== undefined) {
    const text = await readFile(reviewerInputPath, "utf8");
    reviewerSnapshot = normalizeReviewerSnapshot(parseJsonText(text));
  } else {
    reviewerSnapshot = await autoDetectReviewerSnapshot(
      { repo: normalizedRepo, pr, reviewerLogin },
      { env, ghCommand },
    );
  }
  const reviewerInterpretation = interpretReviewerLoopState(reviewerSnapshot);
  const currentHeadSha = typeof reviewerSnapshot?.prHeadSha === "string" && reviewerSnapshot.prHeadSha.length > 0
    ? reviewerSnapshot.prHeadSha
    : null;

  // Check git status
  const gitStatus = await checkGitStatus({ env, gitCommand });

  // Evaluate conductor routing — this is the routing authority.
  // The outer-loop action and stop reason are derived from the routing result.
  const sourceMode = (copilotInputPath !== undefined && reviewerInputPath !== undefined)
    ? "snapshot"
    : "local";

  let conductorRouting = evaluateConductorRouting({
    target: { repo: normalizedRepo, pr },
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    sourceMode,
    requiresLocalIsolation: gitStatus.isDirty || gitStatus.isDetached,
  });
  const outerInterpretation = interpretOuterLoopState({
    target: { repo: normalizedRepo, pr },
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    sourceMode,
    requiresLocalIsolation: gitStatus.isDirty || gitStatus.isDetached,
    routing: conductorRouting,
  });

  // Derive outer-loop action from the authoritative outer interpretation
  // while preserving the existing backward-compat output shape.
  let outerAction = outerInterpretation.outerAction;
  let outerReason = outerInterpretation.stopReason;

  let branchIdentity = null;
  if (outerReason === null && sourceMode === "local" && requiresPrLocalIdentityGate(outerAction)) {
    const prHeadIdentity = await fetchPrHeadIdentity({ repo: normalizedRepo, pr }, { env, ghCommand });
    branchIdentity = evaluatePrLocalIdentity({
      localBranch: gitStatus.branchName,
      localHeadSha: gitStatus.headSha,
      prBranch: prHeadIdentity.branchName,
      prHeadSha: prHeadIdentity.headSha ?? currentHeadSha,
    });

    if (branchIdentity.mismatchReason !== null) {
      outerAction = "stop";
      outerReason = branchIdentity.mismatchReason;
      conductorRouting = buildPrLocalIdentityStopRouting({
        repo: normalizedRepo,
        pr,
        branchIdentity,
      });
    }
  }

  // Read previous checkpoint to track wait cycles
  const { checkpoint: prevCheckpoint } = await readResolvedCheckpoint({
    repo: normalizedRepo,
    pr,
    checkpointDir: options.checkpointDir,
  });
  const prevWaitCycles = typeof prevCheckpoint?.waitCycles === "number" ? prevCheckpoint.waitCycles : 0;
  const waitCycles = shouldCarryForwardWaitCycles(prevCheckpoint, {
    repo: normalizedRepo,
    pr,
    headSha: currentHeadSha,
    outerAction,
  })
    ? prevWaitCycles + 1
    : (outerAction === "continue_wait" ? 1 : 0);

  // Build and persist checkpoint
  const checkpoint = {
    pr,
    repo: normalizedRepo,
    outerAction,
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    reviewerScope: reviewerSnapshot.reviewerScope,
    reviewerLogin: reviewerSnapshot.reviewerLogin,
    reason: outerReason ?? null,
    timestamp: new Date().toISOString(),
    waitCycles,
    headSha: currentHeadSha,
  };

  await writeCheckpoint(checkpointDir, checkpoint);

  return {
    ok: true,
    outerAction,
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    reviewerScope: {
      mode: reviewerSnapshot.reviewerScope,
      reviewerLogin: reviewerSnapshot.reviewerLogin,
    },
    ...(outerReason !== null && outerReason !== undefined ? { reason: outerReason } : {}),
    ...(branchIdentity !== null ? { branchIdentity } : {}),
    conductorRouting,
    checkpoint,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    ghCommand = "gh",
    gitCommand = "git",
  } = {},
) {
  const options = parseOuterLoopCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runOuterLoop(options, { env, ghCommand, gitCommand });

  // Fail closed when runOuterLoop returns ok:false (e.g. async-start contract rejection).
  // This covers any ok:false result, not only async-start rejections.
  if (result.ok === false) {
    stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }

  stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

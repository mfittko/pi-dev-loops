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
 *   tmp/copilot-loop/pr-<n>/outer-loop-state.json
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
 *       "timestamp": "...", "waitCycles": N } }
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
import { parseRepoSlug } from "../github/capture-review-threads.mjs";
import { autoDetectSnapshot as autoDetectCopilotSnapshot } from "./detect-copilot-loop-state.mjs";
import { autoDetectReviewerSnapshot } from "./detect-reviewer-loop-state.mjs";
import {
  interpretLoopState,
  normalizeSnapshot as normalizeCopilotSnapshot,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  interpretReviewerLoopState,
  normalizeReviewerSnapshot,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";
import { evaluateConductorRouting } from "../../packages/core/src/loop/conductor-routing.mjs";

const USAGE = `Usage: outer-loop.mjs --repo <owner/name> --pr <number>

Thin outer-loop wrapper for the Copilot PR remediation loop.

Detects current PR state from both the Copilot inner loop and the reviewer
inner loop, decides the outer-loop action, and persists a minimal checkpoint.

Required:
  --repo <owner/name>                   Repository slug (e.g. owner/repo)
  --pr <number>                         Pull request number

Optional:
  --reviewer-login <login>              Reviewer login for reviewer-loop detection
  --checkpoint-dir <dir>                Directory for checkpoint artifact
                                        (default: tmp/copilot-loop/pr-<n>/)
  --copilot-input <path>                Path to a pre-built copilot snapshot JSON
                                        (skips live copilot detection; for testing)
  --reviewer-input <path>               Path to a pre-built reviewer snapshot JSON
                                        (skips live reviewer detection; for testing)

Output (stdout, JSON):
  { "ok": true, "outerAction": "...", "copilotState": "...",
    "reviewerState": "...", "reason"?: "...",
    "conductorRouting": { "routingOutcome": "...", "outerAction": "...",
      "stopReason": null|"...", "handoffEnvelope": { ... } },
    "checkpoint": { "pr": N, "repo": "...", "outerAction": "...",
      "copilotState": "...", "reviewerState": "...", "reason": null|"...",
      "timestamp": "...", "waitCycles": N } }

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
  unknown_state                        Unrecognized combined state

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/git/runtime failures:
    { "ok": false, "error": "..." }

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
      options.reviewerLogin = requireOptionValue(args, "--reviewer-login").trim();
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
 * @returns {Promise<{ isDirty: boolean, isDetached: boolean }>}
 */
async function checkGitStatus({ env = process.env, gitCommand = "git" } = {}) {
  const [statusResult, headResult] = await Promise.all([
    runChild(gitCommand, ["status", "--porcelain"], env),
    runChild(gitCommand, ["rev-parse", "--abbrev-ref", "HEAD"], env),
  ]);

  const isDirty = statusResult.code === 0
    ? statusResult.stdout.trim().length > 0
    : false;

  const headRef = headResult.code === 0
    ? headResult.stdout.trim()
    : "";

  const isDetached = headRef === "HEAD";

  return { isDirty, isDetached };
}

// ---------------------------------------------------------------------------
// Checkpoint I/O
// ---------------------------------------------------------------------------

/**
 * Build the default checkpoint directory path from repo/pr.
 */
function defaultCheckpointDir(pr) {
  return path.join("tmp", "copilot-loop", `pr-${pr}`);
}

/**
 * Read the previous checkpoint if it exists. Returns null if not found.
 *
 * @param {string} checkpointDir
 * @returns {Promise<object|null>}
 */
async function readCheckpoint(checkpointDir) {
  const filePath = path.join(checkpointDir, "outer-loop-state.json");

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
  const filePath = path.join(checkpointDir, "outer-loop-state.json");
  await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
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
  const routing = evaluateConductorRouting({
    target: { repo: "routing/sentinel", pr: 1 },
    copilotState,
    reviewerState,
    requiresLocalIsolation: gitStatus.isDirty || gitStatus.isDetached,
  });
  return {
    outerAction: routing.outerAction,
    ...(routing.stopReason !== null ? { reason: routing.stopReason } : {}),
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
  const checkpointDir = options.checkpointDir ?? defaultCheckpointDir(pr);

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

  // Check git status
  const gitStatus = await checkGitStatus({ env, gitCommand });

  // Evaluate conductor routing — this is the routing authority.
  // The outer-loop action and stop reason are derived from the routing result.
  const conductorRouting = evaluateConductorRouting({
    target: { repo: normalizedRepo, pr },
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    sourceMode: (copilotInputPath !== undefined || reviewerInputPath !== undefined) ? "snapshot" : "local",
    requiresLocalIsolation: gitStatus.isDirty || gitStatus.isDetached,
  });

  // Derive outer-loop action from the routing result (backward-compat output shape)
  const outerAction = conductorRouting.outerAction;
  const outerReason = conductorRouting.stopReason;

  // Read previous checkpoint to track wait cycles
  const prevCheckpoint = await readCheckpoint(checkpointDir);
  const prevWaitCycles = typeof prevCheckpoint?.waitCycles === "number" ? prevCheckpoint.waitCycles : 0;
  const waitCycles = outerAction === "continue_wait" ? prevWaitCycles + 1 : 0;

  // Build and persist checkpoint
  const checkpoint = {
    pr,
    repo: normalizedRepo,
    outerAction,
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    reason: outerReason ?? null,
    timestamp: new Date().toISOString(),
    waitCycles,
  };

  await writeCheckpoint(checkpointDir, checkpoint);

  return {
    ok: true,
    outerAction,
    copilotState: copilotInterpretation.state,
    reviewerState: reviewerInterpretation.state,
    ...(outerReason !== null && outerReason !== undefined ? { reason: outerReason } : {}),
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
  stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

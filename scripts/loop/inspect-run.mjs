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
 *     "outerAction": "...", "activeFamilyState": "...",
 *     "statusClass": "...", "needsAttention": false,
 *     "sourceMode": "...", "trust": "...",
 *     "evidence": { "summary": "...", "authoritative": [...], "checkpoint": [...] },
 *     "markers": { "missing": [], "stale": [], "conflicts": [] },
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

import { formatCliError, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../github/capture-review-threads.mjs";
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
import { decideOuterAction } from "./outer-loop.mjs";
import {
  composeRunInspectionSnapshot,
} from "../../packages/core/src/loop/run-inspection.mjs";

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

Test / snapshot-mode flags:
  --copilot-input <path>                Pre-built copilot snapshot JSON
                                        (skips live copilot detection)
  --reviewer-input <path>               Pre-built reviewer snapshot JSON
                                        (skips live reviewer detection)

Output (stdout, JSON):
  Always-present fields:
    ok, schemaVersion, target, inspectedAt, activeStateFamily,
    outerAction, activeFamilyState, statusClass, needsAttention,
    sourceMode, trust, evidence, markers
  Best-effort fields:
    layers (copilot, reviewer, steering drill-down)

statusClass values:
  active    Outer loop needs to re-enter an inner loop
  waiting   Outer loop is waiting on an external event
  blocked   Outer loop is stopped and requires attention
  done      PR is merged or closed; loop complete
  unknown   Cannot determine state from available evidence

sourceMode values:
  live-detector-backed   All facts from live detectors (authoritative)
  checkpoint-only        Facts from existing checkpoint only (degraded)
  partial                Mixed live and checkpoint-derived (degraded)
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

export function parseInspectRunCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    steeringStateFile: undefined,
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

    if (token === "--steering-state-file") {
      options.steeringStateFile = requireOptionValue(args, "--steering-state-file");
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
      throw parseError("inspect-run requires both --repo <owner/name> and --pr <number>");
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
// Checkpoint read (read-only; no writes)
// ---------------------------------------------------------------------------

function defaultCheckpointDir(repo, pr) {
  return buildDefaultCheckpointDir(repo, pr);
}

/**
 * Read the existing checkpoint if it exists. Returns null if not found.
 * This is a read-only operation; the checkpoint is never written here.
 *
 * @param {string} repo
 * @param {number} pr
 * @returns {Promise<{ checkpoint: object|null, filePath: string|null }>}
 */
async function readExistingCheckpoint(repo, pr) {
  const normalizedRepo = repo.trim().toLowerCase();
  const preferredDir = defaultCheckpointDir(normalizedRepo, pr);
  const preferredPath = buildCheckpointFilePath(preferredDir);

  try {
    const text = await readFile(preferredPath, "utf8");
    return { checkpoint: parseJsonText(text), filePath: preferredPath };
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      return { checkpoint: null, filePath: null };
    }
  }

  const legacyPath = buildCheckpointFilePath(buildLegacyDefaultCheckpointDir(pr));
  try {
    const text = await readFile(legacyPath, "utf8");
    const checkpoint = parseJsonText(text);
    if (checkpoint?.repo === normalizedRepo && checkpoint?.pr === pr) {
      return { checkpoint, filePath: legacyPath };
    }
    return { checkpoint: null, filePath: null };
  } catch {
    return { checkpoint: null, filePath: null };
  }
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
    return { state: raw, loadFailed: false };
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
 * @param {{ repo: string, pr: number, steeringStateFile?: string,
 *           copilotInputPath?: string, reviewerInputPath?: string }} options
 * @param {{ env?: object, ghCommand?: string }} deps
 * @returns {Promise<object>} inspection snapshot
 */
export async function inspectRun(options, { env = process.env, ghCommand = "gh" } = {}) {
  const { repo, pr, steeringStateFile, copilotInputPath, reviewerInputPath } = options;
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
    let copilotSnapshot;
    if (copilotInputPath !== undefined) {
      const text = await readFile(copilotInputPath, "utf8");
      copilotSnapshot = normalizeCopilotSnapshot(parseJsonText(text));
    } else {
      copilotSnapshot = await autoDetectCopilotSnapshot({ repo, pr }, { env, ghCommand });
    }
    const interpretation = interpretLoopState(copilotSnapshot);
    copilotEvidence = { snapshot: copilotSnapshot, interpretation };
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
    let reviewerSnapshot;
    if (reviewerInputPath !== undefined) {
      const text = await readFile(reviewerInputPath, "utf8");
      reviewerSnapshot = normalizeReviewerSnapshot(parseJsonText(text));
    } else {
      reviewerSnapshot = await autoDetectReviewerSnapshot(
        { repo, pr },
        { env, ghCommand },
      );
    }
    const interpretation = interpretReviewerLoopState(reviewerSnapshot);
    reviewerEvidence = { snapshot: reviewerSnapshot, interpretation };
    reviewerLiveStatus = "ok";
  } catch {
    // Detection failure; reviewerEvidence stays null, status stays "failed"
  }

  // -------------------------------------------------------------------------
  // Read existing checkpoint (read-only)
  // -------------------------------------------------------------------------

  const { checkpoint: existingCheckpoint, filePath: checkpointEvidencePath } = await readExistingCheckpoint(repo, pr);

  // -------------------------------------------------------------------------
  // Derive outerAction from best-available states
  //
  // Git status is out of scope for v1 inspection; neutral values are used so
  // that the outer action decision is based purely on PR/GitHub state.
  // -------------------------------------------------------------------------

  let outerAction;
  let outerReason;

  const explicitTargetMissing =
    copilotEvidence?.snapshot?.prExists === false
    || reviewerEvidence?.snapshot?.prExists === false;

  const effectiveCopilotState =
    !explicitTargetMissing && copilotLiveStatus === "ok" && copilotEvidence !== null
      ? copilotEvidence.interpretation.state
      : (typeof existingCheckpoint?.copilotState === "string" ? existingCheckpoint.copilotState : undefined);

  const effectiveReviewerState =
    !explicitTargetMissing && reviewerLiveStatus === "ok" && reviewerEvidence !== null
      ? reviewerEvidence.interpretation.state
      : (typeof existingCheckpoint?.reviewerState === "string" ? existingCheckpoint.reviewerState : undefined);

  if (!explicitTargetMissing && effectiveCopilotState !== undefined && effectiveReviewerState !== undefined) {
    const decision = decideOuterAction({
      copilotState: effectiveCopilotState,
      reviewerState: effectiveReviewerState,
      gitStatus: { isDirty: false, isDetached: false },
    });
    outerAction = decision.outerAction;
    outerReason = decision.reason;
  }

  // -------------------------------------------------------------------------
  // Load steering state (best-effort)
  // -------------------------------------------------------------------------

  let steeringEvidence = null;
  let steeringLoadFailed = false;
  const steeringLocatorPath = steeringStateFile ?? null;

  if (steeringLocatorPath !== null) {
    const result = await loadSteeringState(steeringLocatorPath);
    steeringEvidence = result.state;
    steeringLoadFailed = result.loadFailed;
  }

  // -------------------------------------------------------------------------
  // Compose and return snapshot
  // -------------------------------------------------------------------------

  return composeRunInspectionSnapshot({
    target: { repo, pr },
    inspectedAt,
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

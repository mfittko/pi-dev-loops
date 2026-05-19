#!/usr/bin/env node
/**
 * Mid-flight operator steering CLI for active dev loops.
 *
 * Supports two subcommands:
 *
 * 1. submit — Submit a bounded steering directive to a specific active run.
 *    Operator-facing mode:
 *      steer-loop.mjs submit --repo <owner/name> --pr <number>
 *        --kind stop_at_next_safe_gate --directive <text> --seq <n>
 *        [--state-file <path>] [--copilot-input <path>] [--reviewer-input <path>]
 *
 *    Low-level/testing mode:
 *      steer-loop.mjs submit --run-id <id> --kind <kind> --directive <text>
 *        --seq <n> [--state-file <path>] [--loop-state <state>] [--apply-mode <mode>]
 *
 * 2. status — Inspect the steering state for a run.
 *    steer-loop.mjs status --run-id <id> [--state-file <path>]
 *
 * State is persisted to / loaded from a JSON file (--state-file, default:
 * .pi/steering/<run-id>.json relative to the current working directory).
 *
 * The --loop-state flag accepts a current copilot loop state value (e.g.
 * "ready_to_rerequest_review") so that callers can inject the loop state
 * without this script needing to query GitHub directly. This is the model
 * used for deterministic testing and for integration with orchestration layers
 * that already have the loop state in scope.
 *
 * Success output shape:
 *   submit: { "ok": true, "result": { ... }, "steeringState": { ... } }
 *   status: { "ok": true, "status": { ... } }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   Runtime failures emit { "ok": false, "error": "..." } on stderr and exit non-zero.
 */
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STEERING_KIND,
  STEERING_RESULT,
  classifySafePoint,
  normalizeSteeringEvent,
  normalizeSteeringState,
  createSteeringState,
  submitSteering,
  getSteeringStatus,
} from "../../packages/core/src/loop/steering.mjs";
import { STATE } from "../../packages/core/src/loop/copilot-loop-state.mjs";
import { deriveRunIdForInspectionTarget } from "../../packages/core/src/loop/run-inspection.mjs";
import { inspectRun } from "./inspect-run.mjs";

import { formatCliError } from "../_core-helpers.mjs";

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

const SUBMIT_USAGE = `Usage:
  steer-loop.mjs submit --repo <owner/name> --pr <number>
    --kind stop_at_next_safe_gate --directive <text> --seq <n>
    [--state-file <path>] [--copilot-input <path>] [--reviewer-input <path>]
    [--run-id <id>] [--event-id <id>]

  steer-loop.mjs submit --run-id <id> --kind <kind> --directive <text> --seq <n>
    [--state-file <path>] [--loop-state <loop-state>] [--apply-mode <mode>]
    [--event-id <id>]

Submit a mid-flight steering directive to an active dev loop run.

Required:
  --kind <kind>           Steering kind
  --directive <text>      Operator payload / directive text
  --seq <n>               Positive integer sequence number (monotonically increasing per run)
  --run-id <id>           Target run identifier (required in low-level mode)
  --repo <owner/name>     Repository slug (required with --pr in operator-facing mode)
  --pr <number>           Pull request number (required with --repo in operator-facing mode)

Optional:
  --state-file <path>     Path to steering state JSON file (default: .pi/steering/<run-id>.json)
  --loop-state <state>    Current copilot loop state (low-level/testing mode only)
  --apply-mode <mode>     Application mode: immediate | next_safe_point (low-level/testing mode only)
  --event-id <id>         Unique event ID (default: auto-generated)
  --copilot-input <path>  Pre-built copilot snapshot JSON (operator-facing test mode)
  --reviewer-input <path> Pre-built reviewer snapshot JSON (operator-facing test mode)

Output (stdout, JSON):
  { "ok": true, "acknowledgement": { ... }, "result": { ... }, "steeringState": { ... } }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }`.trim();

const STATUS_USAGE = `Usage:
  steer-loop.mjs status --run-id <id> [--state-file <path>]
  steer-loop.mjs status --repo <owner/name> --pr <number> [--state-file <path>]

Inspect the steering state for a run.

Required:
  --run-id <id>           Target run identifier
  --repo <owner/name>     Repository slug (required with --pr)
  --pr <number>           Pull request number (required with --repo)

Optional:
  --state-file <path>     Path to steering state JSON file (default: .pi/steering/<run-id>.json)

Output (stdout, JSON):
  { "ok": true, "status": { ... } }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }`.trim();

const TOP_USAGE = `Usage:
  steer-loop.mjs <subcommand> [options]

Subcommands:
  submit   Submit a steering directive to an active dev loop run
  status   Inspect the steering state for a run

Run steer-loop.mjs <subcommand> --help for subcommand-specific help.`.trim();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set(Object.values(STEERING_KIND));
const VALID_APPLY_MODES = new Set(["immediate", "next_safe_point"]);
const VALID_LOOP_STATES = new Set(Object.values(STATE));
const SAFE_RUN_ID_RE = /^[A-Za-z0-9._-]+$/;
const STATE_FILE_LOCK_TIMEOUT_MS = 5000;
const STATE_FILE_LOCK_RETRY_MS = 50;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseError(message, usage) {
  return Object.assign(new Error(message), { usage });
}

function runIdMismatchError(persistedRunId, requestedRunId) {
  return new Error(
    `run-id mismatch: --state-file contains run '${persistedRunId}' but --run-id is '${requestedRunId}'. Use the correct --run-id or point --state-file at the right file.`
  );
}

function requireOptionValue(args, flag, usage, { allowFlagLike = false } = {}) {
  const value = args.shift();
  const missing = typeof value !== "string" || value.length === 0 || (!allowFlagLike && value.startsWith("--"));
  if (missing) {
    throw parseError(`Missing value for ${flag}`, usage);
  }
  return value;
}

function validateSafeRunId(runId, usage) {
  if (!SAFE_RUN_ID_RE.test(runId)) {
    throw parseError("--run-id must contain only letters, numbers, dot, underscore, or hyphen", usage);
  }
}

export function parseSubmitCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    runId: undefined,
    kind: undefined,
    directive: undefined,
    seq: undefined,
    stateFile: undefined,
    loopState: "ready_to_rerequest_review",
    applyMode: "immediate",
    eventId: undefined,
    copilotInputPath: undefined,
    reviewerInputPath: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--run-id") {
      options.runId = requireOptionValue(args, "--run-id", SUBMIT_USAGE).trim();
      validateSafeRunId(options.runId, SUBMIT_USAGE);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", SUBMIT_USAGE).trim();
      continue;
    }
    if (token === "--pr") {
      const raw = requireOptionValue(args, "--pr", SUBMIT_USAGE);
      if (!/^\d+$/.test(raw) || Number(raw) === 0) {
        throw parseError("--pr must be a positive integer", SUBMIT_USAGE);
      }
      options.pr = Number(raw);
      continue;
    }
    if (token === "--kind") {
      const val = requireOptionValue(args, "--kind", SUBMIT_USAGE);
      if (!VALID_KINDS.has(val)) {
        throw parseError(`--kind must be one of: ${[...VALID_KINDS].join(", ")}`, SUBMIT_USAGE);
      }
      options.kind = val;
      continue;
    }
    if (token === "--directive") {
      options.directive = requireOptionValue(args, "--directive", SUBMIT_USAGE, { allowFlagLike: true }).trim();
      continue;
    }
    if (token === "--seq") {
      const raw = requireOptionValue(args, "--seq", SUBMIT_USAGE);
      if (!/^\d+$/.test(raw) || Number(raw) === 0) {
        throw parseError("--seq must be a positive integer", SUBMIT_USAGE);
      }
      options.seq = Number(raw);
      continue;
    }
    if (token === "--state-file") {
      options.stateFile = requireOptionValue(args, "--state-file", SUBMIT_USAGE);
      continue;
    }
    if (token === "--loop-state") {
      const val = requireOptionValue(args, "--loop-state", SUBMIT_USAGE);
      if (!VALID_LOOP_STATES.has(val)) {
        throw parseError(`--loop-state must be one of: ${[...VALID_LOOP_STATES].join(", ")}`, SUBMIT_USAGE);
      }
      options.loopState = val;
      continue;
    }
    if (token === "--apply-mode") {
      const val = requireOptionValue(args, "--apply-mode", SUBMIT_USAGE);
      if (!VALID_APPLY_MODES.has(val)) {
        throw parseError(`--apply-mode must be one of: ${[...VALID_APPLY_MODES].join(", ")}`, SUBMIT_USAGE);
      }
      options.applyMode = val;
      continue;
    }
    if (token === "--event-id") {
      options.eventId = requireOptionValue(args, "--event-id", SUBMIT_USAGE);
      continue;
    }
    if (token === "--copilot-input") {
      options.copilotInputPath = requireOptionValue(args, "--copilot-input", SUBMIT_USAGE);
      continue;
    }
    if (token === "--reviewer-input") {
      options.reviewerInputPath = requireOptionValue(args, "--reviewer-input", SUBMIT_USAGE);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`, SUBMIT_USAGE);
  }

  if (!options.help) {
    if ((options.repo === undefined) !== (options.pr === undefined)) {
      throw parseError("--repo and --pr must be provided together", SUBMIT_USAGE);
    }
    if (!options.runId && options.repo === undefined) {
      throw parseError("--run-id is required unless --repo and --pr are provided", SUBMIT_USAGE);
    }
    if (!options.kind) {
      throw parseError("--kind is required", SUBMIT_USAGE);
    }
    if (!options.directive || options.directive.length === 0) {
      throw parseError("--directive is required and must be non-empty", SUBMIT_USAGE);
    }
    if (options.seq === undefined) {
      throw parseError("--seq is required", SUBMIT_USAGE);
    }
  }

  return options;
}

export function parseStatusCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    runId: undefined,
    stateFile: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--run-id") {
      options.runId = requireOptionValue(args, "--run-id", STATUS_USAGE).trim();
      validateSafeRunId(options.runId, STATUS_USAGE);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", STATUS_USAGE).trim();
      continue;
    }
    if (token === "--pr") {
      const raw = requireOptionValue(args, "--pr", STATUS_USAGE);
      if (!/^\d+$/.test(raw) || Number(raw) === 0) {
        throw parseError("--pr must be a positive integer", STATUS_USAGE);
      }
      options.pr = Number(raw);
      continue;
    }
    if (token === "--state-file") {
      options.stateFile = requireOptionValue(args, "--state-file", STATUS_USAGE);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`, STATUS_USAGE);
  }

  if (!options.help) {
    if ((options.repo === undefined) !== (options.pr === undefined)) {
      throw parseError("--repo and --pr must be provided together", STATUS_USAGE);
    }
    if (!options.runId && options.repo === undefined) {
      throw parseError("--run-id is required unless --repo and --pr are provided", STATUS_USAGE);
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

function defaultStateFilePath(runId, cwd = process.cwd()) {
  return path.join(cwd, ".pi", "steering", `${runId}.json`);
}

function deriveTargetRunId(options) {
  if (options.repo !== undefined && options.pr !== undefined) {
    return deriveRunIdForInspectionTarget({ repo: options.repo, pr: options.pr });
  }
  return options.runId;
}

function resolveRequestedRunId(options, usage) {
  const derivedRunId = deriveTargetRunId(options);
  if (options.runId && options.repo !== undefined && options.pr !== undefined && options.runId !== derivedRunId) {
    throw parseError(
      `run-id mismatch: explicit --run-id '${options.runId}' does not match derived run '${derivedRunId}' for --repo/--pr target`,
      usage,
    );
  }
  return derivedRunId;
}

function mapDisposition(resultCode) {
  switch (resultCode) {
    case STEERING_RESULT.APPLIED_NOW:
      return "applied_now";
    case STEERING_RESULT.QUEUED_FOR_SAFE_POINT:
      return "queued_for_safe_point";
    default:
      return "rejected";
  }
}

function buildReadbackPath({ repo, pr, runId, stateFilePath }) {
  const stateFileFlag = stateFilePath ? ` --state-file ${stateFilePath}` : "";
  const inspection = repo && pr
    ? `inspect-run --repo ${repo} --pr ${pr}${stateFileFlag}`
    : null;
  return {
    inspection,
    steeringStatus: `steer-loop.mjs status --run-id ${runId}${stateFileFlag}`,
  };
}

function buildAcknowledgement({
  repo,
  pr,
  runId,
  directive,
  resultCode,
  reason,
  inspectedState,
  safePointCategory,
  readbackPath,
}) {
  return {
    runId,
    directive,
    disposition: mapDisposition(resultCode),
    resultCode,
    reason,
    inspectedState,
    safePointCategory,
    effectiveNow: resultCode === STEERING_RESULT.APPLIED_NOW,
    readbackPath,
    ...(repo && pr ? { target: { repo, pr } } : {}),
  };
}

async function loadStateFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read steering state file '${filePath}': ${error.message}`);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLockMetadata(lockPath) {
  try {
    const text = await readFile(path.join(lockPath, "owner.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function withStateFileLock(filePath, callback) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + STATE_FILE_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new Error(`Failed to acquire steering state lock '${lockPath}': ${error.message}`);
      }
      if (Date.now() >= deadline) {
        const metadata = await readLockMetadata(lockPath);
        const ownerSuffix = metadata
          ? ` (current lock owner pid=${metadata.pid ?? "unknown"}, acquiredAt=${metadata.acquiredAt ?? "unknown"})`
          : "";
        throw new Error(`Timed out waiting for steering state lock '${lockPath}'${ownerSuffix}. If the owning process crashed, remove the stale lock directory and retry.`);
      }
      await sleep(STATE_FILE_LOCK_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function saveStateFile(filePath, steeringState) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(steeringState, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

export async function runSubmit(argv = [], { stdout = process.stdout, cwd = process.cwd() } = {}) {
  const options = parseSubmitCliArgs(argv);

  if (options.help) {
    stdout.write(`${SUBMIT_USAGE}\n`);
    return;
  }

  const runId = resolveRequestedRunId(options, SUBMIT_USAGE);
  const stateFilePath = options.stateFile ?? defaultStateFilePath(runId, cwd);
  const readbackPath = buildReadbackPath({
    repo: options.repo,
    pr: options.pr,
    runId,
    stateFilePath,
  });

  let inspectedState = options.loopState;
  let safePointCategory = classifySafePoint(options.loopState);

  if (options.repo !== undefined && options.pr !== undefined) {
    const inspection = await inspectRun({
      repo: options.repo,
      pr: options.pr,
      steeringStateFile: stateFilePath,
      copilotInputPath: options.copilotInputPath,
      reviewerInputPath: options.reviewerInputPath,
    });

    inspectedState = inspection.layers?.copilot?.currentState;
    safePointCategory = inspectedState ? classifySafePoint(inspectedState) : null;

    if (options.kind !== STEERING_KIND.STOP_AT_NEXT_SAFE_GATE) {
      const acknowledgement = buildAcknowledgement({
        repo: options.repo,
        pr: options.pr,
        runId,
        directive: options.kind,
        resultCode: STEERING_RESULT.REJECTED_INVALID_OR_CONFLICTING,
        reason: "external operator submit accepts only stop_at_next_safe_gate in this first slice",
        inspectedState: inspectedState ?? "unknown",
        safePointCategory,
        readbackPath,
      });
      stdout.write(`${JSON.stringify({ ok: true, acknowledgement })}\n`);
      return;
    }

    if (inspection.statusClass === "unknown" || typeof inspectedState !== "string") {
      const acknowledgement = buildAcknowledgement({
        repo: options.repo,
        pr: options.pr,
        runId,
        directive: options.kind,
        resultCode: STEERING_RESULT.REJECTED_UNSAFE_NOW,
        reason: "target run could not be confidently identified from the inspection snapshot",
        inspectedState: inspectedState ?? "unknown",
        safePointCategory,
        readbackPath,
      });
      stdout.write(`${JSON.stringify({ ok: true, acknowledgement })}\n`);
      return;
    }

    if (inspection.trust === "unavailable") {
      const acknowledgement = buildAcknowledgement({
        repo: options.repo,
        pr: options.pr,
        runId,
        directive: options.kind,
        resultCode: STEERING_RESULT.REJECTED_UNSAFE_NOW,
        reason: "inspection snapshot did not provide sufficient confidence to steer this run",
        inspectedState,
        safePointCategory,
        readbackPath,
      });
      stdout.write(`${JSON.stringify({ ok: true, acknowledgement })}\n`);
      return;
    }
  }

  const { steeringState: newState, result } = await withStateFileLock(stateFilePath, async () => {
    // Load or create steering state
    const raw = await loadStateFile(stateFilePath);
    const steeringState = raw !== null
      ? normalizeSteeringState(raw)
      : createSteeringState(runId);

    // Reject --run-id / --state-file mismatches
    if (raw !== null && steeringState.runId !== runId) {
      throw runIdMismatchError(steeringState.runId, runId);
    }

    // Build and validate the event
    const eventId = options.eventId ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const event = normalizeSteeringEvent({
      eventId,
      runId,
      kind: options.kind,
      directive: options.directive,
      seq: options.seq,
      applyMode: options.applyMode,
      submittedAt: new Date().toISOString(),
    });

    // Submit
    const submission = submitSteering(event, steeringState, inspectedState);

    // Persist atomically while still holding the lock
    await saveStateFile(stateFilePath, submission.steeringState);
    return submission;
  });

  const acknowledgement = buildAcknowledgement({
    repo: options.repo,
    pr: options.pr,
    runId,
    directive: options.kind,
    resultCode: result.result,
    reason: result.reason,
    inspectedState,
    safePointCategory,
    readbackPath,
  });

  stdout.write(`${JSON.stringify({ ok: true, acknowledgement, result, steeringState: newState })}\n`);
}

export async function runStatus(argv = [], { stdout = process.stdout, cwd = process.cwd() } = {}) {
  const options = parseStatusCliArgs(argv);

  if (options.help) {
    stdout.write(`${STATUS_USAGE}\n`);
    return;
  }

  const runId = resolveRequestedRunId(options, STATUS_USAGE);
  const stateFilePath = options.stateFile ?? defaultStateFilePath(runId, cwd);

  const raw = await loadStateFile(stateFilePath);
  if (raw === null) {
    const emptyState = createSteeringState(runId);
    const status = getSteeringStatus(emptyState);
    stdout.write(`${JSON.stringify({ ok: true, status })}\n`);
    return;
  }

  const steeringState = normalizeSteeringState(raw);

  // Reject --run-id / --state-file mismatches
  if (steeringState.runId !== runId) {
    throw runIdMismatchError(steeringState.runId, runId);
  }

  const status = getSteeringStatus(steeringState);
  stdout.write(`${JSON.stringify({ ok: true, status })}\n`);
}

// ---------------------------------------------------------------------------
// Top-level CLI dispatch
// ---------------------------------------------------------------------------

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, cwd = process.cwd() } = {},
) {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    stdout.write(`${TOP_USAGE}\n`);
    return;
  }

  if (subcommand === "submit") {
    return runSubmit(rest, { stdout, cwd });
  }

  if (subcommand === "status") {
    return runStatus(rest, { stdout, cwd });
  }

  const error = parseError(`Unknown subcommand: ${subcommand}`, TOP_USAGE);
  throw error;
}

// ---------------------------------------------------------------------------
// Direct run
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

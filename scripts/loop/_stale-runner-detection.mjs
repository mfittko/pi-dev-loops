/**
 * Deterministic stale-runner + exit-signal detection for the per-PR
 * runner coordination state.
 *
 * Backs `scripts/loop/detect-stale-runner.mjs` (CLI) and the
 * `detect-checkpoint-evidence.mjs` pre-merge guard. Two failure
 * modes are detected:
 *
 * 1. **stale_runner** — the active run's `claimedAt` is older than
 *    `staleRunnerMaxAgeMs` and its `updatedAt` is also older than
 *    `staleRunnerMaxAgeMs`. The merge path must refuse to proceed
 *    because a newer runner should have taken over by now.
 * 2. **exit_signal_recorded** — an exit signal for the active run id
 *    is recorded in `state.exitSignals[]`. The merge path must
 *    refuse to proceed because the run was told to exit.
 *
 * The state file path is exactly the per-PR coordination state at
 * `.pi/runner-coordination/<owner>/<name>/pr-<N>.json`. If the state
 * file is missing there is no active runner to detect, and the
 * detector returns `ok: true` with `status: "no_owner_record"`.
 */
import {
  loadRunnerCoordinationState,
} from "./_pr-runner-coordination.mjs";

export const STALE_RUNNER_ERROR = Object.freeze({
  STALE_RUNNER: "stale_runner",
  EXIT_SIGNAL_RECORDED: "exit_signal_recorded",
});

export const STALE_RUNNER_DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function parsePositiveIntegerMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveStaleRunnerMaxAgeMs(options = {}, env = process.env) {
  const explicit = options?.staleRunnerMaxAgeMs;
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = parsePositiveIntegerMs(env?.PI_DEV_LOOP_STALE_RUNNER_MAX_AGE_MS, NaN);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return STALE_RUNNER_DEFAULT_MAX_AGE_MS;
}

function normalizeRunIdForSignal(runId) {
  return typeof runId === "string" && runId.trim().length > 0 ? runId.trim() : null;
}

function isExitSignalForRun(state, runId) {
  if (!state || !Array.isArray(state.exitSignals) || runId === null) {
    return false;
  }
  return state.exitSignals.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return normalizeRunIdForSignal(entry.runId) === runId;
  });
}

function findStaleRunnerMatch(state, { now, maxAgeMs }) {
  if (!state || !state.activeRun) return null;
  const active = state.activeRun;
  if (!active.runId) return null;
  const claimedAt = typeof active.claimedAt === "string" ? Date.parse(active.claimedAt) : NaN;
  const updatedAt = typeof active.updatedAt === "string" ? Date.parse(active.updatedAt) : NaN;
  if (!Number.isFinite(claimedAt) || !Number.isFinite(updatedAt)) {
    return null;
  }
  const claimedAgeMs = now - claimedAt;
  const updatedAgeMs = now - updatedAt;
  if (claimedAgeMs > maxAgeMs && updatedAgeMs > maxAgeMs) {
    return {
      runId: active.runId,
      claimedAt: active.claimedAt,
      updatedAt: active.updatedAt,
      claimedAgeMs,
      updatedAgeMs,
      maxAgeMs,
    };
  }
  return null;
}

export async function detectStaleRunner({ repo, pr, now = Date.now(), maxAgeMs, cwd = process.cwd() } = {}) {
  if (!repo || typeof repo !== "string") {
    throw new Error("detectStaleRunner requires a non-empty repo slug");
  }
  if (pr === undefined || pr === null) {
    throw new Error("detectStaleRunner requires a PR number");
  }

  const effectiveMaxAgeMs = resolveStaleRunnerMaxAgeMs({ staleRunnerMaxAgeMs: maxAgeMs });
  const loaded = await loadRunnerCoordinationState({ repo, pr, cwd });

  if (loaded.state === null) {
    return {
      ok: true,
      status: "no_owner_record",
      repo,
      pr,
      activeRun: null,
      staleRunner: null,
      exitSignal: null,
      filePath: loaded.filePath,
      maxAgeMs: effectiveMaxAgeMs,
    };
  }

  const state = loaded.state;
  const active = state.activeRun;
  const staleMatch = findStaleRunnerMatch(state, { now, maxAgeMs: effectiveMaxAgeMs });
  const exitSignal = isExitSignalForRun(state, active?.runId ?? null)
    ? {
        runId: active.runId,
        signals: (state.exitSignals || []).filter((entry) =>
          normalizeRunIdForSignal(entry?.runId) === active.runId),
      }
    : null;

  if (exitSignal !== null) {
    return {
      ok: false,
      error: STALE_RUNNER_ERROR.EXIT_SIGNAL_RECORDED,
      status: "exit_signal_recorded",
      repo,
      pr,
      activeRun: active,
      staleRunner: null,
      exitSignal,
      filePath: loaded.filePath,
      maxAgeMs: effectiveMaxAgeMs,
      message: `Run ${active.runId} has an exit signal recorded for ${repo}#${pr}; refuse to proceed with merge.`,
    };
  }

  if (staleMatch !== null) {
    return {
      ok: false,
      error: STALE_RUNNER_ERROR.STALE_RUNNER,
      status: "stale_runner",
      repo,
      pr,
      activeRun: active,
      staleRunner: staleMatch,
      exitSignal: null,
      filePath: loaded.filePath,
      maxAgeMs: effectiveMaxAgeMs,
      message: `Active run ${staleMatch.runId} for ${repo}#${pr} is stale (claimed ${staleMatch.claimedAgeMs}ms ago, last updated ${staleMatch.updatedAgeMs}ms ago, max age ${staleMatch.maxAgeMs}ms).`,
    };
  }

  return {
    ok: true,
    status: "fresh_runner",
    repo,
    pr,
    activeRun: active,
    staleRunner: null,
    exitSignal: null,
    filePath: loaded.filePath,
    maxAgeMs: effectiveMaxAgeMs,
  };
}

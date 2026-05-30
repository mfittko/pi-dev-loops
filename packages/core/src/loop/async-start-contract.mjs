/**
 * Async-start contract enforcement for the dev-loop startup path.
 *
 * This module enforces the requirement that dev-loop execution scripts
 * (outer-loop, watch-cycle, etc.) must run within a visible Pi-managed async
 * context rather than as detached local processes (nohup, disowned shell jobs,
 * tmux/screen sessions, ad hoc while/sleep loops, etc.).
 *
 * The enforcement seam is a startup check that verifies the presence of a
 * Pi async context marker. When the marker is absent, the check fails closed
 * and returns a machine-readable rejection rather than silently proceeding.
 *
 * Pi-managed async context markers (required):
 * - PI_SUBAGENT_RUN_ID env var (set by Pi subagent framework for inspectable async runs)
 *
 * Bypass:
 * - PI_ASYNC_START_BYPASS=1 allows callers to explicitly skip this check
 *   (for development, testing, or explicitly authorized standalone runs)
 * - Snapshot/test mode (when both --copilot-input and --reviewer-input are provided)
 *   implicitly bypasses the check since no real async ownership is needed
 *
 * This module is intentionally pure and side-effect free.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Environment variable names that indicate a Pi-managed async context. */
export const PI_ASYNC_CONTEXT_MARKERS = Object.freeze([
  "PI_SUBAGENT_RUN_ID",
]);

/** Environment variable that bypasses the async-start check. */
export const PI_ASYNC_START_BYPASS_VAR = "PI_ASYNC_START_BYPASS";

/** Async-start validation result status values. */
export const ASYNC_START_STATUS = Object.freeze({
  /** A valid Pi-managed async context was detected. */
  VALID: "valid",
  /** The check was explicitly bypassed via the bypass env var. */
  BYPASSED: "bypassed",
  /** The check was skipped because the caller is in snapshot/test mode. */
  SNAPSHOT_MODE: "snapshot_mode",
  /** No Pi-managed async context was detected; fail closed. */
  REJECTED: "rejected",
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that the current execution context is a visible Pi-managed async run.
 *
 * Returns a result object describing whether the check passed, was bypassed,
 * or was rejected. Callers should treat `rejected` as a hard stop.
 *
 * @param {object} params
 * @param {Record<string, string|undefined>} [params.env] - Environment variables to inspect.
 * @param {boolean} [params.isSnapshotMode] - True when running in snapshot/test input mode.
 * @returns {{ status: string, reason: string, detectedMarker: string|null }}
 */
export function validateAsyncStartContext({
  env = process.env,
  isSnapshotMode = false,
} = {}) {
  // Snapshot/test mode implicitly bypasses — no real async ownership needed
  if (isSnapshotMode) {
    return {
      status: ASYNC_START_STATUS.SNAPSHOT_MODE,
      reason: "Snapshot/test input mode; async-start check not required.",
      detectedMarker: null,
    };
  }

  // Explicit bypass
  if (env[PI_ASYNC_START_BYPASS_VAR] === "1") {
    return {
      status: ASYNC_START_STATUS.BYPASSED,
      reason: `Async-start check explicitly bypassed via ${PI_ASYNC_START_BYPASS_VAR}=1.`,
      detectedMarker: null,
    };
  }

  // Check for any Pi-managed async context marker
  for (const marker of PI_ASYNC_CONTEXT_MARKERS) {
    const value = env[marker];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        status: ASYNC_START_STATUS.VALID,
        reason: `Pi-managed async context detected via ${marker}.`,
        detectedMarker: marker,
      };
    }
  }

  const sessionOnlyMarker =
    (typeof env.PI_SESSION_ID === "string" && env.PI_SESSION_ID.trim().length > 0)
      ? "PI_SESSION_ID"
      : ((typeof env.PI_ASYNC_CONTEXT === "string" && env.PI_ASYNC_CONTEXT.trim().length > 0)
          ? "PI_ASYNC_CONTEXT"
          : null);
  if (sessionOnlyMarker !== null) {
    return {
      status: ASYNC_START_STATUS.REJECTED,
      reason:
        `Detected ${sessionOnlyMarker}, but GitHub-first async-start requires a visible ` +
        "Pi-managed subagent run id for inspectable startup/resume evidence. " +
        "Set PI_SUBAGENT_RUN_ID to proceed.",
      detectedMarker: null,
    };
  }

  if (env.PI_DEV_LOOP_DETACHED === "1") {
    return {
      status: ASYNC_START_STATUS.REJECTED,
      reason:
        "Detected detached local background execution; detached/local fallback is diagnostic-only " +
        "and does not satisfy the async-start contract. Restart via Pi-managed async mode.",
      detectedMarker: null,
    };
  }

  // No marker found — fail closed
  return {
    status: ASYNC_START_STATUS.REJECTED,
    reason:
      "No Pi-managed async context detected. " +
      "The dev-loop must run within a visible Pi async subagent session, " +
      "not as a detached local process. " +
      `Set ${PI_ASYNC_CONTEXT_MARKERS[0]} or ` +
      `${PI_ASYNC_START_BYPASS_VAR}=1 to proceed.`,
    detectedMarker: null,
  };
}

/**
 * Build a fail-closed error payload for rejected async-start validation.
 *
 * This returns the same JSON error shape used by the CLI scripts so callers
 * can emit it on stderr and exit non-zero.
 *
 * @param {{ status: string, reason: string }} validationResult
 * @returns {{ ok: false, error: string, asyncStartContract: string }}
 */
export function buildAsyncStartRejection(validationResult) {
  return {
    ok: false,
    error: validationResult.reason,
    asyncStartContract: "rejected",
  };
}

/**
 * Conductor routing contract: deterministic routing and handoff decisions
 * above family-local state machines.
 *
 * This module provides:
 * - ROUTING_OUTCOME: closed routing outcome taxonomy constants
 * - LOOP_FAMILY: loop family identifier constants
 * - SOURCE_MODE: confidence/source mode constants
 * - ENTRYPOINT: handoff entrypoint identifier constants
 * - evaluateConductorRouting: shared evaluator/policy entrypoint
 *
 * Contract guarantees:
 * - One deterministic routing outcome per normalized input set
 * - Ambiguous, conflicting, or insufficient inputs return `needs_reconcile`
 *   rather than a guessed handoff
 * - The evaluator is purely functional; no I/O or side effects
 * - Callers use evaluateConductorRouting as the single policy entrypoint
 *
 * Integration boundary (see docs/conductor-routing-contract.md):
 * - This module starts after active-run identity and ownership are already resolved
 * - It consumes already-detected family-local lifecycle states as inputs
 * - It emits routing decisions and handoff envelopes; it does not perform handoff
 * - Ownership/idempotency rules remain in conductor-ownership.mjs (#32)
 * - Family-local state machine semantics remain in copilot-loop-state.mjs etc. (#26)
 * - Outer-loop action detection remains in scripts/loop/outer-loop.mjs
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Closed routing outcome taxonomy constants.
 *
 * Covers all possible routing decisions for an already-targeted active run.
 */
export const ROUTING_OUTCOME = Object.freeze({
  /** Outer-loop wait; re-enter after a bounded wait interval. No handoff needed yet. */
  CONTINUE_CURRENT_WAIT: "continue_current_wait",
  /** Copilot inner loop should handle the next step. */
  HANDOFF_TO_COPILOT_LOOP: "handoff_to_copilot_loop",
  /** Reviewer inner loop should handle the next step. */
  HANDOFF_TO_REVIEWER_LOOP: "handoff_to_reviewer_loop",
  /** A live owner already has control; no new handoff is needed at this cycle. */
  STAY_WITH_CURRENT_LIVE_OWNER: "stay_with_current_live_owner",
  /** Blocked state requiring human intervention before any loop can proceed. */
  STOP_NEEDS_HUMAN: "stop_needs_human",
  /** PR is merged, closed, or fully done; no further loop action is needed. */
  DONE_TERMINAL: "done_terminal",
  /** Ambiguous, conflicting, stale, or insufficient signals; reconcile before routing. */
  NEEDS_RECONCILE: "needs_reconcile",
});

/**
 * Loop family identifier constants.
 */
export const LOOP_FAMILY = Object.freeze({
  /** Copilot review/fix inner loop. */
  COPILOT_LOOP: "copilot_loop",
  /** Reviewer-side inner loop. */
  REVIEWER_LOOP: "reviewer_loop",
  /** Outer conductor loop (wait/checkpoint). */
  OUTER_LOOP: "outer_loop",
  /** No loop family (terminal, blocked, or reconcile states). */
  NONE: null,
});

/**
 * Source/confidence mode constants for routing inputs.
 */
export const SOURCE_MODE = Object.freeze({
  /** State derived from authoritative remote signals. */
  AUTHORITATIVE: "authoritative",
  /** State derived from local records only. */
  LOCAL: "local",
  /** State from a pre-captured snapshot (snapshot-mode testing or replay). */
  SNAPSHOT: "snapshot",
});

/**
 * Handoff entrypoint identifier constants.
 *
 * These identify the specific handler/script that the conductor should invoke
 * for each loop family, without requiring prose to restate the branch logic.
 */
export const ENTRYPOINT = Object.freeze({
  /** copilot-pr-handoff.mjs — main copilot loop re-entry handler. */
  COPILOT_PR_HANDOFF: "copilot_pr_handoff",
  /** reviewer loop handler — reviewer-side inner loop re-entry. */
  REVIEWER_LOOP_HANDLER: "reviewer_loop_handler",
  /** outer-loop.mjs — outer wait/checkpoint re-run. */
  OUTER_LOOP_WAIT: "outer_loop_wait",
  /** No automated entrypoint; human intervention required. */
  NONE: null,
});

// ---------------------------------------------------------------------------
// Internal: outer action values consumed from outer-loop outputs
// ---------------------------------------------------------------------------

const OUTER_ACTION = Object.freeze({
  CONTINUE_WAIT: "continue_wait",
  REENTER_COPILOT_LOOP: "reenter_copilot_loop",
  REENTER_REVIEWER_LOOP: "reenter_reviewer_loop",
  STOP: "stop",
  DONE: "done",
});

// Known outer actions set for fast membership test
const KNOWN_OUTER_ACTIONS = new Set(Object.values(OUTER_ACTION));

// Outer-loop stop reasons that indicate reconcile is needed (not human-blocked)
const RECONCILE_STOP_REASONS = new Set(["unknown_state"]);

// ---------------------------------------------------------------------------
// Input normalization helpers
// ---------------------------------------------------------------------------

function normalizeTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const { repo, pr } = target;
  if (typeof repo !== "string" || repo.trim().length === 0) {
    return null;
  }
  if (typeof pr !== "number" || !Number.isInteger(pr) || pr <= 0) {
    return null;
  }
  return { repo: repo.trim().toLowerCase(), pr };
}

function resolveConfidence(sourceMode) {
  if (sourceMode === SOURCE_MODE.AUTHORITATIVE) {
    return SOURCE_MODE.AUTHORITATIVE;
  }
  if (sourceMode === SOURCE_MODE.SNAPSHOT) {
    return SOURCE_MODE.SNAPSHOT;
  }
  return SOURCE_MODE.LOCAL;
}

// ---------------------------------------------------------------------------
// Handoff envelope builder
// ---------------------------------------------------------------------------

/**
 * Build a machine-readable handoff envelope.
 *
 * @param {object} params
 * @returns {object}
 */
function buildEnvelope({
  targetIdentity,
  loopFamily,
  entrypoint,
  reason,
  requiredArgs = {},
  requiresLocalIsolation = false,
  confidence = SOURCE_MODE.LOCAL,
}) {
  return {
    targetIdentity,
    loopFamily,
    entrypoint,
    reason,
    requiredArgs,
    requiresLocalIsolation,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Detect conflicting signals between copilotState, reviewerState, and outerAction.
 *
 * Returns a conflict reason string if conflicting, null if clean.
 *
 * @param {string} copilotState
 * @param {string} reviewerState
 * @param {string} outerAction
 * @returns {string|null}
 */
function detectConflict(copilotState, reviewerState, outerAction) {
  // Unknown outer action — signals cannot be trusted for deterministic routing
  if (!KNOWN_OUTER_ACTIONS.has(outerAction)) {
    return `Unknown outer action '${outerAction}'; cannot route deterministically`;
  }

  // Terminal contradiction: outer says done but copilot state is not done
  if (outerAction === OUTER_ACTION.DONE && copilotState !== "done") {
    return `Outer action 'done' conflicts with copilot state '${copilotState}'; signals are contradictory`;
  }

  // Terminal contradiction: copilot state is done but outer action is not done
  if (copilotState === "done" && outerAction !== OUTER_ACTION.DONE) {
    return `Copilot state 'done' conflicts with outer action '${outerAction}'; signals are contradictory`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared evaluator / policy entrypoint
// ---------------------------------------------------------------------------

/**
 * Evaluate deterministic conductor routing for an already-targeted active run.
 *
 * This is the single policy entrypoint for conductor routing above family-local
 * state machines. Callers must supply already-resolved target identity,
 * already-classified ownership state, and already-detected family-local states.
 *
 * Returns a closed routing outcome and a machine-readable handoff envelope.
 * Ambiguous, conflicting, or insufficient inputs return `needs_reconcile` rather
 * than a guessed handoff.
 *
 * @param {object} input
 * @param {{ repo: string, pr: number }} input.target
 *   Explicit target identity (already resolved by the caller).
 * @param {string} [input.ownershipState]
 *   Settled ownership/idempotency classification from conductor-ownership (#32).
 *   If not provided, routing continues without ownership conflict checks.
 * @param {string} input.copilotState
 *   Already-detected copilot loop lifecycle state (from copilot-loop-state.mjs STATE).
 * @param {string} input.reviewerState
 *   Already-detected reviewer loop lifecycle state (from reviewer-loop-state.mjs REVIEWER_STATE).
 * @param {string} input.outerAction
 *   Outer-loop action decision from outer-loop.mjs
 *   (continue_wait | reenter_copilot_loop | reenter_reviewer_loop | stop | done).
 * @param {string} [input.outerReason]
 *   Outer-loop stop reason (present when outerAction is "stop").
 * @param {string} [input.sourceMode]
 *   Source/confidence mode: "authoritative" | "local" | "snapshot".
 *   Defaults to "local".
 * @param {boolean} [input.requiresLocalIsolation]
 *   Whether the next step requires local mutation/execution in an isolated checkout.
 *   Defaults to false.
 * @returns {{ routingOutcome: string, handoffEnvelope: object }}
 */
export function evaluateConductorRouting({
  target,
  ownershipState,
  copilotState,
  reviewerState,
  outerAction,
  outerReason,
  sourceMode,
  requiresLocalIsolation = false,
}) {
  const confidence = resolveConfidence(sourceMode);

  // --- 1. Validate target identity ---
  const normalizedTarget = normalizeTarget(target);
  if (!normalizedTarget) {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: target ?? null,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: "Target identity is missing or malformed; cannot route without a resolved target",
        confidence,
      }),
    };
  }

  // --- 2. Validate required state inputs ---
  if (typeof copilotState !== "string" || copilotState.trim().length === 0) {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: normalizedTarget,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: "Copilot state is missing or empty; cannot route without family-local state",
        confidence,
      }),
    };
  }

  if (typeof reviewerState !== "string" || reviewerState.trim().length === 0) {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: normalizedTarget,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: "Reviewer state is missing or empty; cannot route without family-local state",
        confidence,
      }),
    };
  }

  if (typeof outerAction !== "string" || outerAction.trim().length === 0) {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: normalizedTarget,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: "Outer action is missing or empty; cannot route without outer-loop decision",
        confidence,
      }),
    };
  }

  // --- 3. Check for ownership conflicts ---
  // duplicate_local_owners is an explicit conflict signal that requires reconcile
  if (ownershipState === "duplicate_local_owners") {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: normalizedTarget,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: "Ownership state indicates duplicate local owners; reconcile ownership before routing",
        requiresLocalIsolation,
        confidence,
      }),
    };
  }

  // --- 4. Detect conflicting inner/outer signals ---
  const conflictReason = detectConflict(copilotState, reviewerState, outerAction);
  if (conflictReason !== null) {
    return {
      routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
      handoffEnvelope: buildEnvelope({
        targetIdentity: normalizedTarget,
        loopFamily: LOOP_FAMILY.NONE,
        entrypoint: ENTRYPOINT.NONE,
        reason: conflictReason,
        requiresLocalIsolation,
        confidence,
      }),
    };
  }

  const baseArgs = { repo: normalizedTarget.repo, pr: normalizedTarget.pr };

  // --- 5. Map outer action to routing outcome + handoff envelope ---
  switch (outerAction) {
    case OUTER_ACTION.DONE:
      return {
        routingOutcome: ROUTING_OUTCOME.DONE_TERMINAL,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.NONE,
          entrypoint: ENTRYPOINT.NONE,
          reason: "PR is merged or closed; conductor loop is complete",
          requiredArgs: baseArgs,
          requiresLocalIsolation,
          confidence,
        }),
      };

    case OUTER_ACTION.CONTINUE_WAIT:
      return {
        routingOutcome: ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.OUTER_LOOP,
          entrypoint: ENTRYPOINT.OUTER_LOOP_WAIT,
          reason: `Outer-loop wait state: copilot_state=${copilotState}, reviewer_state=${reviewerState}`,
          requiredArgs: baseArgs,
          requiresLocalIsolation,
          confidence,
        }),
      };

    case OUTER_ACTION.REENTER_COPILOT_LOOP:
      return {
        routingOutcome: ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.COPILOT_LOOP,
          entrypoint: ENTRYPOINT.COPILOT_PR_HANDOFF,
          reason: `Copilot loop requires action: copilot_state=${copilotState}`,
          requiredArgs: baseArgs,
          requiresLocalIsolation,
          confidence,
        }),
      };

    case OUTER_ACTION.REENTER_REVIEWER_LOOP:
      return {
        routingOutcome: ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.REVIEWER_LOOP,
          entrypoint: ENTRYPOINT.REVIEWER_LOOP_HANDLER,
          reason: `Reviewer loop requires action: reviewer_state=${reviewerState}`,
          requiredArgs: baseArgs,
          requiresLocalIsolation,
          confidence,
        }),
      };

    case OUTER_ACTION.STOP: {
      // unknown_state is a reconcile-needed signal, not a human-blocked stop
      if (RECONCILE_STOP_REASONS.has(outerReason)) {
        return {
          routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
          handoffEnvelope: buildEnvelope({
            targetIdentity: normalizedTarget,
            loopFamily: LOOP_FAMILY.NONE,
            entrypoint: ENTRYPOINT.NONE,
            reason: `Outer loop stopped with unresolvable state (${outerReason}); manual reconcile required`,
            requiredArgs: baseArgs,
            requiresLocalIsolation,
            confidence,
          }),
        };
      }
      return {
        routingOutcome: ROUTING_OUTCOME.STOP_NEEDS_HUMAN,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.NONE,
          entrypoint: ENTRYPOINT.NONE,
          reason: `Loop stopped requiring human intervention: ${outerReason ?? "blocked"}`,
          requiredArgs: baseArgs,
          requiresLocalIsolation,
          confidence,
        }),
      };
    }

    default:
      // Should not be reached — detectConflict already catches unknown outerAction values
      return {
        routingOutcome: ROUTING_OUTCOME.NEEDS_RECONCILE,
        handoffEnvelope: buildEnvelope({
          targetIdentity: normalizedTarget,
          loopFamily: LOOP_FAMILY.NONE,
          entrypoint: ENTRYPOINT.NONE,
          reason: `Unrecognized outer action '${outerAction}'; cannot route deterministically`,
          confidence,
        }),
      };
  }
}

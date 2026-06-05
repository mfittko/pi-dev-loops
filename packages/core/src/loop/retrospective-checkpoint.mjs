/**
 * Post-run behavioral retrospective checkpoint contract.
 *
 * Defines the enforcement seam for the required post-run behavioral retrospective
 * after qualifying async dev-loop completions in this repository.
 *
 * This module is intentionally pure and side-effect free. Callers are responsible
 * for reading/writing the durable checkpoint artifact and passing the resolved
 * checkpoint state to the enforcement gate.
 *
 * Relationship to formal dev mode:
 * - Formal local dev mode is scoped to local implementation/self-improvement work.
 * - The required post-run behavioral retrospective applies to qualifying async
 *   GitHub-first dev-loop completions, independent of whether that run was in
 *   formal local dev mode.
 * - These are related but distinct requirements.
 */

/**
 * Stable state constants for the post-run behavioral retrospective checkpoint.
 *
 * These represent the state that a caller derives from the durable checkpoint
 * artifact on disk, then passes to the enforcement gate.
 *
 * Mapping from durable artifact to checkpoint state:
 * - No artifact file → NONE (no qualifying completion has occurred)
 * - Artifact file with state "required" → MISSING (completion detected, retrospective pending)
 * - Artifact file with state "complete" → COMPLETE (retrospective recorded)
 * - Artifact file with state "skipped" → SKIPPED (explicitly skipped with reason)
 */
export const RETROSPECTIVE_CHECKPOINT_STATE = Object.freeze({
  /** No qualifying async dev-loop completion has occurred; no retrospective is required. */
  NONE: "none",
  /** The required retrospective has been completed and recorded. */
  COMPLETE: "complete",
  /** The required retrospective was explicitly skipped with a stated reason. */
  SKIPPED: "skipped",
  /** A qualifying async dev-loop completion was detected but no retrospective checkpoint exists. */
  MISSING: "missing",
});

/**
 * The set of internal dev-loop strategy gate names that represent qualifying
 * GitHub-first async completions in this repository.
 *
 * A post-run behavioral retrospective is required before the next dev-loop
 * start/resume when the previous run used one of these gates.
 *
 * Qualifying gates:
 * - copilot_pr_followup: Copilot-owned PR follow-up (primary routed GitHub-first path)
 * - issue_intake: Copilot-first issue intake (GitHub-first issue assignment path)
 */
export const RETROSPECTIVE_QUALIFYING_GATES = Object.freeze([
  "copilot_pr_followup",
  "issue_intake",
]);

/**
 * Normalizes an external retrospective checkpoint-state input to one of the
 * stable RETROSPECTIVE_CHECKPOINT_STATE values. Returns null when the value is
 * absent or unrecognized.
 *
 * @param {unknown} value
 * @returns {"none"|"complete"|"skipped"|"missing"|null}
 */
export function normalizeRetrospectiveCheckpointState(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.values(RETROSPECTIVE_CHECKPOINT_STATE).includes(normalized) ? normalized : null;
}

/**
 * Returns true if a routing result represents a qualifying GitHub-first async
 * dev-loop completion that requires a post-run behavioral retrospective before
 * the next start/resume.
 *
 * A qualifying completion is one that:
 * - has a `selectedGate` in RETROSPECTIVE_QUALIFYING_GATES
 * - with `routeKind === "route"` (inspect/status-only results do not qualify)
 */
export function isQualifyingAsyncCompletion(routingResult) {
  if (!routingResult || typeof routingResult !== "object") return false;
  const { routeKind, selectedGate } = routingResult;
  if (routeKind !== "route") {
    return false;
  }
  if (typeof selectedGate !== "string") return false;
  return RETROSPECTIVE_QUALIFYING_GATES.includes(selectedGate);
}

/**
 * Enforcement gate for the required post-run behavioral retrospective.
 *
 * Evaluates whether a proposed dev-loop routing result should proceed or be
 * blocked due to a missing retrospective checkpoint from the previous qualifying
 * async completion.
 *
 * Pass-through cases (proposed routing is returned unchanged):
 * - checkpoint state is NONE (no qualifying completion has happened; no requirement exists)
 * - checkpoint state is COMPLETE (retrospective was recorded; requirement satisfied)
 * - checkpoint state is SKIPPED (explicitly skipped with reason; requirement satisfied)
 * - proposed routing is already a stop or needs_reconcile result
 * - proposed routing is an inspect-only result
 *
 * Fail-closed case:
 * - checkpoint state is MISSING: returns a needs_reconcile result that blocks start/resume
 * - unrecognized checkpoint state: returns a needs_reconcile result
 *
 * @param {object} input
 * @param {string} input.checkpointState - One of the RETROSPECTIVE_CHECKPOINT_STATE values
 * @param {object} input.proposedRouting - The routing result from evaluatePublicDevLoopRouting
 * @returns {object} The original or replacement routing result
 */
export function evaluateRetrospectiveGate({ checkpointState, proposedRouting } = {}) {
  if (!proposedRouting || typeof proposedRouting !== "object") {
    return {
      publicEntrypoint: "dev-loop",
      routeKind: "needs_reconcile",
      selectedGate: "fail_closed_reconcile",
      selectedStrategy: null,
      executionMode: "bounded_handoff",
      waitSemantics: "default",
      canonicalState: null,
      issueAssignmentSeam: "not_applicable",
      nextAction: "Reconcile the retrospective checkpoint state before routing.",
      reason: "Missing or invalid proposed routing result for retrospective gate evaluation.",
    };
  }

  // Already a terminal/inspect result — pass through regardless of checkpoint state.
  if (
    proposedRouting.routeKind === "stop" ||
    proposedRouting.routeKind === "needs_reconcile" ||
    proposedRouting.routeKind === "inspect"
  ) {
    return proposedRouting;
  }

  // No qualifying completion, or retrospective satisfied — pass through.
  if (
    checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.NONE ||
    checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.COMPLETE ||
    checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.SKIPPED
  ) {
    return proposedRouting;
  }

  // Missing retrospective checkpoint — fail closed.
  if (checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.MISSING) {
    return {
      ...proposedRouting,
      routeKind: "needs_reconcile",
      selectedGate: "fail_closed_reconcile",
      selectedStrategy: null,
      waitSemantics: proposedRouting.waitSemantics ?? "default",
      issueAssignmentSeam: proposedRouting.issueAssignmentSeam ?? "not_applicable",
      nextAction:
        "Complete or explicitly skip the required post-run behavioral retrospective before starting or resuming the next dev-loop run.",
      reason:
        "The previous qualifying async dev-loop completion is missing its required behavioral retrospective checkpoint.",
    };
  }

  // Unrecognized checkpoint state — fail closed.
  return {
    ...proposedRouting,
    routeKind: "needs_reconcile",
    selectedGate: "fail_closed_reconcile",
    selectedStrategy: null,
    waitSemantics: proposedRouting.waitSemantics ?? "default",
    issueAssignmentSeam: proposedRouting.issueAssignmentSeam ?? "not_applicable",
    nextAction: "Reconcile the retrospective checkpoint state before routing.",
    reason: `Unrecognized retrospective checkpoint state: "${String(checkpointState)}".`,
  };
}

/**
 * Merge-gate retrospective enforcement.
 *
 * When `workflow.requireRetrospectiveGate` is enabled, the merge path is blocked
 * unless a retrospective checkpoint exists with `mergeApproved: true`.
 *
 * Pass-through cases (proposed routing returned unchanged):
 * - requireRetrospectiveGate is false (gate not enabled)
 * - checkpoint state is COMPLETE and mergeApproved is true
 * - checkpoint state is SKIPPED (explicitly skipped with reason)
 * - proposed routing is already a stop or needs_reconcile result
 *
 * Fail-closed cases:
 * - requireRetrospectiveGate is true and checkpoint state is MISSING or NONE
 * - requireRetrospectiveGate is true and mergeApproved is not true
 * - unrecognized checkpoint state
 *
 * @param {object} input
 * @param {boolean} input.requireRetrospectiveGate
 * @param {string} input.checkpointState - One of RETROSPECTIVE_CHECKPOINT_STATE values
 * @param {boolean|undefined} input.mergeApproved
 * @param {object} input.proposedRouting
 * @returns {object}
 */
export function evaluateRetrospectiveMergeGate({
  requireRetrospectiveGate = false,
  checkpointState,
  mergeApproved,
  proposedRouting,
} = {}) {
  if (!proposedRouting || typeof proposedRouting !== "object") {
    return {
      publicEntrypoint: "dev-loop",
      routeKind: "needs_reconcile",
      selectedGate: "fail_closed_reconcile",
      selectedStrategy: null,
      executionMode: "bounded_handoff",
      waitSemantics: "default",
      canonicalState: null,
      issueAssignmentSeam: "not_applicable",
      nextAction: "Reconcile the retrospective merge-gate state before routing.",
      reason: "Missing or invalid proposed routing result for retrospective merge-gate evaluation.",
    };
  }

  // Already terminal/inspect/stop — pass through regardless.
  if (
    proposedRouting.routeKind === "stop" ||
    proposedRouting.routeKind === "needs_reconcile" ||
    proposedRouting.routeKind === "inspect"
  ) {
    return proposedRouting;
  }

  // Gate not enabled — pass through.
  if (requireRetrospectiveGate !== true) {
    return proposedRouting;
  }

  // Gate enabled — check retrospective state.
  if (
    checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.COMPLETE &&
    mergeApproved === true
  ) {
    return proposedRouting;
  }

  if (checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.SKIPPED) {
    return proposedRouting;
  }

  // Blocked: missing checkpoint, disapproved merge, or unrecognized state.
  const reason =
    checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.MISSING || checkpointState === RETROSPECTIVE_CHECKPOINT_STATE.NONE
      ? "The retrospective merge gate requires a completed retrospective checkpoint before merge; no qualifying retrospective checkpoint exists."
      : mergeApproved !== true
        ? "The retrospective merge gate requires the retrospective to explicitly approve merge (mergeApproved: true); the current retrospective does not approve merge."
        : `Unrecognized retrospective checkpoint state "${String(checkpointState)}" blocks the merge gate.`;

  return {
    ...proposedRouting,
    routeKind: "needs_reconcile",
    selectedGate: "fail_closed_reconcile",
    selectedStrategy: null,
    waitSemantics: proposedRouting.waitSemantics ?? "default",
    issueAssignmentSeam: proposedRouting.issueAssignmentSeam ?? "not_applicable",
    nextAction: "Complete the required retrospective checkpoint with mergeApproved: true before merging.",
    reason,
  };
}

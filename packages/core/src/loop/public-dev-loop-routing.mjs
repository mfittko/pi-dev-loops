import {
  evaluateRetrospectiveGate,
  normalizeRetrospectiveCheckpointState,
} from "./retrospective-checkpoint.mjs";
import {
  EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY,
  PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY,
} from "./timeout-policy.mjs";

/**
 * Public dev-loop façade routing contract.
 *
 * This evaluator models the first-slice public entrypoint contract from issue #86:
 * - one public entrypoint: `dev-loop`
 * - one canonical current-state shape
 * - deterministic routing to internal strategy families
 * - no legacy compatibility entrypoint projection in routed results
 *
 * The evaluator is intentionally pure and side-effect free. It does not inspect
 * GitHub or local state itself; callers may provide the authoritative current
 * state they have already detected, or omit it for explicit start intents where
 * the router can synthesize a minimal canonical state from the requested target.
 */

export const PUBLIC_DEV_LOOP_ENTRYPOINT = "dev-loop";
const COPILOT_ISSUE_ASSIGNEE = "copilot-swe-agent";

export const DEV_LOOP_PUBLIC_INTENT = Object.freeze({
  START_ON_ISSUE: "start_on_issue",
  CONTINUE_ON_PR: "continue_on_pr",
  START_ISSUE_LOCALLY: "start_issue_locally",
  START_ISSUE_LOCALLY_THEN_CONTINUE: "start_issue_locally_then_continue",
  CONTINUE_CURRENT: "continue_current",
  AUTO_CONTINUE_CURRENT: "auto_continue_current",
  INSPECT_STATE: "inspect_state",
});

export const DEV_LOOP_TARGET_KIND = Object.freeze({
  ISSUE: "issue",
  PR: "pr",
  LOCAL_BRANCH: "local_branch",
  LOCAL_PHASE: "local_phase",
});

export const DEV_LOOP_ACTOR = Object.freeze({
  LOCAL: "local",
  COPILOT: "copilot",
  EXTERNAL_HUMAN: "external_human",
  REVIEWER: "reviewer",
  MAINTAINER: "maintainer",
  USER: "user",
});

export const DEV_LOOP_STATUS = Object.freeze({
  ACTIVE: "active",
  WAITING: "waiting",
  BLOCKED: "blocked",
  APPROVAL_READY: "approval_ready",
  MERGE_READY: "merge_ready",
  DONE: "done",
});

export const DEV_LOOP_AUTHORIZATION = Object.freeze({
  AUTHORIZED: "authorized",
  NEEDS_CONFIRMATION: "needs_confirmation",
  NOT_AUTHORIZED: "not_authorized",
});

export const DEV_LOOP_ROUTE_KIND = Object.freeze({
  ROUTE: "route",
  WAIT: "wait",
  STOP: "stop",
  INSPECT: "inspect",
  NEEDS_RECONCILE: "needs_reconcile",
});

export const DEV_LOOP_GATE = Object.freeze({
  STOP_BLOCKED_OR_NOT_AUTHORIZED: "stop_blocked_or_not_authorized",
  STOP_DONE_TERMINAL: "stop_done_terminal",
  FINAL_APPROVAL: "final_approval",
  WAITING_FOR_MERGE_AUTHORIZATION: "waiting_for_merge_authorization",
  WAIT_WATCH: "wait_watch",
  LOCAL_IMPLEMENTATION: "local_implementation",
  ISSUE_INTAKE: "issue_intake",
  EXTERNAL_PR_FOLLOWUP: "external_pr_followup",
  REVIEWER_FIXER: "reviewer_fixer",
  COPILOT_PR_FOLLOWUP: "copilot_pr_followup",
  FAIL_CLOSED_RECONCILE: "fail_closed_reconcile",
});

export const INTERNAL_DEV_LOOP_STRATEGY = Object.freeze({
  LOCAL_IMPLEMENTATION: "local_implementation",
  ISSUE_INTAKE: "issue_intake",
  COPILOT_PR_FOLLOWUP: "copilot_pr_followup",
  EXTERNAL_PR_FOLLOWUP: "external_pr_followup",
  REVIEWER_FIXER: "reviewer_fixer",
  WAIT_WATCH: "wait_watch",
  FINAL_APPROVAL: "final_approval",
  NONE: null,
});

export const DEV_LOOP_ARTIFACT_STATE = Object.freeze({
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
  NOT_APPLICABLE: "not_applicable",
});

export const DEV_LOOP_STATUS_REPORT_KIND = Object.freeze({
  RESOLVED: "resolved",
  NEEDS_RECONCILE: "needs_reconcile",
});

export const DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION = Object.freeze({
  ROUTED_FOLLOWUP: "routed_followup",
  HEALTHY_WAIT: "healthy_wait",
  TERMINAL: "terminal",
  BLOCKED: "blocked",
  AUTHORIZATION_GATED: "authorization_gated",
  RECONCILE: "reconcile",
  INSPECT: "inspect",
});

export const DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND = Object.freeze({
  RESOLVED: "resolved",
  NEEDS_RECONCILE: "needs_reconcile",
});

export const DEV_LOOP_EXECUTION_MODE = Object.freeze({
  BOUNDED_HANDOFF: "bounded_handoff",
  DURABLE_AUTO: "durable_auto",
});

export const DEV_LOOP_WAIT_SEMANTICS = Object.freeze({
  DEFAULT: "default",
  AUTO_HEALTHY_WAIT: "auto_healthy_wait",
});

export const DEV_LOOP_ISSUE_LINKAGE_RESOLUTION = Object.freeze({
  RESOLVED_LINKED_PR: "resolved_linked_pr",
  RESOLVED_NO_OPEN_PR: "resolved_no_open_pr",
  NOT_APPLICABLE: "not_applicable",
});

export const DEV_LOOP_ISSUE_READINESS = Object.freeze({
  READY: "ready",
  NEEDS_CLARIFICATION: "needs_clarification",
  NOT_APPLICABLE: "not_applicable",
});

export const DEV_LOOP_ISSUE_ASSIGNMENT_STATE = Object.freeze({
  UNASSIGNED: "unassigned",
  ASSIGNED_TO_COPILOT: "assigned_to_copilot",
  NOT_APPLICABLE: "not_applicable",
});

export const DEV_LOOP_ISSUE_ASSIGNMENT_SEAM = Object.freeze({
  NEEDS_REFINEMENT: "needs_refinement",
  READY_NEEDS_ASSIGNMENT_CONFIRMATION: "ready_needs_assignment_confirmation",
  READY_ASSIGN_NOW: "ready_assign_now",
  ASSIGNED_TO_COPILOT: "assigned_to_copilot",
  NOT_APPLICABLE: "not_applicable",
});

/**
 * Bounded first-slice target preference values for the `targetPreference` variation parameter.
 *
 * `prefer_local` steers routing toward local implementation when no authoritative
 * PR/linked-PR active-artifact truth has already decided the route.
 * It must not override authoritative state — if the canonical state already resolves
 * to an active PR or linked-PR path, `prefer_local` fails closed instead of silently coercing.
 */
export const DEV_LOOP_TARGET_PREFERENCE = Object.freeze({
  PREFER_GITHUB_FIRST: "prefer_github_first",
  PREFER_LOCAL: "prefer_local",
});

/**
 * First-slice bounded variation parameter contract for the public `dev-loop` entrypoint.
 *
 * Variation parameters may **steer** `dev-loop` behavior, but must not replace
 * authoritative routing. Precedence order (highest to lowest):
 *   1. authoritative current state — primary routing source of truth
 *   2. explicit user intent and API parameters — choose variation mode within the entrypoint
 *   3. settings/preferences — provide defaults only when (1) and (2) have not decided
 *
 * Ambiguous or conflicting parameter combinations fail closed instead of silently
 * overriding authoritative state.
 */
export const DEV_LOOP_VARIATION_PARAMETER_CONTRACT = Object.freeze({
  /** Allowed first-slice variation parameter names. */
  allowedParameters: Object.freeze(["mode", "watch", "intent", "targetPreference"]),
  /** Allowed values for the `mode` parameter. */
  allowedModeValues: Object.freeze([DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO]),
  /** Allowed values for the `targetPreference` parameter. */
  allowedTargetPreferenceValues: Object.freeze(Object.values(DEV_LOOP_TARGET_PREFERENCE)),
  /**
   * Disallowed variation categories for this slice.
   * These must not become public variation knobs.
   */
  disallowedCategories: Object.freeze([
    "arbitrary_ownership_override",
    "arbitrary_strategy_override",
    "arbitrary_gate_override",
    "issue_pr_linkage_bypass",
    "expert_mode_flags",
  ]),
  /**
   * Precedence order for variation inputs (index 0 = highest authority).
   */
  precedenceOrder: Object.freeze([
    "authoritative_current_state",
    "explicit_intent_and_parameters",
    "settings_and_preferences",
  ]),
});

export const PUBLIC_DEV_LOOP_GATE_CONTRACT = Object.freeze([
  Object.freeze({
    gate: DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED,
    routeKind: DEV_LOOP_ROUTE_KIND.STOP,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    summary: "blocked or not-authorized canonical state stops for a human decision",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.STOP_DONE_TERMINAL,
    routeKind: DEV_LOOP_ROUTE_KIND.STOP,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    summary: "done canonical state stops as terminal work",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.FINAL_APPROVAL,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL,
    summary: "approval-ready canonical state routes to final approval; merge-ready routes here only when merge authorization is explicit; requires explicit current-head pre_approval_gate evidence — clean-looking signals are not substitutes",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION,
    routeKind: DEV_LOOP_ROUTE_KIND.STOP,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    summary: "merge-ready canonical state without explicit merge authorization stops and waits for merge authorization",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.WAIT_WATCH,
    routeKind: DEV_LOOP_ROUTE_KIND.WAIT,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
    summary: "waiting canonical state routes to the shared wait/watch strategy",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.LOCAL_IMPLEMENTATION,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
    summary: "local branch or phase canonical state stays on local implementation",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.ISSUE_INTAKE,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
    summary: "issue canonical state without a linked PR routes to issue intake",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
    summary: "external-human PR ownership routes to external PR follow-up",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.REVIEWER_FIXER,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER,
    summary: "reviewer-owned or reviewer-next PR state routes to reviewer/fixer",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
    summary: "Copilot-owned PR state routes to Copilot PR follow-up",
  }),
  Object.freeze({
    gate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    summary: "ambiguous, conflicting, or unsupported canonical state fails closed to reconcile",
  }),
]);

const TARGET_KIND_SET = new Set(Object.values(DEV_LOOP_TARGET_KIND));
const ACTOR_SET = new Set(Object.values(DEV_LOOP_ACTOR));
const STATUS_SET = new Set(Object.values(DEV_LOOP_STATUS));
const AUTHORIZATION_SET = new Set(Object.values(DEV_LOOP_AUTHORIZATION));
const INTENT_SET = new Set(Object.values(DEV_LOOP_PUBLIC_INTENT));
const ARTIFACT_STATE_SET = new Set(Object.values(DEV_LOOP_ARTIFACT_STATE));
const ISSUE_LINKAGE_RESOLUTION_SET = new Set(Object.values(DEV_LOOP_ISSUE_LINKAGE_RESOLUTION));
const ISSUE_READINESS_SET = new Set(Object.values(DEV_LOOP_ISSUE_READINESS));
const ISSUE_ASSIGNMENT_STATE_SET = new Set(Object.values(DEV_LOOP_ISSUE_ASSIGNMENT_STATE));
const VARIATION_MODE_SET = new Set(DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedModeValues);
const TARGET_PREFERENCE_SET = new Set(DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedTargetPreferenceValues);
const GATE_REVIEW_VERDICT_SET = new Set(["clean", "findings_present", "blocked"]);
const ALLOWED_MODE_VALUES_TEXT = DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedModeValues.join(", ");
const ALLOWED_TARGET_PREFERENCE_VALUES_TEXT = DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedTargetPreferenceValues.join(", ");
const LINKED_PR_READY_FOR_FOLLOWUP_LOOP_STATE = "linked_pr_ready_for_followup";
const PRIOR_LINKED_PR_CLOSED_UNMERGED_LOOP_STATE = "prior_linked_pr_closed_unmerged";

function normalizeIntent(intent) {
  const normalized = typeof intent === "string" ? intent.trim().toLowerCase() : "";
  return INTENT_SET.has(normalized) ? normalized : null;
}

function normalizeTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const kind = typeof target.kind === "string" ? target.kind.trim().toLowerCase() : "";
  if (!TARGET_KIND_SET.has(kind)) {
    return null;
  }

  const issue = Number.isInteger(target.issue) && target.issue > 0 ? target.issue : null;
  const hasPr = Object.hasOwn(target, "pr") && target.pr !== null && target.pr !== undefined;
  const pr = Number.isInteger(target.pr) && target.pr > 0 ? target.pr : null;
  const hasLinkedPr = Object.hasOwn(target, "linkedPr") && target.linkedPr !== null && target.linkedPr !== undefined;
  const linkedPr = Number.isInteger(target.linkedPr) && target.linkedPr > 0 ? target.linkedPr : null;
  const branch = typeof target.branch === "string" && target.branch.trim().length > 0 ? target.branch.trim() : null;
  const phase = typeof target.phase === "string" && target.phase.trim().length > 0 ? target.phase.trim() : null;

  if (kind === DEV_LOOP_TARGET_KIND.ISSUE && issue === null) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.ISSUE && hasLinkedPr && linkedPr === null) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.ISSUE && hasPr) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.PR && pr === null) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.PR && hasLinkedPr) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.LOCAL_BRANCH && branch === null) {
    return null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.LOCAL_PHASE && phase === null && issue === null) {
    return null;
  }

  return { kind, issue, pr, linkedPr, branch, phase };
}

function normalizeActor(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ACTOR_SET.has(normalized) ? normalized : null;
}

function normalizeSha(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeGateReviewVerdict(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return GATE_REVIEW_VERDICT_SET.has(normalized) ? normalized : null;
}

function normalizeGateReviewEvidence(evidence) {
  if (evidence === undefined || evidence === null) {
    return null;
  }
  if (typeof evidence !== "object") {
    return null;
  }

  const preApprovalGate = evidence.preApprovalGate;
  if (!preApprovalGate || typeof preApprovalGate !== "object") {
    return null;
  }

  return {
    currentHeadSha: normalizeSha(evidence.currentHeadSha),
    preApprovalGate: {
      visible: preApprovalGate.visible === true,
      headSha: normalizeSha(preApprovalGate.headSha),
      verdict: normalizeGateReviewVerdict(preApprovalGate.verdict),
    },
  };
}

function isFinalApprovalState(canonicalState) {
  return canonicalState.status === DEV_LOOP_STATUS.APPROVAL_READY
    || canonicalState.status === DEV_LOOP_STATUS.MERGE_READY;
}

function hasCleanVisibleCurrentHeadPreApprovalGate(gateReviewEvidence) {
  return gateReviewEvidence !== null
    && gateReviewEvidence.currentHeadSha !== null
    && gateReviewEvidence.preApprovalGate.visible
    && gateReviewEvidence.preApprovalGate.verdict === "clean"
    && gateReviewEvidence.preApprovalGate.headSha === gateReviewEvidence.currentHeadSha;
}

function normalizeState(currentState) {
  if (!currentState || typeof currentState !== "object") {
    return null;
  }

  const target = normalizeTarget(currentState.target);
  const ownership = normalizeActor(currentState.ownership);
  const nextActor = normalizeActor(currentState.nextActor);
  const status = typeof currentState.status === "string" ? currentState.status.trim().toLowerCase() : "";
  const authorization =
    typeof currentState.authorization === "string" ? currentState.authorization.trim().toLowerCase() : "";

  if (!target || !ownership || !nextActor || !STATUS_SET.has(status) || !AUTHORIZATION_SET.has(authorization)) {
    return null;
  }

  return { target, ownership, nextActor, status, authorization };
}

function normalizeArtifactState(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ARTIFACT_STATE_SET.has(normalized) ? normalized : null;
}

function normalizeOptionalLoopState(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0 || normalized.toLowerCase() === "unknown") {
    return null;
  }
  return normalized;
}

function normalizeAsyncRunId(value) {
  const asString = normalizeSha(value);
  if (asString !== null) return asString;
  return null;
}

function normalizeAsyncRun(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (kind !== "pi_managed_run" && kind !== "detached_process") {
    return null;
  }
  const hasInspectionState = value.inspectionState !== undefined && value.inspectionState !== null;
  const inspectionState = hasInspectionState
    ? (typeof value.inspectionState === "string" ? value.inspectionState.trim().toLowerCase() : "")
    : null;
  if (
    hasInspectionState
    && inspectionState !== "visible"
    && inspectionState !== "hidden"
    && inspectionState !== "stale"
    && inspectionState !== "uninspectable"
    && inspectionState !== "missing"
  ) {
    return null;
  }

  return {
    kind,
    runId: normalizeAsyncRunId(value.runId),
    visible: value.visible === true,
    inspectionState,
  };
}

function normalizeIssueLinkageResolution(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ISSUE_LINKAGE_RESOLUTION_SET.has(normalized) ? normalized : null;
}

function normalizeIssueReadiness(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ISSUE_READINESS_SET.has(normalized) ? normalized : null;
}

function normalizeIssueAssignmentState(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ISSUE_ASSIGNMENT_STATE_SET.has(normalized) ? normalized : null;
}

function normalizeVariationMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VARIATION_MODE_SET.has(normalized) ? normalized : null;
}

function normalizeTargetPreference(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TARGET_PREFERENCE_SET.has(normalized) ? normalized : null;
}

function applyRetrospectiveCheckpointGate(result, checkpointState, checkpointStateProvided) {
  if (!checkpointStateProvided) {
    return result;
  }

  return evaluateRetrospectiveGate({
    checkpointState,
    proposedRouting: result,
  });
}

function resolveStopClassification({ selectedGate, routeKind, canonicalState = null }) {
  if (routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE || selectedGate === DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.RECONCILE;
  }

  if (routeKind === DEV_LOOP_ROUTE_KIND.INSPECT) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.INSPECT;
  }

  if (routeKind === DEV_LOOP_ROUTE_KIND.WAIT) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.HEALTHY_WAIT;
  }

  if (selectedGate === DEV_LOOP_GATE.STOP_DONE_TERMINAL || canonicalState?.status === DEV_LOOP_STATUS.DONE) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.TERMINAL;
  }

  if (selectedGate === DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.AUTHORIZATION_GATED;
  }

  if (selectedGate === DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED) {
    return canonicalState?.status === DEV_LOOP_STATUS.BLOCKED
      ? DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.BLOCKED
      : DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.AUTHORIZATION_GATED;
  }

  if (routeKind === DEV_LOOP_ROUTE_KIND.STOP) {
    return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.BLOCKED;
  }

  return DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.ROUTED_FOLLOWUP;
}

function buildContractTrace({
  publicEntrypoint = PUBLIC_DEV_LOOP_ENTRYPOINT,
  selectedGate,
  routeKind,
  selectedStrategy,
  executionMode,
  waitSemantics,
  waitTimeoutPolicy,
  canonicalState,
  reason,
  watchRequested = false,
  boundary = null,
}) {
  const effectiveTimeoutMs = waitTimeoutPolicy?.defaultTimeoutMs ?? null;
  return {
    publicEntrypoint,
    decision: {
      selectedGate,
      routeKind,
      selectedStrategy,
      executionMode,
      watchRequested,
      contractClassification: resolveStopClassification({ selectedGate, routeKind, canonicalState }),
      contractJustification: reason,
    },
    waitStrategy: {
      selectedStrategy: routeKind === DEV_LOOP_ROUTE_KIND.WAIT ? selectedStrategy : null,
      waitSemantics,
      waitMode: routeKind === DEV_LOOP_ROUTE_KIND.WAIT ? "persistent_watch" : "not_applicable",
      timeoutPolicyClassification: waitTimeoutPolicy?.classification ?? null,
      effectiveTimeoutMs,
      effectivePollIntervalMs: null,
    },
    stopReason: {
      classification: resolveStopClassification({ selectedGate, routeKind, canonicalState }),
      terminal: selectedGate === DEV_LOOP_GATE.STOP_DONE_TERMINAL || canonicalState?.status === DEV_LOOP_STATUS.DONE,
      reason,
    },
    stateRefresh: boundary ?? null,
  };
}

function withContractTrace(result, { watchRequested = false, boundary = null } = {}) {
  return {
    ...result,
    contractTrace: buildContractTrace({
      ...result,
      watchRequested,
      boundary,
    }),
  };
}

function buildResult({
  selectedGate,
  routeKind,
  selectedStrategy,
  canonicalState,
  nextAction,
  reason,
  executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  waitSemantics = DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
  waitTimeoutPolicy = null,
  issueAssignmentSeam = DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.NOT_APPLICABLE,
  watchRequested = false,
  contractTraceBoundary = null,
}) {
  return {
    publicEntrypoint: PUBLIC_DEV_LOOP_ENTRYPOINT,
    selectedGate,
    routeKind,
    selectedStrategy,
    executionMode,
    waitSemantics,
    waitTimeoutPolicy,
    canonicalState,
    issueAssignmentSeam,
    nextAction,
    reason,
    contractTrace: buildContractTrace({
      selectedGate,
      routeKind,
      selectedStrategy,
      executionMode,
      waitSemantics,
      waitTimeoutPolicy,
      canonicalState,
      reason,
      watchRequested,
      boundary: contractTraceBoundary,
    }),
  };
}

function buildReconcile(
  reason,
  canonicalState = null,
  executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  { watchRequested = false, contractTraceBoundary = null } = {},
) {
  return buildResult({
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    executionMode,
    canonicalState,
    nextAction: "Stop and reconcile the canonical current state before choosing an internal strategy.",
    reason,
    watchRequested,
    contractTraceBoundary,
  });
}

/**
 * Post-routing validation for the `watch` variation parameter.
 * If watch was explicitly requested, the routed result must be wait/watch-capable
 * before watch semantics can be added.
 * Existing stop and needs_reconcile results are preserved; only otherwise-successful
 * non-wait routed results fail closed.
 */
function applyWatchValidation(result, watchRequested) {
  const refreshBoundary = watchRequested
    ? {
        boundaryKind: "post_watch_or_probe",
        refreshRequired: true,
        refreshReason: result.routeKind === DEV_LOOP_ROUTE_KIND.WAIT
          ? "Wait/watch boundaries are observational only; refresh authoritative state before treating a healthy wait boundary as completion or exit."
          : "Requested watch/probe boundaries still require an authoritative state refresh before classifying the outcome as completion or re-entry.",
      }
    : null;

  if (!watchRequested) return result;
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.WAIT) {
    return withContractTrace(result, { watchRequested, boundary: refreshBoundary });
  }
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) return withContractTrace(result, { watchRequested });
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.STOP) return withContractTrace(result, { watchRequested });
  if (result.selectedGate === DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE) return withContractTrace(result, { watchRequested });
  if (result.selectedGate === DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED) return withContractTrace(result, { watchRequested });
  if (result.selectedGate === DEV_LOOP_GATE.STOP_DONE_TERMINAL) return withContractTrace(result, { watchRequested });
  return buildReconcile(
    "watch requested but the routed result is not eligible for wait/watch semantics.",
    result.canonicalState,
    result.executionMode,
    { watchRequested, contractTraceBoundary: refreshBoundary },
  );
}

function toRoutableCanonicalState(canonicalState) {
  if (canonicalState.target.kind !== DEV_LOOP_TARGET_KIND.ISSUE || canonicalState.target.linkedPr === null) {
    return canonicalState;
  }

  return {
    ...canonicalState,
    target: {
      kind: DEV_LOOP_TARGET_KIND.PR,
      issue: canonicalState.target.issue,
      pr: canonicalState.target.linkedPr,
      linkedPr: null,
      branch: null,
      phase: null,
    },
  };
}

function selectGateForState(canonicalState) {
  if (canonicalState.status === DEV_LOOP_STATUS.BLOCKED || canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NOT_AUTHORIZED) {
    return DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED;
  }

  if (canonicalState.status === DEV_LOOP_STATUS.DONE) {
    return DEV_LOOP_GATE.STOP_DONE_TERMINAL;
  }

  if (
    canonicalState.status === DEV_LOOP_STATUS.MERGE_READY
    && canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION
  ) {
    return DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION;
  }

  if (
    canonicalState.status === DEV_LOOP_STATUS.APPROVAL_READY ||
    canonicalState.status === DEV_LOOP_STATUS.MERGE_READY
  ) {
    return DEV_LOOP_GATE.FINAL_APPROVAL;
  }

  if (canonicalState.status === DEV_LOOP_STATUS.WAITING) {
    return DEV_LOOP_GATE.WAIT_WATCH;
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.LOCAL_BRANCH ||
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.LOCAL_PHASE
  ) {
    return DEV_LOOP_GATE.LOCAL_IMPLEMENTATION;
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE) {
    return DEV_LOOP_GATE.ISSUE_INTAKE;
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR && canonicalState.ownership === DEV_LOOP_ACTOR.EXTERNAL_HUMAN) {
    return DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP;
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR &&
    (canonicalState.ownership === DEV_LOOP_ACTOR.REVIEWER || canonicalState.nextActor === DEV_LOOP_ACTOR.REVIEWER)
  ) {
    return DEV_LOOP_GATE.REVIEWER_FIXER;
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR && canonicalState.ownership === DEV_LOOP_ACTOR.COPILOT) {
    return DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP;
  }

  return DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE;
}

function isCopilotFirstIssueFlow(canonicalState) {
  return canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE && canonicalState.ownership === DEV_LOOP_ACTOR.COPILOT;
}

function shouldAcceptIssueAssignmentFacts({ intent, explicitTarget, explicitState }) {
  if (explicitState) {
    return isCopilotFirstIssueFlow(explicitState) && explicitState.target.linkedPr === null;
  }

  return intent === DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE && explicitTarget?.kind === DEV_LOOP_TARGET_KIND.ISSUE;
}

function buildIssueClarificationStopNextAction(issueNumber) {
  return `Issue #${issueNumber} is not ready yet; ask focused clarification questions and stop before assigning ${COPILOT_ISSUE_ASSIGNEE}.`;
}

function buildIssueAssignmentNowNextAction(issueNumber) {
  return `Issue #${issueNumber} is ready and still unassigned; assign ${COPILOT_ISSUE_ASSIGNEE} now before PR/bootstrap/watch follow-up.`;
}

function buildIssueAssignedContinueNextAction(issueNumber) {
  return `Issue #${issueNumber} is ready and already assigned to ${COPILOT_ISSUE_ASSIGNEE}; continue into PR/bootstrap/watch follow-up work.`;
}

function resolveCopilotFirstIssueAssignmentSeam(canonicalState, issueReadiness, issueAssignmentState) {
  if (issueReadiness === DEV_LOOP_ISSUE_READINESS.NEEDS_CLARIFICATION) {
    return {
      issueAssignmentSeam: DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.NEEDS_REFINEMENT,
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      nextAction: buildIssueClarificationStopNextAction(canonicalState.target.issue),
    };
  }

  if (issueAssignmentState === DEV_LOOP_ISSUE_ASSIGNMENT_STATE.ASSIGNED_TO_COPILOT) {
    return {
      issueAssignmentSeam: DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.ASSIGNED_TO_COPILOT,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      nextAction: buildIssueAssignedContinueNextAction(canonicalState.target.issue),
    };
  }

  if (canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION) {
    return {
      issueAssignmentSeam: DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.READY_NEEDS_ASSIGNMENT_CONFIRMATION,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      nextAction: buildIssueAssignmentConfirmationNextAction(canonicalState.target.issue),
    };
  }

  return {
    issueAssignmentSeam: DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.READY_ASSIGN_NOW,
    routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
    nextAction: buildIssueAssignmentNowNextAction(canonicalState.target.issue),
  };
}

function routeForState(
  canonicalState,
  {
    executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
    issueReadiness = null,
    issueAssignmentState = null,
    gateReviewEvidence = null,
  } = {},
) {
  const routableCanonicalState = toRoutableCanonicalState(canonicalState);
  const selectedGate = selectGateForState(routableCanonicalState);
  if (
    selectedGate === DEV_LOOP_GATE.FINAL_APPROVAL
    && routableCanonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR
    && isFinalApprovalState(routableCanonicalState)
    && !hasCleanVisibleCurrentHeadPreApprovalGate(gateReviewEvidence)
  ) {
    return buildReconcile(
      "Final-approval routing requires explicit current-head `pre_approval_gate` evidence: (1) current head SHA identified, (2) a visible clean `pre_approval_gate` gate-review comment for that exact head SHA. CI green + resolved review threads + clean Copilot rereview are not sufficient substitutes. Do not suggest approval or merge without this proof; rerun the pre_approval_gate and confirm the gate-review comment before continuing.",
      routableCanonicalState,
      executionMode,
    );
  }

  if (selectedGate === DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Stop for a human decision or authorization before continuing the dev loop.",
      reason: "The canonical state is blocked or not authorized for an automated state change.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.STOP_DONE_TERMINAL) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Report the terminal state and wait for a new work item.",
      reason: "The canonical state is already done.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.FINAL_APPROVAL) {
    const approvalNextAction = routableCanonicalState.status === DEV_LOOP_STATUS.APPROVAL_READY
      ? "Run only the final approval step for the current PR; do not treat approval as merge authorization."
      : "Merge is explicitly authorized for the current PR scope; run the final merge step.";
    const approvalReason = routableCanonicalState.status === DEV_LOOP_STATUS.APPROVAL_READY
      ? "Approval-ready states require an explicit approval decision before any merge authorization check."
      : "Merge-ready states with explicit merge authorization may proceed to merge.";
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: approvalNextAction,
      reason: approvalReason,
    });
  }

  if (selectedGate === DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Formal approval is complete; wait for explicit merge authorization for this PR scope before merging. If authorization wording is ambiguous, ask for an explicit merge decision.",
      reason: "Merge-ready states must stop and wait when merge authorization is still missing.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.WAIT_WATCH) {
    const isDurableAuto = executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO;
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.WAIT,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
      executionMode,
      waitSemantics: isDurableAuto
        ? DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT
        : DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
      waitTimeoutPolicy: isDurableAuto
        ? EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY
        : PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY,
      canonicalState: routableCanonicalState,
      nextAction: isDurableAuto
        ? "Remain in durable auto ownership while waiting on the same canonical state; do not escalate timeout/no-activity alone as attention."
        : "Keep waiting or watching against the same canonical state instead of switching public loop names.",
      reason: "Waiting states route to the shared wait/watch strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.LOCAL_IMPLEMENTATION) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the local implementation strategy for the current branch or phase slice.",
      reason: "Local branch/phase targets stay on the local implementation strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.ISSUE_INTAKE) {
    const copilotFirstIssueSeam = isCopilotFirstIssueFlow(routableCanonicalState)
      ? resolveCopilotFirstIssueAssignmentSeam(routableCanonicalState, issueReadiness, issueAssignmentState)
      : {
          issueAssignmentSeam: DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.NOT_APPLICABLE,
          routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
          nextAction: "Normalize the issue, confirm scope, and determine whether an existing PR already exists.",
        };
    return buildResult({
      selectedGate,
      routeKind: copilotFirstIssueSeam.routeKind,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
      executionMode,
      canonicalState: routableCanonicalState,
      issueAssignmentSeam: copilotFirstIssueSeam.issueAssignmentSeam,
      nextAction: copilotFirstIssueSeam.nextAction,
      reason: "Issue targets without a linked PR route to issue intake before PR follow-up.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the external-contributor PR follow-up strategy against the current PR state.",
      reason: "External-human PR ownership routes to the external PR follow-up strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.REVIEWER_FIXER) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the reviewer/fixer strategy for the current PR.",
      reason: "Reviewer-owned or reviewer-next PR states route to the reviewer/fixer strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the Copilot PR follow-up strategy for the current PR.",
      reason: "Copilot-owned PR states route to the Copilot PR follow-up strategy.",
    });
  }

  return buildReconcile(
    "The canonical current state does not map cleanly to any first-slice internal strategy.",
    routableCanonicalState,
    executionMode,
  );
}

function buildStatusArtifactIdentity(canonicalState) {
  return {
    kind: canonicalState.target.kind,
    issue: canonicalState.target.issue,
    pr: canonicalState.target.pr,
    branch: canonicalState.target.branch,
    phase: canonicalState.target.phase,
  };
}

function buildIssueAssignmentConfirmationNextAction(issueNumber) {
  return `Authorize the next mutation: assign ${COPILOT_ISSUE_ASSIGNEE} to issue #${issueNumber} now?`;
}

function buildAuthoritativeStatusNextAction(routed) {
  return routed?.nextAction ?? "Reconcile the current state before answering status.";
}

function buildStatusReconcile(
  reason,
  canonicalState = null,
  nextAction = "Stop and reconcile the authoritative active artifact and current loop state before answering status.",
  executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  waitSemantics = DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
  waitTimeoutPolicy = null,
  asyncRun = null,
  { artifactState = null, loopState = null, issueLinkageResolution = null } = {},
) {
  const result = {
    statusKind: DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE,
    reason,
    activeArtifact: canonicalState ? buildStatusArtifactIdentity(canonicalState) : null,
    artifactState: null,
    loopState: "unknown",
    nextAction,
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    executionMode,
    waitSemantics,
    waitTimeoutPolicy,
    asyncRun,
    canonicalState,
  };
  return {
    ...result,
    contractTrace: buildContractTrace({
      selectedGate: result.selectedGate,
      routeKind: result.routeKind,
      selectedStrategy: result.selectedStrategy,
      executionMode,
      waitSemantics,
      waitTimeoutPolicy,
      canonicalState,
      reason,
      boundary: {
        boundaryKind: "authoritative_status_refresh",
        refreshRequired: true,
        refreshReason: "Status answers are derived from refreshed authoritative state and must fail closed when that refresh cannot justify the stop classification.",
        ...(loopState !== null ? { loopState } : {}),
        ...(artifactState !== null ? { artifactState } : {}),
        ...(issueLinkageResolution !== null ? { issueLinkageResolution } : {}),
      },
    }),
  };
}

function buildStartupResumeBundleReconcile({
  reason,
  canonicalState = null,
  issueLinkageResolution = null,
  artifactState = null,
  loopState = null,
  nextAction = "Stop and reconcile the authoritative startup/resume state before routing or answering status.",
  executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  waitSemantics = DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
  waitTimeoutPolicy = null,
  asyncRun = null,
}) {
  const result = {
    bundleKind: DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE,
    reason,
    activeArtifact: canonicalState ? buildStatusArtifactIdentity(canonicalState) : null,
    artifactState,
    issueLinkageResolution,
    loopState: "unknown",
    nextAction,
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    executionMode,
    waitSemantics,
    waitTimeoutPolicy,
    asyncRun,
    canonicalState,
  };
  return {
    ...result,
    contractTrace: buildContractTrace({
      selectedGate: result.selectedGate,
      routeKind: result.routeKind,
      selectedStrategy: result.selectedStrategy,
      executionMode,
      waitSemantics,
      waitTimeoutPolicy,
      canonicalState,
      reason,
      boundary: {
        boundaryKind: "startup_resume_refresh",
        refreshRequired: true,
        refreshReason: "Startup/resume routing must record the refreshed authoritative state boundary that justified this stop or reconcile decision.",
        ...(loopState !== null ? { loopState } : {}),
        ...(artifactState !== null ? { artifactState } : {}),
        ...(issueLinkageResolution !== null ? { issueLinkageResolution } : {}),
      },
    }),
  };
}

function normalizeIssueLinkageResolutionForBundle(canonicalState, issueLinkageResolution) {
  if (issueLinkageResolution) {
    return issueLinkageResolution;
  }

  if (canonicalState?.target?.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
    return DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE;
  }

  return null;
}

function applyInitialCopilotBootstrapRefreshSeam(canonicalState, issueLinkageResolution, loopState) {
  if (loopState === PRIOR_LINKED_PR_CLOSED_UNMERGED_LOOP_STATE) {
    if (
      canonicalState.target.kind !== DEV_LOOP_TARGET_KIND.ISSUE
      || canonicalState.target.linkedPr !== null
      || issueLinkageResolution !== DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR
      || canonicalState.ownership !== DEV_LOOP_ACTOR.COPILOT
    ) {
      return {
        canonicalState,
        reason:
          "Refreshed `prior_linked_pr_closed_unmerged` state conflicts with authoritative no-open-linked-PR Copilot issue facts; reconcile before routing startup/resume state.",
      };
    }

    return {
      canonicalState,
      reason:
        "Refreshed bootstrap state reports a prior linked PR closed unmerged; reconcile the issue instead of treating it as a healthy bootstrap wait or fresh issue-intake path.",
    };
  }

  if (loopState !== LINKED_PR_READY_FOR_FOLLOWUP_LOOP_STATE) {
    return { canonicalState, reason: null };
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR) {
    return { canonicalState, reason: null };
  }

  if (canonicalState.target.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
    return {
      canonicalState,
      reason:
        "Refreshed `linked_pr_ready_for_followup` state requires a linked PR canonical target; reconcile before routing startup/resume state.",
    };
  }

  if (
    issueLinkageResolution !== DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR
    || canonicalState.target.linkedPr === null
    || canonicalState.ownership !== DEV_LOOP_ACTOR.COPILOT
  ) {
    return {
      canonicalState,
      reason:
        "Refreshed `linked_pr_ready_for_followup` state conflicts with authoritative linked PR follow-up facts; reconcile before routing startup/resume state.",
    };
  }

  return {
    canonicalState: {
      ...canonicalState,
      target: {
        kind: DEV_LOOP_TARGET_KIND.PR,
        issue: canonicalState.target.issue,
        pr: canonicalState.target.linkedPr,
        linkedPr: null,
        branch: null,
        phase: null,
      },
      status: DEV_LOOP_STATUS.ACTIVE,
    },
    reason: null,
  };
}

function isArtifactStateCompatible(canonicalState, artifactState) {
  if (canonicalState.target.kind !== DEV_LOOP_TARGET_KIND.PR) {
    return artifactState === DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE;
  }

  if (canonicalState.status === DEV_LOOP_STATUS.DONE) {
    return artifactState === DEV_LOOP_ARTIFACT_STATE.CLOSED || artifactState === DEV_LOOP_ARTIFACT_STATE.MERGED;
  }

  return artifactState === DEV_LOOP_ARTIFACT_STATE.OPEN;
}

function validateIssueLinkageResolution(canonicalState, issueLinkageResolution) {
  if (canonicalState.target.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
    return issueLinkageResolution === null
      || issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE;
  }

  if (canonicalState.target.linkedPr !== null) {
    return issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR;
  }

  return issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR;
}

export function resolveAuthoritativeStartupResumeBundle(input = {}) {
  const canonicalState = normalizeState(input.currentState);
  const intent = normalizeIntent(input.intent);
  const variationMode = input.mode !== undefined ? normalizeVariationMode(input.mode) : null;
  const requestedExecutionMode =
    variationMode
    ?? (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT
      ? DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO
      : DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF);
  if (!canonicalState) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires a valid canonical current state.",
      executionMode: requestedExecutionMode,
    });
  }

  if (input.intent !== undefined && intent === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid public dev-loop intent.",
      canonicalState,
      executionMode: requestedExecutionMode,
    });
  }

  if (input.mode !== undefined && variationMode === null) {
    return buildStartupResumeBundleReconcile({
      reason: `Authoritative startup/resume routing received an invalid execution mode value; allowed values: ${ALLOWED_MODE_VALUES_TEXT}.`,
      canonicalState,
      executionMode: requestedExecutionMode,
    });
  }

  if (
    intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT
    && variationMode === DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF
  ) {
    return buildStartupResumeBundleReconcile({
      reason: "`mode=bounded_handoff` conflicts with the `auto_continue_current` intent; `auto_continue_current` always uses durable auto execution mode.",
      canonicalState,
      executionMode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    });
  }

  const effectiveMode = intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT
    ? DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO
    : (variationMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF);

  const issueLinkageResolution = normalizeIssueLinkageResolution(input.issueLinkageResolution);
  const issueReadiness = normalizeIssueReadiness(input.issueReadiness);
  const issueAssignmentState = normalizeIssueAssignmentState(input.issueAssignmentState);
  const gateReviewEvidence = normalizeGateReviewEvidence(input.gateReviewEvidence);
  const asyncRunProvided = input.asyncRun !== undefined && input.asyncRun !== null;
  const asyncRun = asyncRunProvided ? normalizeAsyncRun(input.asyncRun) : null;
  const retrospectiveCheckpointState = input.retrospectiveCheckpointState !== undefined
    ? normalizeRetrospectiveCheckpointState(input.retrospectiveCheckpointState)
    : null;
  const retrospectiveCheckpointStateProvided =
    input.retrospectiveCheckpointState !== undefined && input.retrospectiveCheckpointState !== null;
  const issueLinkageResolutionProvided = input.issueLinkageResolution !== undefined && input.issueLinkageResolution !== null;
  const normalizedIssueLinkageResolution = normalizeIssueLinkageResolutionForBundle(canonicalState, issueLinkageResolution);
  const issueReadinessProvided = input.issueReadiness !== undefined && input.issueReadiness !== null;
  const issueAssignmentStateProvided = input.issueAssignmentState !== undefined && input.issueAssignmentState !== null;
  const loopState = normalizeOptionalLoopState(input.loopState);

  if (asyncRunProvided && asyncRun === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid async-run registration value.",
      canonicalState,
      executionMode: effectiveMode,
    });
  }

  if (issueLinkageResolutionProvided && issueLinkageResolution === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid issue↔PR linkage resolution value.",
      canonicalState,
      issueLinkageResolution: null,
    });
  }

  if (issueReadinessProvided && issueReadiness === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid issue readiness value.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  if (issueAssignmentStateProvided && issueAssignmentState === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid issue assignment-state value.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  if (retrospectiveCheckpointStateProvided && retrospectiveCheckpointState === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid retrospective checkpoint-state value.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  if (loopState === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires an explicit resolved loop state before routing or answering status.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState: normalizeArtifactState(input.artifactState),
      loopState,
    });
  }

  const bootstrapRefresh = applyInitialCopilotBootstrapRefreshSeam(
    canonicalState,
    issueLinkageResolution,
    loopState,
  );
  if (bootstrapRefresh.reason !== null) {
    return buildStartupResumeBundleReconcile({
      reason: bootstrapRefresh.reason,
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState: normalizeArtifactState(input.artifactState),
      loopState,
    });
  }
  const canonicalStateForRouting = bootstrapRefresh.canonicalState;

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && issueLinkageResolution === null
  ) {
    return buildStartupResumeBundleReconcile({
      reason: "Issue targets require explicit authoritative issue↔PR linkage resolution before routing startup/resume state.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      loopState,
    });
  }

  if (!validateIssueLinkageResolution(canonicalState, issueLinkageResolution)) {
    return buildStartupResumeBundleReconcile({
      reason: "Issue↔PR linkage resolution is incomplete or conflicts with canonical current state; reconcile before routing startup/resume state.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      loopState,
    });
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && canonicalState.ownership === DEV_LOOP_ACTOR.COPILOT
    && issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR
  ) {
    if (!issueReadinessProvided) {
      return buildStartupResumeBundleReconcile({
        reason: "Copilot-first issue targets require explicit authoritative issue readiness before assignment/routing decisions.",
        canonicalState,
        issueLinkageResolution: normalizedIssueLinkageResolution,
        loopState,
      });
    }

    if (!issueAssignmentStateProvided) {
      return buildStartupResumeBundleReconcile({
        reason: "Copilot-first issue targets require explicit authoritative issue assignment state before assignment/routing decisions.",
        canonicalState,
        issueLinkageResolution: normalizedIssueLinkageResolution,
        loopState,
      });
    }
  }

  const routed = routeForState(canonicalStateForRouting, {
    executionMode: effectiveMode,
    issueReadiness,
    issueAssignmentState,
    gateReviewEvidence,
  });
  if (routed.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) {
    return buildStartupResumeBundleReconcile({
      reason: routed.reason,
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      executionMode: routed.executionMode,
      waitSemantics: routed.waitSemantics,
      loopState,
    });
  }

  const artifactState = normalizeArtifactState(input.artifactState);
  if (!artifactState) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires an explicit artifact state (open|closed|merged|not_applicable).",
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState: null,
      loopState,
    });
  }

  if (!isArtifactStateCompatible(routed.canonicalState, artifactState)) {
    return buildStartupResumeBundleReconcile({
      reason: "Canonical current state conflicts with the provided artifact state; reconcile before routing startup/resume state.",
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState,
      loopState,
    });
  }

  const inspectStateIntent = intent === DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE;
  const routedWithIntentSemantics = inspectStateIntent
    ? {
        ...routed,
        routeKind: DEV_LOOP_ROUTE_KIND.INSPECT,
        nextAction: "Describe the canonical state and the routed internal strategy without changing public entrypoints.",
      }
    : routed;
  const effectiveRouted = applyRetrospectiveCheckpointGate(
    routedWithIntentSemantics,
    retrospectiveCheckpointState,
    retrospectiveCheckpointStateProvided,
  );

  if (effectiveRouted.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) {
    return buildStartupResumeBundleReconcile({
      reason: effectiveRouted.reason,
      canonicalState: effectiveRouted.canonicalState ?? routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState,
      nextAction: effectiveRouted.nextAction,
      executionMode: effectiveRouted.executionMode,
      waitSemantics: effectiveRouted.waitSemantics,
      waitTimeoutPolicy: effectiveRouted.waitTimeoutPolicy,
      asyncRun,
      loopState,
    });
  }

  if (effectiveRouted.executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO) {
    const asyncRunInspectionState = asyncRun?.inspectionState;
    if (
      !asyncRunProvided
      || asyncRun?.kind !== "pi_managed_run"
      || asyncRun.runId === null
      || asyncRun.visible !== true
      || asyncRunInspectionState === "uninspectable"
      || asyncRunInspectionState === "hidden"
      || asyncRunInspectionState === "stale"
    ) {
      return buildStartupResumeBundleReconcile({
        reason: asyncRun?.kind === "detached_process"
          ? "Durable auto startup/resume requires a visible Pi-managed async run; detached local background processes do not satisfy the async-start contract."
          : asyncRunInspectionState === "uninspectable"
            ? "Durable auto startup/resume requires inspectable Pi-managed async evidence; observed run is uninspectable (no child message route registered)."
            : asyncRunInspectionState === "hidden"
              ? "Durable auto startup/resume requires visible Pi-managed async evidence; observed run evidence is hidden."
              : asyncRunInspectionState === "stale"
                ? "Durable auto startup/resume requires fresh Pi-managed async evidence; observed run evidence is stale."
          : "Durable auto startup/resume requires a visible registered Pi-managed async run id before startup can be reported as successful.",
        canonicalState: effectiveRouted.canonicalState,
        issueLinkageResolution: normalizedIssueLinkageResolution,
        artifactState,
        executionMode: effectiveRouted.executionMode,
        waitSemantics: effectiveRouted.waitSemantics,
        waitTimeoutPolicy: effectiveRouted.waitTimeoutPolicy,
        asyncRun,
      });
    }
  }

  return {
    bundleKind: DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED,
    activeArtifact: buildStatusArtifactIdentity(effectiveRouted.canonicalState),
    artifactState,
    issueLinkageResolution: normalizedIssueLinkageResolution,
    canonicalState: effectiveRouted.canonicalState,
    loopState,
    routeKind: effectiveRouted.routeKind,
    selectedGate: effectiveRouted.selectedGate,
    selectedStrategy: effectiveRouted.selectedStrategy,
    executionMode: effectiveRouted.executionMode,
    waitSemantics: effectiveRouted.waitSemantics,
    waitTimeoutPolicy: effectiveRouted.waitTimeoutPolicy,
    asyncRun: effectiveRouted.executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO ? asyncRun : null,
    issueAssignmentSeam: effectiveRouted.issueAssignmentSeam,
    nextAction: buildAuthoritativeStatusNextAction(effectiveRouted),
    reason: effectiveRouted.reason,
    contractTrace: buildContractTrace({
      selectedGate: effectiveRouted.selectedGate,
      routeKind: effectiveRouted.routeKind,
      selectedStrategy: effectiveRouted.selectedStrategy,
      executionMode: effectiveRouted.executionMode,
      waitSemantics: effectiveRouted.waitSemantics,
      waitTimeoutPolicy: effectiveRouted.waitTimeoutPolicy,
      canonicalState: effectiveRouted.canonicalState,
      reason: effectiveRouted.reason,
      boundary: {
        boundaryKind: "startup_resume_refresh",
        refreshRequired: true,
        refreshReason: "Startup/resume answers record the authoritative refreshed loop state that justified the routed path.",
        loopState,
        artifactState,
        issueLinkageResolution: normalizedIssueLinkageResolution,
      },
    }),
  };
}

export function resolveAuthoritativeDevLoopStatus(input = {}) {
  const { intent: _ignoredIntent, ...statusInput } = input;
  const bundle = resolveAuthoritativeStartupResumeBundle(statusInput);
  if (bundle.bundleKind === DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE) {
    return buildStatusReconcile(
      bundle.reason,
      bundle.canonicalState,
      bundle.nextAction,
      bundle.executionMode,
      bundle.waitSemantics,
      bundle.waitTimeoutPolicy,
      bundle.asyncRun,
      {
        artifactState: bundle.contractTrace?.stateRefresh?.artifactState ?? bundle.artifactState,
        loopState: bundle.contractTrace?.stateRefresh?.loopState ?? bundle.loopState,
        issueLinkageResolution: bundle.contractTrace?.stateRefresh?.issueLinkageResolution ?? bundle.issueLinkageResolution,
      },
    );
  }

  const result = {
    statusKind: DEV_LOOP_STATUS_REPORT_KIND.RESOLVED,
    activeArtifact: bundle.activeArtifact,
    artifactState: bundle.artifactState,
    loopState: bundle.loopState,
    nextAction: bundle.nextAction,
    selectedGate: bundle.selectedGate,
    routeKind: bundle.routeKind,
    selectedStrategy: bundle.selectedStrategy,
    executionMode: bundle.executionMode,
    waitSemantics: bundle.waitSemantics,
    waitTimeoutPolicy: bundle.waitTimeoutPolicy,
    asyncRun: bundle.asyncRun,
    issueAssignmentSeam: bundle.issueAssignmentSeam,
    canonicalState: bundle.canonicalState,
    reason: bundle.reason,
  };

  return {
    ...result,
    contractTrace: buildContractTrace({
      selectedGate: result.selectedGate,
      routeKind: result.routeKind,
      selectedStrategy: result.selectedStrategy,
      executionMode: result.executionMode,
      waitSemantics: result.waitSemantics,
      waitTimeoutPolicy: result.waitTimeoutPolicy,
      canonicalState: result.canonicalState,
      reason: result.reason,
      boundary: {
        boundaryKind: "authoritative_status_refresh",
        refreshRequired: true,
        refreshReason: "Status answers record the authoritative refreshed loop state that justified the reported state.",
        loopState: result.loopState,
        artifactState: result.artifactState,
        issueLinkageResolution: bundle.issueLinkageResolution,
      },
    }),
  };
}

export function evaluatePublicDevLoopRouting(input = {}) {
  const intent = normalizeIntent(input.intent);
  const explicitTarget = normalizeTarget(input.target);
  const explicitState = normalizeState(input.currentState);

  // ── Variation parameters (first-slice bounded contract) ──────────────────
  const variationMode = input.mode !== undefined ? normalizeVariationMode(input.mode) : null;
  const watchProvided = input.watch !== undefined;
  const watchRequested = input.watch === true;
  const targetPreference = input.targetPreference !== undefined ? normalizeTargetPreference(input.targetPreference) : null;

  // These are authoritative issue-state facts for the Copilot-first
  // unassigned-issue seam, not bounded public variation parameters.
  const issueReadiness = input.issueReadiness !== undefined ? normalizeIssueReadiness(input.issueReadiness) : null;
  const issueAssignmentState = input.issueAssignmentState !== undefined
    ? normalizeIssueAssignmentState(input.issueAssignmentState)
    : null;
  const gateReviewEvidence = normalizeGateReviewEvidence(input.gateReviewEvidence);
  const acceptsIssueAssignmentFacts = shouldAcceptIssueAssignmentFacts({ intent, explicitTarget, explicitState });
  const retrospectiveCheckpointState = input.retrospectiveCheckpointState !== undefined
    ? normalizeRetrospectiveCheckpointState(input.retrospectiveCheckpointState)
    : null;
  const retrospectiveCheckpointStateProvided =
    input.retrospectiveCheckpointState !== undefined && input.retrospectiveCheckpointState !== null;
  const requestedExecutionMode =
    variationMode
    ?? (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT
      ? DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO
      : DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF);

  // Fail closed on unrecognized variation parameter values
  if (input.mode !== undefined && variationMode === null) {
    return buildReconcile(`Unrecognized \`mode\` parameter; allowed values: ${ALLOWED_MODE_VALUES_TEXT}.`, null, requestedExecutionMode);
  }
  if (input.targetPreference !== undefined && targetPreference === null) {
    return buildReconcile(`Unrecognized \`targetPreference\` parameter; allowed values: ${ALLOWED_TARGET_PREFERENCE_VALUES_TEXT}.`, null, requestedExecutionMode);
  }
  if (watchProvided && typeof input.watch !== "boolean") {
    return buildReconcile("Unrecognized `watch` parameter; allowed values: true or false.", null, requestedExecutionMode);
  }
  if (acceptsIssueAssignmentFacts && input.issueReadiness !== undefined && issueReadiness === null) {
    return buildReconcile(
      `Unrecognized \`issueReadiness\` input; allowed values: ${Object.values(DEV_LOOP_ISSUE_READINESS).join(", ")}.`,
      null,
      requestedExecutionMode,
    );
  }
  if (acceptsIssueAssignmentFacts && input.issueAssignmentState !== undefined && issueAssignmentState === null) {
    return buildReconcile(
      `Unrecognized \`issueAssignmentState\` input; allowed values: ${Object.values(DEV_LOOP_ISSUE_ASSIGNMENT_STATE).join(", ")}.`,
      null,
      requestedExecutionMode,
    );
  }

  if (retrospectiveCheckpointStateProvided && retrospectiveCheckpointState === null) {
    return buildReconcile(
      "Unrecognized `retrospectiveCheckpointState` input; allowed values: none, complete, skipped, missing.",
      null,
      requestedExecutionMode,
    );
  }

  const routingOptions = {
    executionMode: null,
    issueReadiness: acceptsIssueAssignmentFacts ? issueReadiness : null,
    issueAssignmentState: acceptsIssueAssignmentFacts ? issueAssignmentState : null,
    gateReviewEvidence,
  };

  const finalizeRoutingResult = (result) => {
    const gated = applyRetrospectiveCheckpointGate(
      result,
      retrospectiveCheckpointState,
      retrospectiveCheckpointStateProvided,
    );

    return withContractTrace(gated, {
      watchRequested,
      boundary: gated.contractTrace?.stateRefresh ?? result.contractTrace?.stateRefresh ?? null,
    });
  };

  if (!intent) {
    return buildReconcile("The public dev-loop intent is missing or unrecognized.", null, requestedExecutionMode);
  }

  // ── Resolve effective execution mode ─────────────────────────────────────
  // Precedence: authoritative intent (auto_continue_current) > explicit mode > default
  let effectiveMode;
  if (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT) {
    if (variationMode === DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF) {
      return buildReconcile(
        "`mode=bounded_handoff` conflicts with the `auto_continue_current` intent; `auto_continue_current` always uses durable auto execution mode.",
        explicitState,
        DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
      );
    }
    effectiveMode = DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO;
  } else {
    effectiveMode = variationMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF;
  }

  if (variationMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO && !explicitState) {
    return buildReconcile(
      "`mode=durable_auto` requires a valid authoritative current state.",
      null,
      DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (intent === DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE) {
    if (!explicitState) {
      return buildReconcile("`inspect_state` requires a valid canonical current state.", null, effectiveMode);
    }

    const routed = routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode });
    return finalizeRoutingResult(applyWatchValidation({
      ...routed,
      routeKind: DEV_LOOP_ROUTE_KIND.INSPECT,
      nextAction: "Describe the canonical state and the routed internal strategy without changing public entrypoints.",
    }, watchRequested));
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
      return buildReconcile("`start_on_issue` requires an issue target.", null, effectiveMode);
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildReconcile("`start_on_issue` received an invalid canonical current state.", null, effectiveMode);
    }

    if (explicitState) {
      if (explicitState.target.issue !== explicitTarget.issue) {
        return buildReconcile("`start_on_issue` target conflicts with the canonical current state.", explicitState, effectiveMode);
      }

      // targetPreference=prefer_local must not override authoritative linked-PR or PR state
      if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
        const isLinkedPrState =
          explicitState.target.kind === DEV_LOOP_TARGET_KIND.PR ||
          (explicitState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE && explicitState.target.linkedPr !== null);
        if (isLinkedPrState) {
          return buildReconcile(
            "`targetPreference=prefer_local` conflicts with authoritative PR/linked-PR active artifact state; reconcile before overriding the routed path.",
            explicitState,
            effectiveMode,
          );
        }
      }

      return finalizeRoutingResult(applyWatchValidation(
        routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode }),
        watchRequested,
      ));
    }

    // No canonical state: steer toward local when prefer_local is requested
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      return finalizeRoutingResult(applyWatchValidation(
        routeForState({
          target: {
            kind: DEV_LOOP_TARGET_KIND.LOCAL_PHASE,
            issue: explicitTarget.issue,
            pr: null,
            linkedPr: null,
            branch: null,
            phase: `issue-${explicitTarget.issue}`,
          },
          ownership: DEV_LOOP_ACTOR.LOCAL,
          nextActor: DEV_LOOP_ACTOR.LOCAL,
          status: DEV_LOOP_STATUS.ACTIVE,
          authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
        }, { ...routingOptions, executionMode: effectiveMode }),
        watchRequested,
      ));
    }

    return finalizeRoutingResult(applyWatchValidation(
      routeForState({
        target: explicitTarget,
        ownership: DEV_LOOP_ACTOR.COPILOT,
        nextActor: DEV_LOOP_ACTOR.USER,
        status: DEV_LOOP_STATUS.ACTIVE,
        authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
      }, { ...routingOptions, executionMode: effectiveMode }),
      watchRequested,
    ));
  }

  if (
    intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY ||
    intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE
  ) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
      return buildReconcile("Local issue-start intents require an issue target.", null, effectiveMode);
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildReconcile("Local issue-start intents received an invalid canonical current state.", null, effectiveMode);
    }

    if (explicitState) {
      if (
        explicitState.target.kind !== DEV_LOOP_TARGET_KIND.LOCAL_PHASE ||
        explicitState.target.issue !== explicitTarget.issue
      ) {
        return buildReconcile("Local issue-start target conflicts with the canonical current state.", explicitState, effectiveMode);
      }
      return finalizeRoutingResult(applyWatchValidation(
        routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode }),
        watchRequested,
      ));
    }

    const routed = routeForState({
      target: {
        kind: DEV_LOOP_TARGET_KIND.LOCAL_PHASE,
        issue: explicitTarget.issue,
        pr: null,
        linkedPr: null,
        branch: null,
        phase: `issue-${explicitTarget.issue}`,
      },
      ownership: DEV_LOOP_ACTOR.LOCAL,
      nextActor: DEV_LOOP_ACTOR.LOCAL,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    }, { ...routingOptions, executionMode: effectiveMode });

    const routedWithContinueAction = intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE
      ? {
          ...routed,
          nextAction:
            "Start with the local implementation strategy now, then re-enter the same public `dev-loop` entrypoint against the updated canonical state.",
        }
      : routed;

    return finalizeRoutingResult(applyWatchValidation(routedWithContinueAction, watchRequested));
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.PR) {
      return buildReconcile("`continue_on_pr` requires a PR target.", null, effectiveMode);
    }
    if (!explicitState || explicitState.target.kind !== DEV_LOOP_TARGET_KIND.PR) {
      return buildReconcile("`continue_on_pr` requires a valid canonical PR state.", explicitState, effectiveMode);
    }
    if (explicitState.target.pr !== explicitTarget.pr) {
      return buildReconcile("`continue_on_pr` target conflicts with the canonical current PR state.", explicitState, effectiveMode);
    }

    // targetPreference=prefer_local must not override an active PR artifact
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      return buildReconcile(
        "`targetPreference=prefer_local` conflicts with authoritative PR/linked-PR active artifact state; reconcile before overriding the routed path.",
        explicitState,
        effectiveMode,
      );
    }

    return finalizeRoutingResult(applyWatchValidation(
      routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode }),
      watchRequested,
    ));
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile("`continue_current` requires a valid canonical current state.", null, effectiveMode);
    }

    // targetPreference=prefer_local must not override an active PR artifact or linked-PR state
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      const isLinkedPrState =
        explicitState.target.kind === DEV_LOOP_TARGET_KIND.PR ||
        (explicitState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE && explicitState.target.linkedPr !== null);
      if (isLinkedPrState) {
        return buildReconcile(
          "`targetPreference=prefer_local` conflicts with authoritative PR/linked-PR active artifact state; reconcile before overriding the routed path.",
          explicitState,
          effectiveMode,
        );
      }
    }

    return finalizeRoutingResult(applyWatchValidation(
      routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode }),
      watchRequested,
    ));
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile(
        "`auto_continue_current` requires a valid canonical current state.",
        null,
        DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
      );
    }
    return finalizeRoutingResult(applyWatchValidation(
      routeForState(explicitState, { ...routingOptions, executionMode: effectiveMode }),
      watchRequested,
    ));
  }

  return buildReconcile("The public dev-loop intent is recognized but not implemented in this first slice.", null, effectiveMode);
}

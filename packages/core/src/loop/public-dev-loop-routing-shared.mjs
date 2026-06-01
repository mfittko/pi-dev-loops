import { evaluateRetrospectiveGate } from "./retrospective-checkpoint.mjs";
import {
  EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY,
  PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY,
} from "./timeout-policy.mjs";
import {
  DEV_LOOP_ACTOR,
  DEV_LOOP_ARTIFACT_STATE,
  DEV_LOOP_AUTHORIZATION,
  DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION,
  DEV_LOOP_EXECUTION_MODE,
  DEV_LOOP_GATE,
  DEV_LOOP_ISSUE_ASSIGNMENT_SEAM,
  DEV_LOOP_ISSUE_ASSIGNMENT_STATE,
  DEV_LOOP_ISSUE_LINKAGE_RESOLUTION,
  DEV_LOOP_ISSUE_READINESS,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND,
  DEV_LOOP_STATUS,
  DEV_LOOP_STATUS_REPORT_KIND,
  DEV_LOOP_TARGET_KIND,
  DEV_LOOP_TARGET_PREFERENCE,
  DEV_LOOP_VARIATION_PARAMETER_CONTRACT,
  DEV_LOOP_WAIT_SEMANTICS,
  INTERNAL_DEV_LOOP_STRATEGY,
  PUBLIC_DEV_LOOP_ENTRYPOINT,
} from "./public-dev-loop-routing-contract.mjs";

const COPILOT_ISSUE_ASSIGNEE = "copilot-swe-agent";

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
      nextAction: "Run the Copilot PR follow-up strategy for the current PR; treat it as the canonical artifact for the issue and do not open a second PR.",
      reason: "Copilot-owned PR states route to the Copilot PR follow-up strategy; an already-open linked PR must stay canonical until reconciled.",
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


export {
  ALLOWED_MODE_VALUES_TEXT,
  ALLOWED_TARGET_PREFERENCE_VALUES_TEXT,
  LINKED_PR_READY_FOR_FOLLOWUP_LOOP_STATE,
  PRIOR_LINKED_PR_CLOSED_UNMERGED_LOOP_STATE,
  applyRetrospectiveCheckpointGate,
  applyWatchValidation,
  buildAuthoritativeStatusNextAction,
  buildContractTrace,
  buildReconcile,
  buildResult,
  buildStatusArtifactIdentity,
  normalizeArtifactState,
  normalizeAsyncRun,
  normalizeGateReviewEvidence,
  normalizeIntent,
  normalizeIssueAssignmentState,
  normalizeIssueLinkageResolution,
  normalizeIssueReadiness,
  normalizeOptionalLoopState,
  normalizeState,
  normalizeTarget,
  normalizeTargetPreference,
  normalizeVariationMode,
  routeForState,
  shouldAcceptIssueAssignmentFacts,
  withContractTrace,
};

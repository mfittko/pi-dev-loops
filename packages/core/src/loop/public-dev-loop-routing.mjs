/**
 * Public dev-loop façade routing contract.
 *
 * This evaluator models the first-slice public entrypoint contract from issue #86:
 * - one public entrypoint: `dev-loop`
 * - one canonical current-state shape
 * - deterministic routing to internal strategy families
 * - explicit compatibility entrypoints for existing specialized skills
 *
 * The evaluator is intentionally pure and side-effect free. It does not inspect
 * GitHub or local state itself; callers may provide the authoritative current
 * state they have already detected, or omit it for explicit start intents where
 * the router can synthesize a minimal canonical state from the requested target.
 */

export const PUBLIC_DEV_LOOP_ENTRYPOINT = "dev-loop";

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

export const COMPATIBILITY_ENTRYPOINT = Object.freeze({
  DEV_LOOP: "dev-loop",
  COPILOT_DEV_LOOP: "copilot-dev-loop",
  COPILOT_AUTOPILOT: "copilot-autopilot",
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
    summary: "approval-ready or merge-ready canonical state routes to final approval",
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
const VARIATION_MODE_SET = new Set(DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedModeValues);
const TARGET_PREFERENCE_SET = new Set(DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedTargetPreferenceValues);
const ALLOWED_MODE_VALUES_TEXT = DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedModeValues.join(", ");
const ALLOWED_TARGET_PREFERENCE_VALUES_TEXT = DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedTargetPreferenceValues.join(", ");

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

function normalizeIssueLinkageResolution(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ISSUE_LINKAGE_RESOLUTION_SET.has(normalized) ? normalized : null;
}

function normalizeVariationMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VARIATION_MODE_SET.has(normalized) ? normalized : null;
}

function normalizeTargetPreference(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TARGET_PREFERENCE_SET.has(normalized) ? normalized : null;
}

function buildResult({
  selectedGate,
  routeKind,
  selectedStrategy,
  compatibilityEntrypoint,
  canonicalState,
  nextAction,
  reason,
  executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  waitSemantics = DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
}) {
  return {
    publicEntrypoint: PUBLIC_DEV_LOOP_ENTRYPOINT,
    selectedGate,
    routeKind,
    selectedStrategy,
    compatibilityEntrypoint,
    executionMode,
    waitSemantics,
    canonicalState,
    nextAction,
    reason,
  };
}

function buildReconcile(reason, canonicalState = null, executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF) {
  return buildResult({
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    executionMode,
    canonicalState,
    nextAction: "Stop and reconcile the canonical current state before choosing an internal strategy.",
    reason,
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
  if (!watchRequested) return result;
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.WAIT) return result;
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) return result;
  if (result.routeKind === DEV_LOOP_ROUTE_KIND.STOP) return result;
  if (result.selectedGate === DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE) return result;
  if (result.selectedGate === DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED) return result;
  if (result.selectedGate === DEV_LOOP_GATE.STOP_DONE_TERMINAL) return result;
  return buildReconcile(
    "watch requested but the routed result is not eligible for wait/watch semantics.",
    result.canonicalState,
    result.executionMode,
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

function routeForState(canonicalState, { executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF } = {}) {
  const routableCanonicalState = toRoutableCanonicalState(canonicalState);
  const selectedGate = selectGateForState(routableCanonicalState);

  if (selectedGate === DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
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
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Report the terminal state and wait for a new work item.",
      reason: "The canonical state is already done.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.FINAL_APPROVAL) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the approval/merge gate for the current artifact without changing the public entrypoint.",
      reason: "Approval-ready and merge-ready states route to the final approval strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.WAIT_WATCH) {
    const compatibilityEntrypoint =
      routableCanonicalState.ownership === DEV_LOOP_ACTOR.COPILOT
        ? COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP
        : routableCanonicalState.ownership === DEV_LOOP_ACTOR.LOCAL
          ? COMPATIBILITY_ENTRYPOINT.DEV_LOOP
          : COMPATIBILITY_ENTRYPOINT.NONE;

    const isDurableAuto = executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO;
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.WAIT,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
      compatibilityEntrypoint,
      executionMode,
      waitSemantics: isDurableAuto
        ? DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT
        : DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
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
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.DEV_LOOP,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: "Run the local implementation strategy for the current branch or phase slice.",
      reason: "Local branch/phase targets stay on the local implementation strategy.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.ISSUE_INTAKE) {
    const needsIssueMutationConfirmation =
      routableCanonicalState.authorization === DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION;
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.COPILOT_AUTOPILOT,
      executionMode,
      canonicalState: routableCanonicalState,
      nextAction: needsIssueMutationConfirmation
        ? `Authorize the next mutation: assign Copilot to issue #${routableCanonicalState.target.issue} now?`
        : "Normalize the issue, confirm scope, and determine whether an existing PR already exists.",
      reason: "Issue targets without a linked PR route to issue intake before PR follow-up.",
    });
  }

  if (selectedGate === DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP) {
    return buildResult({
      selectedGate,
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
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
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
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
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP,
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

function buildAuthoritativeStatusNextAction(routed, issueLinkageResolution) {
  if (
    routed?.selectedGate === DEV_LOOP_GATE.ISSUE_INTAKE
    && routed?.canonicalState?.target?.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR
  ) {
    if (routed.canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION) {
      return `Authorize the next mutation: assign Copilot to issue #${routed.canonicalState.target.issue} now?`;
    }
    return "Proceed with issue intake on the issue itself; authoritative linkage resolution already established that no open PR exists.";
  }

  return routed?.nextAction ?? "Reconcile the current state before answering status.";
}

function buildStatusReconcile(reason, canonicalState = null) {
  return {
    statusKind: DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE,
    reason,
    activeArtifact: canonicalState ? buildStatusArtifactIdentity(canonicalState) : null,
    artifactState: null,
    loopState: "unknown",
    nextAction: "Stop and reconcile the authoritative active artifact and current loop state before answering status.",
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    canonicalState,
  };
}

function buildStartupResumeBundleReconcile({
  reason,
  canonicalState = null,
  issueLinkageResolution = null,
  artifactState = null,
}) {
  return {
    bundleKind: DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE,
    reason,
    activeArtifact: canonicalState ? buildStatusArtifactIdentity(canonicalState) : null,
    artifactState,
    issueLinkageResolution,
    loopState: "unknown",
    nextAction: "Stop and reconcile the authoritative startup/resume state before routing or answering status.",
    selectedGate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    canonicalState,
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
  if (!canonicalState) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires a valid canonical current state.",
    });
  }

  if (input.intent !== undefined && intent === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid public dev-loop intent.",
      canonicalState,
    });
  }

  const issueLinkageResolution = normalizeIssueLinkageResolution(input.issueLinkageResolution);
  const issueLinkageResolutionProvided = input.issueLinkageResolution !== undefined && input.issueLinkageResolution !== null;
  const normalizedIssueLinkageResolution = normalizeIssueLinkageResolutionForBundle(canonicalState, issueLinkageResolution);

  if (issueLinkageResolutionProvided && issueLinkageResolution === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing received an invalid issue↔PR linkage resolution value.",
      canonicalState,
      issueLinkageResolution: null,
    });
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && issueLinkageResolution === null
  ) {
    return buildStartupResumeBundleReconcile({
      reason: "Issue targets require explicit authoritative issue↔PR linkage resolution before routing startup/resume state.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  if (!validateIssueLinkageResolution(canonicalState, issueLinkageResolution)) {
    return buildStartupResumeBundleReconcile({
      reason: "Issue↔PR linkage resolution is incomplete or conflicts with canonical current state; reconcile before routing startup/resume state.",
      canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  const routed = routeForState(canonicalState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
  if (routed.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) {
    return buildStartupResumeBundleReconcile({
      reason: routed.reason,
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
    });
  }

  const artifactState = normalizeArtifactState(input.artifactState);
  if (!artifactState) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires an explicit artifact state (open|closed|merged|not_applicable).",
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState: null,
    });
  }

  if (!isArtifactStateCompatible(routed.canonicalState, artifactState)) {
    return buildStartupResumeBundleReconcile({
      reason: "Canonical current state conflicts with the provided artifact state; reconcile before routing startup/resume state.",
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState,
    });
  }

  const loopState = normalizeOptionalLoopState(input.loopState);
  if (loopState === null) {
    return buildStartupResumeBundleReconcile({
      reason: "Authoritative startup/resume routing requires an explicit resolved loop state before routing or answering status.",
      canonicalState: routed.canonicalState,
      issueLinkageResolution: normalizedIssueLinkageResolution,
      artifactState,
    });
  }

  const inspectStateIntent = intent === DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE;

  return {
    bundleKind: DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED,
    activeArtifact: buildStatusArtifactIdentity(routed.canonicalState),
    artifactState,
    issueLinkageResolution: normalizedIssueLinkageResolution,
    canonicalState: routed.canonicalState,
    loopState,
    routeKind: inspectStateIntent ? DEV_LOOP_ROUTE_KIND.INSPECT : routed.routeKind,
    selectedGate: routed.selectedGate,
    selectedStrategy: routed.selectedStrategy,
    compatibilityEntrypoint: routed.compatibilityEntrypoint,
    nextAction: inspectStateIntent
      ? "Describe the canonical state and the routed internal strategy without changing public entrypoints."
      : buildAuthoritativeStatusNextAction(routed, issueLinkageResolution),
    reason: routed.reason,
  };
}

export function resolveAuthoritativeDevLoopStatus(input = {}) {
  const { intent: _ignoredIntent, ...statusInput } = input;
  const bundle = resolveAuthoritativeStartupResumeBundle(statusInput);
  if (bundle.bundleKind === DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE) {
    return buildStatusReconcile(bundle.reason, bundle.canonicalState);
  }

  return {
    statusKind: DEV_LOOP_STATUS_REPORT_KIND.RESOLVED,
    activeArtifact: bundle.activeArtifact,
    artifactState: bundle.artifactState,
    loopState: bundle.loopState,
    nextAction: bundle.nextAction,
    selectedGate: bundle.selectedGate,
    routeKind: bundle.routeKind,
    selectedStrategy: bundle.selectedStrategy,
    compatibilityEntrypoint: bundle.compatibilityEntrypoint,
    canonicalState: bundle.canonicalState,
    reason: bundle.reason,
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

    const routed = routeForState(explicitState, { executionMode: effectiveMode });
    return applyWatchValidation({
      ...routed,
      routeKind: DEV_LOOP_ROUTE_KIND.INSPECT,
      nextAction: "Describe the canonical state and the routed internal strategy without changing public entrypoints.",
    }, watchRequested);
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

      return applyWatchValidation(routeForState(explicitState, { executionMode: effectiveMode }), watchRequested);
    }

    // No canonical state: steer toward local when prefer_local is requested
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      return applyWatchValidation(
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
        }, { executionMode: effectiveMode }),
        watchRequested,
      );
    }

    return applyWatchValidation(
      routeForState({
        target: explicitTarget,
        ownership: DEV_LOOP_ACTOR.COPILOT,
        nextActor: DEV_LOOP_ACTOR.USER,
        status: DEV_LOOP_STATUS.ACTIVE,
        authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
      }, { executionMode: effectiveMode }),
      watchRequested,
    );
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
      return applyWatchValidation(routeForState(explicitState, { executionMode: effectiveMode }), watchRequested);
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
    }, { executionMode: effectiveMode });

    const routedWithContinueAction = intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE
      ? {
          ...routed,
          nextAction:
            "Start with the local implementation strategy now, then re-enter the same public `dev-loop` entrypoint against the updated canonical state.",
        }
      : routed;

    return applyWatchValidation(routedWithContinueAction, watchRequested);
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

    return applyWatchValidation(routeForState(explicitState, { executionMode: effectiveMode }), watchRequested);
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

    return applyWatchValidation(routeForState(explicitState, { executionMode: effectiveMode }), watchRequested);
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile(
        "`auto_continue_current` requires a valid canonical current state.",
        null,
        DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
      );
    }
    return applyWatchValidation(routeForState(explicitState, { executionMode: effectiveMode }), watchRequested);
  }

  return buildReconcile("The public dev-loop intent is recognized but not implemented in this first slice.", null, effectiveMode);
}

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

export const DEV_LOOP_EXECUTION_MODE = Object.freeze({
  INSPECT_PROBE: "inspect_probe",
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

const TARGET_KIND_SET = new Set(Object.values(DEV_LOOP_TARGET_KIND));
const ACTOR_SET = new Set(Object.values(DEV_LOOP_ACTOR));
const STATUS_SET = new Set(Object.values(DEV_LOOP_STATUS));
const AUTHORIZATION_SET = new Set(Object.values(DEV_LOOP_AUTHORIZATION));
const INTENT_SET = new Set(Object.values(DEV_LOOP_PUBLIC_INTENT));
const ARTIFACT_STATE_SET = new Set(Object.values(DEV_LOOP_ARTIFACT_STATE));
const ISSUE_LINKAGE_RESOLUTION_SET = new Set(Object.values(DEV_LOOP_ISSUE_LINKAGE_RESOLUTION));

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
  if (kind === DEV_LOOP_TARGET_KIND.PR && pr === null) {
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

function buildResult({
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
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    executionMode,
    canonicalState,
    nextAction: "Stop and reconcile the canonical current state before choosing an internal strategy.",
    reason,
  });
}

function routeForState(canonicalState, { executionMode = DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF } = {}) {
  if (canonicalState.status === DEV_LOOP_STATUS.BLOCKED || canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NOT_AUTHORIZED) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState,
      nextAction: "Stop for a human decision or authorization before continuing the dev loop.",
      reason: "The canonical state is blocked or not authorized for an automated state change.",
    });
  }

  if (canonicalState.status === DEV_LOOP_STATUS.DONE) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState,
      nextAction: "Report the terminal state and wait for a new work item.",
      reason: "The canonical state is already done.",
    });
  }

  if (
    canonicalState.status === DEV_LOOP_STATUS.APPROVAL_READY ||
    canonicalState.status === DEV_LOOP_STATUS.MERGE_READY
  ) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState,
      nextAction: "Run the approval/merge gate for the current artifact without changing the public entrypoint.",
      reason: "Approval-ready and merge-ready states route to the final approval strategy.",
    });
  }

  if (canonicalState.status === DEV_LOOP_STATUS.WAITING) {
    const compatibilityEntrypoint =
      canonicalState.ownership === DEV_LOOP_ACTOR.COPILOT
        ? COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP
        : canonicalState.ownership === DEV_LOOP_ACTOR.LOCAL
          ? COMPATIBILITY_ENTRYPOINT.DEV_LOOP
          : COMPATIBILITY_ENTRYPOINT.NONE;

    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.WAIT,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
      compatibilityEntrypoint,
      executionMode,
      waitSemantics:
        executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO
          ? DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT
          : DEV_LOOP_WAIT_SEMANTICS.DEFAULT,
      canonicalState,
      nextAction:
        executionMode === DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO
          ? "Remain in durable auto ownership while waiting on the same canonical state; do not escalate timeout/no-activity alone as attention."
          : "Keep waiting or watching against the same canonical state instead of switching public loop names.",
      reason: "Waiting states route to the shared wait/watch strategy.",
    });
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.LOCAL_BRANCH ||
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.LOCAL_PHASE
  ) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.DEV_LOOP,
      executionMode,
      canonicalState,
      nextAction: "Run the local implementation strategy for the current branch or phase slice.",
      reason: "Local branch/phase targets stay on the local implementation strategy.",
    });
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE) {
    if (canonicalState.target.linkedPr !== null) {
      return routeForState({
        ...canonicalState,
        target: {
          kind: DEV_LOOP_TARGET_KIND.PR,
          issue: canonicalState.target.issue,
          pr: canonicalState.target.linkedPr,
          linkedPr: null,
          branch: null,
          phase: null,
        },
      }, { executionMode });
    }

    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.COPILOT_AUTOPILOT,
      executionMode,
      canonicalState,
      nextAction: "Normalize the issue, confirm scope, and determine whether an existing PR already exists.",
      reason: "Issue targets without a linked PR route to issue intake before PR follow-up.",
    });
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR && canonicalState.ownership === DEV_LOOP_ACTOR.EXTERNAL_HUMAN) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState,
      nextAction: "Run the external-contributor PR follow-up strategy against the current PR state.",
      reason: "External-human PR ownership routes to the external PR follow-up strategy.",
    });
  }

  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR &&
    (canonicalState.ownership === DEV_LOOP_ACTOR.REVIEWER || canonicalState.nextActor === DEV_LOOP_ACTOR.REVIEWER)
  ) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
      executionMode,
      canonicalState,
      nextAction: "Run the reviewer/fixer strategy for the current PR.",
      reason: "Reviewer-owned or reviewer-next PR states route to the reviewer/fixer strategy.",
    });
  }

  if (canonicalState.target.kind === DEV_LOOP_TARGET_KIND.PR && canonicalState.ownership === DEV_LOOP_ACTOR.COPILOT) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP,
      executionMode,
      canonicalState,
      nextAction: "Run the Copilot PR follow-up strategy for the current PR.",
      reason: "Copilot-owned PR states route to the Copilot PR follow-up strategy.",
    });
  }

  return buildReconcile(
    "The canonical current state does not map cleanly to any first-slice internal strategy.",
    canonicalState,
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
    routed?.routeKind === DEV_LOOP_ROUTE_KIND.ROUTE
    && routed?.selectedStrategy === INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE
    && routed?.canonicalState?.target?.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && issueLinkageResolution === DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR
  ) {
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
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    canonicalState,
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

export function resolveAuthoritativeDevLoopStatus(input = {}) {
  const canonicalState = normalizeState(input.currentState);
  if (!canonicalState) {
    return buildStatusReconcile("Authoritative status reporting requires a valid canonical current state.");
  }

  const issueLinkageResolution = normalizeIssueLinkageResolution(input.issueLinkageResolution);
  if (
    canonicalState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE
    && issueLinkageResolution === null
  ) {
    return buildStatusReconcile(
      "Issue targets require explicit authoritative issue↔PR linkage resolution before answering status.",
      canonicalState,
    );
  }

  if (!validateIssueLinkageResolution(canonicalState, issueLinkageResolution)) {
    return buildStatusReconcile(
      "Issue↔PR linkage resolution is incomplete or conflicts with canonical current state; reconcile before answering status.",
      canonicalState,
    );
  }

  const routed = routeForState(canonicalState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
  if (routed.routeKind === DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE) {
    return buildStatusReconcile(routed.reason, routed.canonicalState);
  }

  const artifactState = normalizeArtifactState(input.artifactState);
  if (!artifactState) {
    return buildStatusReconcile(
      "Authoritative status reporting requires an explicit artifact state (open|closed|merged|not_applicable).",
      routed.canonicalState,
    );
  }

  if (!isArtifactStateCompatible(routed.canonicalState, artifactState)) {
    return buildStatusReconcile(
      "Canonical current state conflicts with the provided artifact state; reconcile before answering status.",
      routed.canonicalState,
    );
  }

  const loopState = normalizeOptionalLoopState(input.loopState);
  if (loopState === null) {
    return buildStatusReconcile(
      "Authoritative status reporting requires an explicit resolved loop state before answering status.",
      routed.canonicalState,
    );
  }

  return {
    statusKind: DEV_LOOP_STATUS_REPORT_KIND.RESOLVED,
    activeArtifact: buildStatusArtifactIdentity(routed.canonicalState),
    artifactState,
    loopState,
    nextAction: buildAuthoritativeStatusNextAction(routed, issueLinkageResolution),
    routeKind: routed.routeKind,
    selectedStrategy: routed.selectedStrategy,
    compatibilityEntrypoint: routed.compatibilityEntrypoint,
    canonicalState: routed.canonicalState,
    reason: routed.reason,
  };
}

export function evaluatePublicDevLoopRouting(input = {}) {
  const intent = normalizeIntent(input.intent);
  const explicitTarget = normalizeTarget(input.target);
  const explicitState = normalizeState(input.currentState);

  if (!intent) {
    return buildReconcile("The public dev-loop intent is missing or unrecognized.");
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE) {
    if (!explicitState) {
      return buildReconcile(
        "`inspect_state` requires a valid canonical current state.",
        null,
        DEV_LOOP_EXECUTION_MODE.INSPECT_PROBE,
      );
    }

    const routed = routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.INSPECT_PROBE });
    return {
      ...routed,
      routeKind: DEV_LOOP_ROUTE_KIND.INSPECT,
      nextAction: "Describe the canonical state and the routed internal strategy without changing public entrypoints.",
    };
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
      return buildReconcile("`start_on_issue` requires an issue target.");
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildReconcile("`start_on_issue` received an invalid canonical current state.");
    }

    if (explicitState) {
      if (explicitState.target.issue !== explicitTarget.issue) {
        return buildReconcile("`start_on_issue` target conflicts with the canonical current state.", explicitState);
      }
      return routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
    }

    return routeForState({
      target: explicitTarget,
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    }, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
  }

  if (
    intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY ||
    intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE
  ) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.ISSUE) {
      return buildReconcile("Local issue-start intents require an issue target.");
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildReconcile("Local issue-start intents received an invalid canonical current state.");
    }

    if (explicitState) {
      if (
        explicitState.target.kind !== DEV_LOOP_TARGET_KIND.LOCAL_PHASE ||
        explicitState.target.issue !== explicitTarget.issue
      ) {
        return buildReconcile("Local issue-start target conflicts with the canonical current state.", explicitState);
      }
      return routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
    }

    const routed = routeForState({
      target: {
        kind: DEV_LOOP_TARGET_KIND.LOCAL_PHASE,
        issue: explicitTarget.issue,
        pr: null,
        branch: null,
        phase: `issue-${explicitTarget.issue}`,
      },
      ownership: DEV_LOOP_ACTOR.LOCAL,
      nextActor: DEV_LOOP_ACTOR.LOCAL,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    }, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });

    return intent === DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE
      ? {
          ...routed,
          nextAction:
            "Start with the local implementation strategy now, then re-enter the same public `dev-loop` entrypoint against the updated canonical state.",
        }
      : routed;
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR) {
    if (!explicitTarget || explicitTarget.kind !== DEV_LOOP_TARGET_KIND.PR) {
      return buildReconcile("`continue_on_pr` requires a PR target.");
    }
    if (!explicitState || explicitState.target.kind !== DEV_LOOP_TARGET_KIND.PR) {
      return buildReconcile("`continue_on_pr` requires a valid canonical PR state.", explicitState);
    }
    if (explicitState.target.pr !== explicitTarget.pr) {
      return buildReconcile("`continue_on_pr` target conflicts with the canonical current PR state.", explicitState);
    }
    return routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile("`continue_current` requires a valid canonical current state.");
    }
    return routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF });
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile(
        "`auto_continue_current` requires a valid canonical current state.",
        null,
        DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
      );
    }
    return routeForState(explicitState, { executionMode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO });
  }

  return buildReconcile("The public dev-loop intent is recognized but not implemented in this first slice.");
}

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

const TARGET_KIND_SET = new Set(Object.values(DEV_LOOP_TARGET_KIND));
const ACTOR_SET = new Set(Object.values(DEV_LOOP_ACTOR));
const STATUS_SET = new Set(Object.values(DEV_LOOP_STATUS));
const AUTHORIZATION_SET = new Set(Object.values(DEV_LOOP_AUTHORIZATION));
const INTENT_SET = new Set(Object.values(DEV_LOOP_PUBLIC_INTENT));

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

function buildResult({
  routeKind,
  selectedStrategy,
  compatibilityEntrypoint,
  canonicalState,
  nextAction,
  reason,
}) {
  return {
    publicEntrypoint: PUBLIC_DEV_LOOP_ENTRYPOINT,
    routeKind,
    selectedStrategy,
    compatibilityEntrypoint,
    canonicalState,
    nextAction,
    reason,
  };
}

function buildReconcile(reason, canonicalState = null) {
  return buildResult({
    routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
    selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
    compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
    canonicalState,
    nextAction: "Stop and reconcile the canonical current state before choosing an internal strategy.",
    reason,
  });
}

function routeForState(canonicalState) {
  if (canonicalState.status === DEV_LOOP_STATUS.BLOCKED || canonicalState.authorization === DEV_LOOP_AUTHORIZATION.NOT_AUTHORIZED) {
    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.STOP,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.NONE,
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
      canonicalState,
      nextAction: "Keep waiting or watching against the same canonical state instead of switching public loop names.",
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
      });
    }

    return buildResult({
      routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
      compatibilityEntrypoint: COMPATIBILITY_ENTRYPOINT.COPILOT_AUTOPILOT,
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
      canonicalState,
      nextAction: "Run the Copilot PR follow-up strategy for the current PR.",
      reason: "Copilot-owned PR states route to the Copilot PR follow-up strategy.",
    });
  }

  return buildReconcile("The canonical current state does not map cleanly to any first-slice internal strategy.", canonicalState);
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
      return buildReconcile("`inspect_state` requires a valid canonical current state.");
    }

    const routed = routeForState(explicitState);
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
      return routeForState(explicitState);
    }

    return routeForState({
      target: explicitTarget,
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    });
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
      return routeForState(explicitState);
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
    });

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
    return routeForState(explicitState);
  }

  if (intent === DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT) {
    if (!explicitState) {
      return buildReconcile("`continue_current` requires a valid canonical current state.");
    }
    return routeForState(explicitState);
  }

  return buildReconcile("The public dev-loop intent is recognized but not implemented in this first slice.");
}

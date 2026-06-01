import { normalizeRetrospectiveCheckpointState } from "./retrospective-checkpoint.mjs";
import {
  DEV_LOOP_ACTOR,
  DEV_LOOP_ARTIFACT_STATE,
  DEV_LOOP_EXECUTION_MODE,
  DEV_LOOP_GATE,
  DEV_LOOP_ISSUE_LINKAGE_RESOLUTION,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND,
  DEV_LOOP_STATUS,
  DEV_LOOP_TARGET_KIND,
  DEV_LOOP_WAIT_SEMANTICS,
  INTERNAL_DEV_LOOP_STRATEGY,
} from "./public-dev-loop-routing-contract.mjs";
import {
  ALLOWED_MODE_VALUES_TEXT,
  ALLOWED_TARGET_PREFERENCE_VALUES_TEXT,
  applyRetrospectiveCheckpointGate,
  buildAuthoritativeStatusNextAction,
  buildContractTrace,
  buildStatusArtifactIdentity,
  LINKED_PR_READY_FOR_FOLLOWUP_LOOP_STATE,
  PRIOR_LINKED_PR_CLOSED_UNMERGED_LOOP_STATE,
  normalizeArtifactState,
  normalizeAsyncRun,
  normalizeGateReviewEvidence,
  normalizeIntent,
  normalizeIssueAssignmentState,
  normalizeIssueLinkageResolution,
  normalizeIssueReadiness,
  normalizeOptionalLoopState,
  normalizeState,
  normalizeTargetPreference,
  normalizeVariationMode,
  routeForState,
} from "./public-dev-loop-routing-shared.mjs";

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

  const targetPreference = input.targetPreference !== undefined
    ? normalizeTargetPreference(input.targetPreference)
    : null;

  if (input.targetPreference !== undefined && targetPreference === null) {
    return buildStartupResumeBundleReconcile({
      reason: `Authoritative startup/resume routing received an invalid targetPreference value; allowed values: ${ALLOWED_TARGET_PREFERENCE_VALUES_TEXT}.`,
      canonicalState,
      executionMode: effectiveMode,
    });
  }

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
    targetPreference,
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


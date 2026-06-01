import { loadDevLoopConfig } from "../config/index.mjs";
import { normalizeRetrospectiveCheckpointState } from "./retrospective-checkpoint.mjs";
import {
  DEV_LOOP_ACTOR,
  DEV_LOOP_AUTHORIZATION,
  DEV_LOOP_EXECUTION_MODE,
  DEV_LOOP_GATE,
  DEV_LOOP_ISSUE_ASSIGNMENT_STATE,
  DEV_LOOP_ISSUE_READINESS,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND,
  DEV_LOOP_STATUS,
  DEV_LOOP_STATUS_REPORT_KIND,
  DEV_LOOP_TARGET_KIND,
  DEV_LOOP_TARGET_PREFERENCE,
  DEV_LOOP_WAIT_SEMANTICS,
  INTERNAL_DEV_LOOP_STRATEGY,
} from "./public-dev-loop-routing-contract.mjs";
import {
  ALLOWED_MODE_VALUES_TEXT,
  ALLOWED_TARGET_PREFERENCE_VALUES_TEXT,
  applyRetrospectiveCheckpointGate,
  applyWatchValidation,
  buildContractTrace,
  buildReconcile,
  buildStatusArtifactIdentity,
  normalizeGateReviewEvidence,
  normalizeIntent,
  normalizeIssueAssignmentState,
  normalizeIssueReadiness,
  normalizeState,
  normalizeTarget,
  normalizeTargetPreference,
  normalizeVariationMode,
  routeForState,
  shouldAcceptIssueAssignmentFacts,
  withContractTrace,
} from "./public-dev-loop-routing-shared.mjs";
import { resolveAuthoritativeStartupResumeBundle } from "./public-dev-loop-routing-startup.mjs";

export * from "./public-dev-loop-routing-contract.mjs";
export { resolveAuthoritativeStartupResumeBundle } from "./public-dev-loop-routing-startup.mjs";

const BUILT_IN_DEFAULT_TARGET_PREFERENCE = DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST;

function resolveConfiguredTargetPreference(strategyDefault) {
  if (strategyDefault === "local-first") {
    return DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL;
  }
  if (strategyDefault === "github-first") {
    return DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST;
  }
  return BUILT_IN_DEFAULT_TARGET_PREFERENCE;
}

function emitConfigWarning(note) {
  process.emitWarning(note, {
    code: "DEV_LOOP_ROUTING_CONFIG_FALLBACK",
    type: "DevLoopRoutingConfigWarning",
  });
}

async function loadDefaultTargetPreference() {
  try {
    const { config, warnings, errors } = await loadDevLoopConfig({ repoRoot: process.cwd() });

    if (warnings.length > 0) {
      emitConfigWarning(`public-dev-loop-routing: ${warnings.join("; ")}. Falling back to built-in target preference when needed.`);
    }

    if (errors.length > 0) {
      emitConfigWarning(
        `public-dev-loop-routing: ${errors.map(({ layer, message }) => `${layer}: ${message}`).join("; ")}. Falling back to built-in target preference when needed.`,
      );
      return BUILT_IN_DEFAULT_TARGET_PREFERENCE;
    }

    return resolveConfiguredTargetPreference(config?.strategy?.default);
  } catch (error) {
    emitConfigWarning(
      `public-dev-loop-routing: unable to load dev-loop config (${error?.message ?? String(error)}). Falling back to built-in target preference when needed.`,
    );
    return BUILT_IN_DEFAULT_TARGET_PREFERENCE;
  }
}

const DEFAULT_TARGET_PREFERENCE = await loadDefaultTargetPreference();

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
  const targetPreference = input.targetPreference !== undefined
    ? normalizeTargetPreference(input.targetPreference)
    : DEFAULT_TARGET_PREFERENCE;

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
  const buildInputReconcile = (reason, canonicalState = null, executionMode = requestedExecutionMode) => buildReconcile(
    reason,
    canonicalState,
    executionMode,
    { watchRequested },
  );

  // Fail closed on unrecognized variation parameter values
  if (input.mode !== undefined && variationMode === null) {
    return buildInputReconcile(`Unrecognized \`mode\` parameter; allowed values: ${ALLOWED_MODE_VALUES_TEXT}.`, null, requestedExecutionMode);
  }
  if (input.targetPreference !== undefined && targetPreference === null) {
    return buildInputReconcile(`Unrecognized \`targetPreference\` parameter; allowed values: ${ALLOWED_TARGET_PREFERENCE_VALUES_TEXT}.`, null, requestedExecutionMode);
  }
  if (watchProvided && typeof input.watch !== "boolean") {
    return buildInputReconcile("Unrecognized `watch` parameter; allowed values: true or false.", null, requestedExecutionMode);
  }
  if (acceptsIssueAssignmentFacts && input.issueReadiness !== undefined && issueReadiness === null) {
    return buildInputReconcile(
      `Unrecognized \`issueReadiness\` input; allowed values: ${Object.values(DEV_LOOP_ISSUE_READINESS).join(", ")}.`,
      null,
      requestedExecutionMode,
    );
  }
  if (acceptsIssueAssignmentFacts && input.issueAssignmentState !== undefined && issueAssignmentState === null) {
    return buildInputReconcile(
      `Unrecognized \`issueAssignmentState\` input; allowed values: ${Object.values(DEV_LOOP_ISSUE_ASSIGNMENT_STATE).join(", ")}.`,
      null,
      requestedExecutionMode,
    );
  }

  if (retrospectiveCheckpointStateProvided && retrospectiveCheckpointState === null) {
    return buildInputReconcile(
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
    return buildInputReconcile("The public dev-loop intent is missing or unrecognized.", null, requestedExecutionMode);
  }

  // ── Resolve effective execution mode ─────────────────────────────────────
  // Precedence: authoritative intent (auto_continue_current) > explicit mode > default
  let effectiveMode;
  if (intent === DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT) {
    if (variationMode === DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF) {
      return buildInputReconcile(
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
    return buildInputReconcile(
      "`mode=durable_auto` requires a valid authoritative current state.",
      null,
      DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (intent === DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE) {
    if (!explicitState) {
      return buildInputReconcile("`inspect_state` requires a valid canonical current state.", null, effectiveMode);
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
      return buildInputReconcile("`start_on_issue` requires an issue target.", null, effectiveMode);
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildInputReconcile("`start_on_issue` received an invalid canonical current state.", null, effectiveMode);
    }

    if (explicitState) {
      if (explicitState.target.issue !== explicitTarget.issue) {
        return buildInputReconcile("`start_on_issue` target conflicts with the canonical current state.", explicitState, effectiveMode);
      }

      // targetPreference=prefer_local must not override authoritative linked-PR or PR state
      if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
        const isLinkedPrState =
          explicitState.target.kind === DEV_LOOP_TARGET_KIND.PR ||
          (explicitState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE && explicitState.target.linkedPr !== null);
        if (isLinkedPrState) {
          return buildInputReconcile(
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
      return buildInputReconcile("Local issue-start intents require an issue target.", null, effectiveMode);
    }

    if (input.currentState !== undefined && !explicitState) {
      return buildInputReconcile("Local issue-start intents received an invalid canonical current state.", null, effectiveMode);
    }

    if (explicitState) {
      if (
        explicitState.target.kind !== DEV_LOOP_TARGET_KIND.LOCAL_PHASE ||
        explicitState.target.issue !== explicitTarget.issue
      ) {
        return buildInputReconcile("Local issue-start target conflicts with the canonical current state.", explicitState, effectiveMode);
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
      return buildInputReconcile("`continue_on_pr` requires a PR target.", null, effectiveMode);
    }
    if (!explicitState || explicitState.target.kind !== DEV_LOOP_TARGET_KIND.PR) {
      return buildInputReconcile("`continue_on_pr` requires a valid canonical PR state.", explicitState, effectiveMode);
    }
    if (explicitState.target.pr !== explicitTarget.pr) {
      return buildInputReconcile("`continue_on_pr` target conflicts with the canonical current PR state.", explicitState, effectiveMode);
    }

    // targetPreference=prefer_local must not override an active PR artifact
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      return buildInputReconcile(
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
      return buildInputReconcile("`continue_current` requires a valid canonical current state.", null, effectiveMode);
    }

    // targetPreference=prefer_local must not override an active PR artifact or linked-PR state
    if (targetPreference === DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL) {
      const isLinkedPrState =
        explicitState.target.kind === DEV_LOOP_TARGET_KIND.PR ||
        (explicitState.target.kind === DEV_LOOP_TARGET_KIND.ISSUE && explicitState.target.linkedPr !== null);
      if (isLinkedPrState) {
        return buildInputReconcile(
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
      return buildInputReconcile(
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

  return buildInputReconcile("The public dev-loop intent is recognized but not implemented in this first slice.", null, effectiveMode);
}

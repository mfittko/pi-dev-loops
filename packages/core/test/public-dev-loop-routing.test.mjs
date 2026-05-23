import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_ENTRYPOINT,
  DEV_LOOP_ACTOR,
  DEV_LOOP_AUTHORIZATION,
  DEV_LOOP_ARTIFACT_STATE,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_ISSUE_LINKAGE_RESOLUTION,
  DEV_LOOP_STATUS_REPORT_KIND,
  DEV_LOOP_STATUS,
  DEV_LOOP_TARGET_KIND,
  INTERNAL_DEV_LOOP_STRATEGY,
  PUBLIC_DEV_LOOP_ENTRYPOINT,
  evaluatePublicDevLoopRouting,
  resolveAuthoritativeDevLoopStatus,
} from "../src/loop/public-dev-loop-routing.mjs";

test("public dev-loop routing exports the single public façade name", () => {
  assert.equal(PUBLIC_DEV_LOOP_ENTRYPOINT, "dev-loop");
});

test("start_on_issue routes to issue_intake through the public dev-loop façade", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.COPILOT_AUTOPILOT);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.ISSUE);
  assert.equal(result.canonicalState.nextActor, DEV_LOOP_ACTOR.USER);
  assert.equal(result.canonicalState.authorization, DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION);
});

test("start_on_issue with a linked PR routes directly to PR follow-up", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86, linkedPr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(result.canonicalState.target.pr, 88);
});

test("start_on_issue with valid canonical PR state for the same issue routes from that state", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 86, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(result.canonicalState.target.pr, 88);
});

test("start_on_issue with conflicting canonical issue state fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 999, linkedPr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("start_on_issue with a canonical PR state that cannot be matched to the issue fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("issue targets with malformed linkedPr fail closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86, linkedPr: "88" },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("provided canonical current state must include a target", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("start_issue_locally_then_continue routes first to local implementation without changing the public entrypoint", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY_THEN_CONTINUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.DEV_LOOP);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
  assert.match(result.nextAction, /re-enter the same public `dev-loop` entrypoint/i);
});

test("start_issue_locally with invalid canonical state fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      ownership: DEV_LOOP_ACTOR.LOCAL,
      nextActor: DEV_LOOP_ACTOR.LOCAL,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("start_issue_locally with conflicting canonical state fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ISSUE_LOCALLY,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 86, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("continue_on_pr routes Copilot-owned PR follow-up to the compatibility copilot-dev-loop strategy", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP);
});

test("continue_on_pr with conflicting canonical PR state fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 99 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("continue_current routes external-human PR ownership to the external PR follow-up strategy", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 91 },
      ownership: DEV_LOOP_ACTOR.EXTERNAL_HUMAN,
      nextActor: DEV_LOOP_ACTOR.REVIEWER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.NONE);
});

test("blocked and not-authorized states stop instead of routing", () => {
  for (const currentState of [
    {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.BLOCKED,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NOT_AUTHORIZED,
    },
  ]) {
    const result = evaluatePublicDevLoopRouting({
      intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
      currentState,
    });

    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
    assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
    assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.NONE);
  }
});

test("done states stop as terminal states", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.DONE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.NONE);
});

test("approval-ready and merge-ready states route to final approval", () => {
  for (const status of [DEV_LOOP_STATUS.APPROVAL_READY, DEV_LOOP_STATUS.MERGE_READY]) {
    const result = evaluatePublicDevLoopRouting({
      intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
      currentState: {
        target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
        ownership: DEV_LOOP_ACTOR.MAINTAINER,
        nextActor: DEV_LOOP_ACTOR.MAINTAINER,
        status,
        authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
      },
    });

    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
    assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL);
    assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.NONE);
  }
});

test("waiting states remain deterministic wait/watch states", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.COPILOT_DEV_LOOP);
});

test("waiting states with local ownership keep the dev-loop compatibility entrypoint", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.LOCAL_PHASE, issue: 86, phase: "issue-86" },
      ownership: DEV_LOOP_ACTOR.LOCAL,
      nextActor: DEV_LOOP_ACTOR.LOCAL,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.DEV_LOOP);
});

test("inspect_state reports the canonical state without switching public entrypoints", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.LOCAL_BRANCH, branch: "feature/issue-86" },
      ownership: DEV_LOOP_ACTOR.LOCAL,
      nextActor: DEV_LOOP_ACTOR.LOCAL,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION);
  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
});

test("invalid or incomplete inputs fail closed to needs_reconcile", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
  assert.equal(result.compatibilityEntrypoint, COMPATIBILITY_ENTRYPOINT.NONE);
});

test("authoritative status resolution uses the canonically linked PR identity", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 89, linkedPr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "unresolved_feedback_present",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(report.activeArtifact.issue, 89);
  assert.equal(report.activeArtifact.pr, 92);
});


test("authoritative status resolution does not classify unresolved feedback as final review", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "unresolved_feedback_present",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.loopState, "unresolved_feedback_present");
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
});

test("authoritative status resolution fails closed when routing itself cannot resolve a strategy", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "awaiting_triage",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.loopState, "unknown");
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("authoritative status resolution fails closed when merged/closed state conflicts with active/open claim", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 91 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.MERGED,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "final_review_gate",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.loopState, "unknown");
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
});

test("authoritative status resolution fails closed for issue targets when linkage was not resolved authoritatively", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    loopState: "active",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.loopState, "unknown");
});

test("authoritative status resolution accepts issue state only after explicit no-open-PR linkage resolution", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    loopState: "active",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.ISSUE);
  assert.equal(report.activeArtifact.issue, 93);
  assert.equal(report.activeArtifact.pr, null);
  assert.equal(
    report.nextAction,
    "Proceed with issue intake on the issue itself; authoritative linkage resolution already established that no open PR exists.",
  );
});

test("authoritative status resolution fails closed when loop state was not explicitly resolved", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.loopState, "unknown");
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
});

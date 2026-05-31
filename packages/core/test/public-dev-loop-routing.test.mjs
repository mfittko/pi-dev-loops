import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RETROSPECTIVE_CHECKPOINT_STATE,
} from "../src/loop/retrospective-checkpoint.mjs";

import {
  DEV_LOOP_ACTOR,
  DEV_LOOP_AUTHORIZATION,
  DEV_LOOP_ARTIFACT_STATE,
  DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION,
  DEV_LOOP_GATE,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_EXECUTION_MODE,
  DEV_LOOP_ISSUE_ASSIGNMENT_SEAM,
  DEV_LOOP_ISSUE_ASSIGNMENT_STATE,
  DEV_LOOP_ISSUE_READINESS,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND,
  DEV_LOOP_WAIT_SEMANTICS,
  DEV_LOOP_ISSUE_LINKAGE_RESOLUTION,
  DEV_LOOP_STATUS_REPORT_KIND,
  DEV_LOOP_STATUS,
  DEV_LOOP_TARGET_KIND,
  DEV_LOOP_TARGET_PREFERENCE,
  DEV_LOOP_VARIATION_PARAMETER_CONTRACT,
  INTERNAL_DEV_LOOP_STRATEGY,
  PUBLIC_DEV_LOOP_GATE_CONTRACT,
  PUBLIC_DEV_LOOP_ENTRYPOINT,
  evaluatePublicDevLoopRouting,
  resolveAuthoritativeStartupResumeBundle,
  resolveAuthoritativeDevLoopStatus,
} from "../src/loop/public-dev-loop-routing.mjs";
import {
  EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY,
  PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY,
} from "../src/loop/timeout-policy.mjs";

const publicContractUrl = new URL("../../../skills/docs/public-dev-loop-contract.md", import.meta.url);

function buildCleanPreApprovalGateEvidence(currentHeadSha = "abc1234") {
  return {
    currentHeadSha,
    preApprovalGate: {
      visible: true,
      headSha: currentHeadSha,
      verdict: "clean",
    },
  };
}

function buildVisibleAsyncRun(runId = "run-123") {
  return {
    kind: "pi_managed_run",
    runId,
    visible: true,
  };
}

test("public dev-loop routing exports the single public façade name", () => {
  assert.equal(PUBLIC_DEV_LOOP_ENTRYPOINT, "dev-loop");
});

test("public dev-loop routing exposes an explicit gate contract for the current route families", () => {
  assert.deepEqual(
    PUBLIC_DEV_LOOP_GATE_CONTRACT.map(({ gate, routeKind, selectedStrategy }) => ({ gate, routeKind, selectedStrategy })),
    [
      {
        gate: DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED,
        routeKind: DEV_LOOP_ROUTE_KIND.STOP,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      },
      {
        gate: DEV_LOOP_GATE.STOP_DONE_TERMINAL,
        routeKind: DEV_LOOP_ROUTE_KIND.STOP,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      },
      {
        gate: DEV_LOOP_GATE.FINAL_APPROVAL,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL,
      },
      {
        gate: DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION,
        routeKind: DEV_LOOP_ROUTE_KIND.STOP,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      },
      {
        gate: DEV_LOOP_GATE.WAIT_WATCH,
        routeKind: DEV_LOOP_ROUTE_KIND.WAIT,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
      },
      {
        gate: DEV_LOOP_GATE.LOCAL_IMPLEMENTATION,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
      },
      {
        gate: DEV_LOOP_GATE.ISSUE_INTAKE,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
      },
      {
        gate: DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
      },
      {
        gate: DEV_LOOP_GATE.REVIEWER_FIXER,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER,
      },
      {
        gate: DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP,
        routeKind: DEV_LOOP_ROUTE_KIND.ROUTE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      },
      {
        gate: DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE,
        routeKind: DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE,
        selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      },
    ],
  );
});

test("public contract doc stays aligned with the machine-checkable gate contract", async () => {
  const publicContract = await readFile(publicContractUrl, "utf8");
  const documentedGates = publicContract
    .split("\n")
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map((match) => match[1]);
  const routingGateSection = documentedGates.slice(
    documentedGates.indexOf(DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED),
    documentedGates.indexOf(DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE) + 1,
  );

  assert.deepEqual(
    routingGateSection,
    PUBLIC_DEV_LOOP_GATE_CONTRACT.map(({ gate }) => gate),
  );

  const finalApprovalSummary = PUBLIC_DEV_LOOP_GATE_CONTRACT.find(({ gate }) => gate === DEV_LOOP_GATE.FINAL_APPROVAL)?.summary;
  const waitingForMergeSummary = PUBLIC_DEV_LOOP_GATE_CONTRACT.find(({ gate }) => gate === DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION)?.summary;

  assert.equal(
    finalApprovalSummary,
    "approval-ready canonical state routes to final approval; merge-ready routes here only when merge authorization is explicit; requires explicit current-head pre_approval_gate evidence — clean-looking signals are not substitutes",
  );
  assert.equal(
    waitingForMergeSummary,
    "merge-ready canonical state without explicit merge authorization stops and waits for merge authorization",
  );
  assert.match(
    publicContract,
    /approval-ready canonical state routes to the final approval gate; merge-ready routes here only when merge authorization is explicit; requires explicit current-head `pre_approval_gate` gate-review evidence/i,
  );

  const internalStrategySection = publicContract.split("## Internal strategy families")[1]?.split("## Copilot-first issue-assignment seam")[0] ?? "";
  assert.doesNotMatch(internalStrategySection, /\|\s*`waiting_for_merge_authorization`\s*\|/i);
  assert.match(internalStrategySection, /stop gate rather than an internal strategy/i);
});

test("start_on_issue routes to issue_intake through the public dev-loop façade", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.ISSUE_INTAKE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.ISSUE);
  assert.equal(result.canonicalState.nextActor, DEV_LOOP_ACTOR.USER);
  assert.equal(result.canonicalState.authorization, DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION);
  assert.equal(result.issueAssignmentSeam, DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.READY_NEEDS_ASSIGNMENT_CONFIRMATION);
  assert.equal(result.nextAction, "Authorize the next mutation: assign copilot-swe-agent to issue #86 now?");
  assert.doesNotMatch(result.nextAction, /approval gate/i);
});

test("copilot-first unassigned issue stops for clarification when readiness is missing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    issueReadiness: DEV_LOOP_ISSUE_READINESS.NEEDS_CLARIFICATION,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.UNASSIGNED,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.ISSUE_INTAKE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.equal(result.issueAssignmentSeam, DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.NEEDS_REFINEMENT);
  assert.match(result.nextAction, /ask focused clarification questions/i);
  assert.match(result.nextAction, /stop before assigning copilot-swe-agent/i);
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
  assert.equal(result.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
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

test("issue targets carrying a pr field fail closed in public routing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 86, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("pr targets carrying a linkedPr field fail closed in public routing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 86, pr: 88, linkedPr: 99 },
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

  assert.equal(result.selectedGate, DEV_LOOP_GATE.EXTERNAL_PR_FOLLOWUP);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP);
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
    {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.APPROVAL_READY,
      authorization: DEV_LOOP_AUTHORIZATION.NOT_AUTHORIZED,
    },
  ]) {
    const result = evaluatePublicDevLoopRouting({
      intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
      currentState,
    });

    assert.equal(result.selectedGate, DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED);
    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
    assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
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

  assert.equal(result.selectedGate, DEV_LOOP_GATE.STOP_DONE_TERMINAL);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("approval-ready states route to final approval and keep merge authorization separate", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.APPROVAL_READY,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FINAL_APPROVAL);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL);
  assert.match(result.nextAction, /do not treat approval as merge authorization/i);
  assert.doesNotMatch(result.nextAction, /approval\/merge/i);
});

test("merge-ready states without merge authorization stop in waiting_for_merge_authorization", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.MERGE_READY,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
  assert.match(result.nextAction, /wait for explicit merge authorization/i);
  assert.match(result.nextAction, /ambiguous/i);
  assert.match(result.reason, /must stop and wait/i);
});

test("authorization-gated stops emit contract trace classification", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.MERGE_READY,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
  });

  assert.equal(result.contractTrace.stopReason.classification, DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.AUTHORIZATION_GATED);
  assert.equal(result.contractTrace.stopReason.terminal, false);
  assert.match(result.contractTrace.stopReason.reason, /must stop and wait/i);
});

test("merge-ready states with explicit merge authorization may proceed to final approval merge step", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.MERGE_READY,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FINAL_APPROVAL);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL);
  assert.match(result.nextAction, /merge is explicitly authorized/i);
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

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF);
  assert.equal(result.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.DEFAULT);
  assert.deepEqual(result.waitTimeoutPolicy, PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY);
});

test("wait/watch routing emits deterministic contract trace instrumentation", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.contractTrace.decision.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.contractTrace.decision.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.contractTrace.decision.contractClassification, DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.HEALTHY_WAIT);
  assert.equal(result.contractTrace.waitStrategy.waitMode, "persistent_watch");
  assert.equal(result.contractTrace.waitStrategy.timeoutPolicyClassification, PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY.classification);
  assert.equal(result.contractTrace.waitStrategy.effectiveTimeoutMs, PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY.defaultTimeoutMs);
  assert.equal(result.contractTrace.stateRefresh.boundaryKind, "post_watch_or_probe");
  assert.equal(result.contractTrace.stateRefresh.refreshRequired, true);
});

test("waiting linked issue states route as the authoritative linked PR artifact", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 89, linkedPr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(result.canonicalState.target.issue, 89);
  assert.equal(result.canonicalState.target.pr, 92);
  assert.equal(result.canonicalState.target.linkedPr, null);
});

test("waiting states with local ownership still route through the shared wait/watch strategy", () => {
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

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
});

test("auto_continue_current routes detected state with durable auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.DEFAULT);
});

test("auto_continue_current keeps healthy watch states non-escalating", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
  assert.deepEqual(result.waitTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
  assert.match(result.nextAction, /do not escalate timeout\/no-activity alone as attention/i);
});

test("auto_continue_current without canonical state fails closed with durable_auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
  });
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /auto_continue_current.*requires a valid canonical current state/i);
});

test("auto_continue_current with blocked or not-authorized state still stops (escalates)", () => {
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
      intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
      currentState,
    });
    assert.equal(result.selectedGate, DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED);
    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
    assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  }
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

  assert.equal(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION);
  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
});

test("missing intent preserves requested durable_auto execution-mode metadata", () => {
  const result = evaluatePublicDevLoopRouting({
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /intent is missing or unrecognized/i);
});

test("watch validation preserves existing reconcile reasons", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /does not map cleanly to any first-slice internal strategy/i);
});


test("watch validation preserves existing stop results", () => {
  const blockedResult = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.BLOCKED,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  const doneResult = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.DONE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(blockedResult.selectedGate, DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED);
  assert.equal(blockedResult.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.match(blockedResult.reason, /blocked or not authorized/i);

  assert.equal(doneResult.selectedGate, DEV_LOOP_GATE.STOP_DONE_TERMINAL);
  assert.equal(doneResult.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.match(doneResult.reason, /already done/i);
});


test("watch validation preserves inspect-wrapped stop and reconcile outcomes", () => {
  const inspectBlockedResult = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.BLOCKED,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  const inspectReconcileResult = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    watch: true,
  });

  assert.equal(inspectBlockedResult.selectedGate, DEV_LOOP_GATE.STOP_BLOCKED_OR_NOT_AUTHORIZED);
  assert.equal(inspectBlockedResult.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.match(inspectBlockedResult.reason, /blocked or not authorized/i);

  assert.equal(inspectReconcileResult.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(inspectReconcileResult.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.match(inspectReconcileResult.reason, /does not map cleanly to any first-slice internal strategy/i);
});

test("invalid or incomplete inputs fail closed to needs_reconcile", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(report.activeArtifact.issue, 89);
  assert.equal(report.activeArtifact.pr, 92);
});

test("authoritative startup/resume bundle resolves routed state with authoritative minimum fields", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
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

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(bundle.activeArtifact.issue, 89);
  assert.equal(bundle.activeArtifact.pr, 92);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(bundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(
    bundle.issueLinkageResolution,
    DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
  );
});

test("authoritative startup/resume bundle fails closed when issue linkage is missing", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
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

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
  assert.equal(bundle.loopState, "unknown");
  assert.match(bundle.nextAction, /reconcile/i);
});

test("authoritative startup/resume bundle fails closed on target identity conflicts", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93, pr: 99 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    loopState: "active",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("authoritative startup/resume bundle fails closed on malformed conflicting target identity fields", () => {
  const issueBundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93, pr: "99" },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    loopState: "active",
  });

  const prBundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 93, pr: 99, linkedPr: "101" },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "active",
  });

  assert.equal(issueBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(prBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
});

test("authoritative startup/resume bundle fails closed when artifact state is missing", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "unresolved_feedback_present",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.artifactState, null);
});

test("authoritative startup/resume bundle fails closed on artifact state conflicts", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.MERGED,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "unresolved_feedback_present",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.artifactState, DEV_LOOP_ARTIFACT_STATE.MERGED);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
});

test("authoritative startup/resume bundle fails closed on invalid explicit issue linkage resolution", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: "bogus",
    loopState: "unresolved_feedback_present",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /invalid issue↔PR linkage resolution/i);
});

test("authoritative startup/resume bundle fails closed when loop state is missing or unknown", () => {
  const missingBundle = resolveAuthoritativeStartupResumeBundle({
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

  const unknownBundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, issue: 89, pr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "unknown",
  });

  assert.equal(missingBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(unknownBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(missingBundle.loopState, "unknown");
  assert.equal(unknownBundle.loopState, "unknown");
});

test("authoritative startup/resume bundle fails closed when routing cannot resolve a strategy", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
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

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
});

test("authoritative startup/resume bundle preserves inspect-state semantics when requested", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
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

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.match(bundle.nextAction, /Describe the canonical state/i);
});

test("authoritative startup/resume bundle keeps durable wait semantics for linked-PR bootstrap wait states", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: buildVisibleAsyncRun("run-179"),
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(bundle.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(bundle.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
  assert.deepEqual(bundle.waitTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
  assert.equal(bundle.asyncRun?.runId, "run-179");
  assert.equal(bundle.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(bundle.activeArtifact.issue, 177);
  assert.equal(bundle.activeArtifact.pr, 179);
  assert.match(bundle.nextAction, /remain in durable auto ownership/i);
});

test("authoritative startup/resume bundle reroutes stale bootstrap wait state when refreshed loop state reports linked PR ready", () => {
  const input = {
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 176, linkedPr: 178 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    asyncRun: buildVisibleAsyncRun("run-178"),
  };

  const waitingBundle = resolveAuthoritativeStartupResumeBundle({
    ...input,
    loopState: "waiting_for_initial_copilot_implementation",
  });
  const readyBundle = resolveAuthoritativeStartupResumeBundle({
    ...input,
    loopState: "linked_pr_ready_for_followup",
  });

  assert.equal(waitingBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(waitingBundle.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(waitingBundle.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(waitingBundle.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(waitingBundle.activeArtifact.pr, 178);

  assert.equal(readyBundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(readyBundle.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(readyBundle.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(readyBundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(readyBundle.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(readyBundle.activeArtifact.issue, 176);
  assert.equal(readyBundle.activeArtifact.pr, 178);
  assert.match(readyBundle.nextAction, /Copilot PR follow-up strategy/i);
});

test("authoritative startup/resume bundle fails closed when linked-pr-ready refresh facts are contradictory", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 176 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    loopState: "linked_pr_ready_for_followup",
    asyncRun: buildVisibleAsyncRun("run-178"),
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /linked_pr_ready_for_followup.*conflicts/i);
});


test("authoritative startup/resume bundle fails closed when refreshed bootstrap state reports a prior linked PR closed unmerged", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 130 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.ASSIGNED_TO_COPILOT,
    loopState: "prior_linked_pr_closed_unmerged",
    asyncRun: buildVisibleAsyncRun("run-149"),
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /prior linked PR.*closed unmerged/i);
});

test("authoritative startup/resume bundle preserves inspect routing in durable_auto mode", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: buildVisibleAsyncRun("run-180"),
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(bundle.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(bundle.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
  assert.deepEqual(bundle.waitTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
  assert.equal(bundle.asyncRun?.runId, "run-180");
  assert.match(bundle.nextAction, /Describe the canonical state/i);
});

test("authoritative startup/resume bundle reroutes stale bootstrap wait states when linked PR becomes ready for followup", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "linked_pr_ready_for_followup",
    asyncRun: buildVisibleAsyncRun("run-181"),
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(bundle.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(bundle.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(bundle.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.DEFAULT);
  assert.equal(bundle.asyncRun?.runId, "run-181");
  assert.equal(bundle.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(bundle.activeArtifact.issue, 177);
  assert.equal(bundle.activeArtifact.pr, 179);
  assert.equal(bundle.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(bundle.canonicalState.status, DEV_LOOP_STATUS.ACTIVE);
  assert.equal(bundle.loopState, "linked_pr_ready_for_followup");
  assert.match(bundle.nextAction, /Copilot PR follow-up/i);
});

test("authoritative startup/resume bundle fails closed when durable auto has no visible async run", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /visible registered Pi-managed async run id/i);
});

test("authoritative startup/resume bundle fails closed on detached-process async fallback", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: {
      kind: "detached_process",
      visible: false,
    },
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /detached local background processes do not satisfy the async-start contract/i);
});

test("authoritative startup/resume bundle fails closed on uninspectable pi-managed async run evidence", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: {
      kind: "pi_managed_run",
      runId: "run-188",
      visible: true,
      inspectionState: "uninspectable",
    },
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /uninspectable.*no child message route registered/i);
});

test("authoritative startup/resume bundle fails closed on asyncRun with unrecognized kind", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: { kind: "tmux_session", runId: "x", visible: true },
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /invalid async-run registration/i);
});

test("authoritative startup/resume bundle fails closed on pi_managed_run with null runId", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: { kind: "pi_managed_run", runId: null, visible: true },
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /visible registered Pi-managed async run id/i);
});

test("authoritative startup/resume bundle fails closed on pi_managed_run with visible=false", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: { kind: "pi_managed_run", runId: "run-99", visible: false },
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /visible registered Pi-managed async run id/i);
});

test("authoritative startup/resume bundle fails closed on invalid explicit intent", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: "bogus_intent",
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

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.reason, /invalid public dev-loop intent/i);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(report.loopState, "unresolved_feedback_present");
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
});

test("authoritative status resolution consumes the startup/resume bundle output", () => {
  const input = {
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
  };

  const bundle = resolveAuthoritativeStartupResumeBundle(input);
  const report = resolveAuthoritativeDevLoopStatus(input);

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.deepEqual(report.activeArtifact, bundle.activeArtifact);
  assert.equal(report.artifactState, bundle.artifactState);
  assert.equal(report.loopState, bundle.loopState);
  assert.equal(report.routeKind, bundle.routeKind);
  assert.equal(report.selectedStrategy, bundle.selectedStrategy);
  assert.equal(report.executionMode, bundle.executionMode);
  assert.equal(report.waitSemantics, bundle.waitSemantics);
  assert.equal(report.asyncRun, bundle.asyncRun);
  assert.equal(report.nextAction, bundle.nextAction);
  assert.equal(report.reason, bundle.reason);
});

test("authoritative status resolution ignores inspect intent metadata", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
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
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.doesNotMatch(report.nextAction, /Describe the canonical state/i);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(report.loopState, "unknown");
});

test("authoritative status resolution fails closed when copilot-first issue readiness/assignment seam facts are missing", () => {
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

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
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
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.UNASSIGNED,
    loopState: "active",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.ISSUE_INTAKE);
  assert.equal(report.issueAssignmentSeam, DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.READY_NEEDS_ASSIGNMENT_CONFIRMATION);
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.ISSUE);
  assert.equal(report.activeArtifact.issue, 93);
  assert.equal(report.activeArtifact.pr, null);
  assert.equal(
    report.nextAction,
    "Authorize the next mutation: assign copilot-swe-agent to issue #93 now?",
  );
});

test("authoritative status resolution requires assignment before follow-up when issue is ready but still unassigned", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.UNASSIGNED,
    loopState: "active",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.issueAssignmentSeam, DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.READY_ASSIGN_NOW);
  assert.equal(
    report.nextAction,
    "Issue #93 is ready and still unassigned; assign copilot-swe-agent now before PR/bootstrap/watch follow-up.",
  );
});

test("authoritative status resolution allows follow-up once issue is ready and already assigned", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.ASSIGNED_TO_COPILOT,
    loopState: "active",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.issueAssignmentSeam, DEV_LOOP_ISSUE_ASSIGNMENT_SEAM.ASSIGNED_TO_COPILOT);
  assert.equal(
    report.nextAction,
    "Issue #93 is ready and already assigned to copilot-swe-agent; continue into PR/bootstrap/watch follow-up work.",
  );
});

test("authoritative status resolution keeps waiting nextAction for waiting issue states", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 93 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.ASSIGNED_TO_COPILOT,
    loopState: "waiting_for_copilot",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.deepEqual(report.waitTimeoutPolicy, PERSISTENT_INTERNAL_WAIT_TIMEOUT_POLICY);
  assert.equal(
    report.nextAction,
    "Keep waiting or watching against the same canonical state instead of switching public loop names.",
  );
});

test("authoritative status resolution keeps waiting linked issue states on the authoritative linked PR artifact", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 89, linkedPr: 92 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_copilot_review",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(report.activeArtifact.issue, 89);
  assert.equal(report.activeArtifact.pr, 92);
  assert.equal(report.artifactState, DEV_LOOP_ARTIFACT_STATE.OPEN);
  assert.equal(
    report.nextAction,
    "Keep waiting or watching against the same canonical state instead of switching public loop names.",
  );
});

test("authoritative status resolution preserves durable healthy-wait semantics for linked-PR bootstrap waits", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: buildVisibleAsyncRun("run-181"),
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(report.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(report.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
  assert.deepEqual(report.waitTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
  assert.equal(report.asyncRun?.runId, "run-181");
  assert.match(report.nextAction, /remain in durable auto ownership/i);
});

test("authoritative status resolution reroutes stale bootstrap wait states when linked PR becomes ready for followup", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 177, linkedPr: 179 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "linked_pr_ready_for_followup",
    asyncRun: buildVisibleAsyncRun("run-182"),
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(report.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(report.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(report.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.DEFAULT);
  assert.equal(report.asyncRun?.runId, "run-182");
  assert.equal(report.activeArtifact.kind, DEV_LOOP_TARGET_KIND.PR);
  assert.equal(report.activeArtifact.issue, 177);
  assert.equal(report.activeArtifact.pr, 179);
  assert.equal(report.loopState, "linked_pr_ready_for_followup");
  assert.match(report.nextAction, /Copilot PR follow-up/i);
});


test("authoritative status resolution fails closed when refreshed bootstrap state reports a prior linked PR closed unmerged", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 130 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.NOT_APPLICABLE,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_NO_OPEN_PR,
    issueReadiness: DEV_LOOP_ISSUE_READINESS.READY,
    issueAssignmentState: DEV_LOOP_ISSUE_ASSIGNMENT_STATE.ASSIGNED_TO_COPILOT,
    loopState: "prior_linked_pr_closed_unmerged",
    asyncRun: buildVisibleAsyncRun("run-149"),
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(report.reason, /prior linked PR.*closed unmerged/i);
  assert.match(report.nextAction, /reconcile/i);
});

test("authoritative status resolution fails closed instead of claiming durable auto started without a visible async run", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 186, linkedPr: 188 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.RESOLVED_LINKED_PR,
    loopState: "waiting_for_initial_copilot_implementation",
    asyncRun: {
      kind: "detached_process",
      visible: false,
    },
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(report.nextAction, /reconcile/i);
});

test("authoritative status reports approved-but-not-merged PRs as waiting for explicit merge authorization", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 175 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.USER,
      status: DEV_LOOP_STATUS.MERGE_READY,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "waiting_for_merge_authorization",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.RESOLVED);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.WAITING_FOR_MERGE_AUTHORIZATION);
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.STOP);
  assert.match(report.nextAction, /wait for explicit merge authorization/i);
});

test("authoritative status resolution fails closed when loop state is the unknown sentinel", () => {
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
    loopState: "UnKnOwN",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(report.loopState, "unknown");
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
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
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(report.loopState, "unknown");
  assert.equal(report.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
});

// ── Bounded variation parameter contract regression tests (issue #112) ─────

test("variation parameter contract exports the bounded allow-list, precedence, and disallowed categories", () => {
  assert.deepEqual(
    [...DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedParameters],
    ["mode", "watch", "intent", "targetPreference"],
  );
  assert.ok(!DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedParameters.includes("issueReadiness"));
  assert.ok(!DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedParameters.includes("issueAssignmentState"));
  assert.deepEqual(
    [...DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedModeValues],
    [DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO],
  );
  assert.deepEqual(
    [...DEV_LOOP_VARIATION_PARAMETER_CONTRACT.allowedTargetPreferenceValues],
    [DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST, DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL],
  );
  assert.equal(
    DEV_LOOP_VARIATION_PARAMETER_CONTRACT.precedenceOrder[0],
    "authoritative_current_state",
  );
  assert.ok(DEV_LOOP_VARIATION_PARAMETER_CONTRACT.disallowedCategories.includes("arbitrary_ownership_override"));
});

test("mode=durable_auto steers execution mode for continue_current without changing routing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
});

test("mode=durable_auto without authoritative current state fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /mode=durable_auto.*requires a valid authoritative current state/i);
});

test("mode=durable_auto on inspect_state preserves inspect routing with authoritative state", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
});

test("mode=durable_auto explicit parameter beats the default bounded_handoff mode", () => {
  const withDefault = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  const withExplicitMode = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(withDefault.executionMode, DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF);
  assert.equal(withExplicitMode.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(withDefault.selectedGate, withExplicitMode.selectedGate);
  assert.equal(withDefault.selectedStrategy, withExplicitMode.selectedStrategy);
});

test("mode=durable_auto for waiting states sets auto_healthy_wait semantics", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.waitSemantics, DEV_LOOP_WAIT_SEMANTICS.AUTO_HEALTHY_WAIT);
});

test("mode=bounded_handoff conflicts with auto_continue_current intent and fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.deepEqual(result.canonicalState?.target, { kind: DEV_LOOP_TARGET_KIND.PR, issue: null, pr: 88, linkedPr: null, branch: null, phase: null });
  assert.match(result.reason, /conflicts with the `auto_continue_current` intent/i);
});

test("unrecognized mode value fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: "some_unknown_mode",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /unrecognized `mode` parameter/i);
});

test("auto_continue_current invalid mode preserves derived durable_auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    mode: "some_unknown_mode",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /unrecognized `mode` parameter/i);
});

test("non-boolean watch value preserves requested durable_auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    watch: "true",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /unrecognized `watch` parameter/i);
});

test("non-boolean watch value fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: "true",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /unrecognized `watch` parameter/i);
});

test("auto_continue_current non-boolean watch preserves derived durable_auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    watch: "true",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /unrecognized `watch` parameter/i);
});

test("watch=true succeeds on a wait-capable route", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
});

test("watch=true on inspect_state fails closed even when the underlying state is waiting", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /watch requested but the routed result is not eligible for wait\/watch semantics/i);
});

test("watch=true on a non-wait route fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /watch requested but the routed result is not eligible for wait\/watch semantics/i);
});

test("watch=true on a non-wait PR continue_on_pr route fails closed", () => {
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
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /watch requested but the routed result is not eligible for wait\/watch semantics/i);
});

test("watch=true on a waiting PR succeeds through continue_on_pr", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH);
});

test("targetPreference=prefer_local steers start_on_issue toward local implementation when no canonical state exists", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
  assert.equal(result.canonicalState.target.issue, 42);
});

test("targetPreference=prefer_local conflicts with authoritative linked-PR issue state and fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42, linkedPr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /prefer_local.*conflicts with authoritative PR\/linked-PR/i);
});

test("prefer_local reconcile preserves durable_auto execution mode metadata", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /prefer_local.*conflicts with authoritative PR\/linked-PR/i);
});

test("targetPreference=prefer_local conflicts with authoritative active PR state in continue_current and fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /prefer_local.*conflicts with authoritative PR\/linked-PR/i);
});

test("targetPreference=prefer_local conflicts with active PR in continue_on_pr and fails closed", () => {
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
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /prefer_local.*conflicts with authoritative PR\/linked-PR/i);
});

test("targetPreference=prefer_github_first is the default and does not change routing", () => {
  const withDefault = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
  });

  const withExplicitGithubFirst = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
  });

  assert.equal(withDefault.selectedGate, withExplicitGithubFirst.selectedGate);
  assert.equal(withDefault.selectedStrategy, withExplicitGithubFirst.selectedStrategy);
  assert.equal(withDefault.routeKind, withExplicitGithubFirst.routeKind);
});

test("unrecognized targetPreference value fails closed", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    targetPreference: "force_local_anyway",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.match(result.reason, /unrecognized `targetPreference` parameter/i);
});

test("auto_continue_current invalid targetPreference preserves derived durable_auto execution mode", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    targetPreference: "force_local_anyway",
  });

  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.match(result.reason, /unrecognized `targetPreference` parameter/i);
});

// Representative translation: formerly name-shaped intent → parameterized dev-loop form
test("representative translation: 'auto dev loop' → mode=durable_auto with continue_current", () => {
  // "auto dev loop" → dev-loop --mode durable_auto
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    mode: DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO,
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
});

test("representative translation: 'auto dev loop on issue 112' → auto_continue_current on issue with durable_auto", () => {
  // "auto dev loop on issue 112" → dev-loop --intent auto_continue_current (issue-scoped authoritative state)
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 112 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.ISSUE_INTAKE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE);
});

test("auto_continue_current still routes approval-ready states to final approval by default", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.AUTO_CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 112 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.APPROVAL_READY,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    gateReviewEvidence: buildCleanPreApprovalGateEvidence(),
  });

  assert.equal(result.executionMode, DEV_LOOP_EXECUTION_MODE.DURABLE_AUTO);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FINAL_APPROVAL);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
});

test("approval-ready states fail closed when clean current-head pre-approval gate evidence is missing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.APPROVAL_READY,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.match(result.reason, /pre_approval_gate/i);
  assert.match(result.reason, /current head sha/i);
});

test("approval-ready with stale pre-approval gate evidence (older head SHA) fails closed — regression: CI green + resolved threads + clean rereview are not sufficient", () => {
  // Regression for issue where CI green, resolved review threads, and clean Copilot
  // rereview led to an approval suggestion even though the pre_approval_gate comment
  // was for an older head SHA, not the current one.
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.APPROVAL_READY,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    gateReviewEvidence: {
      currentHeadSha: "new-sha-123",
      preApprovalGate: {
        visible: true,
        headSha: "old-sha-456",
        verdict: "clean",
      },
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.match(result.reason, /pre_approval_gate/i);
  assert.match(result.reason, /current head sha/i);
});

test("merge-ready with stale pre-approval gate evidence (older head SHA) fails closed — regression: CI green + resolved threads + clean rereview are not sufficient", () => {
  // Same regression, for MERGE_READY status with explicit authorization.
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_CURRENT,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.MAINTAINER,
      nextActor: DEV_LOOP_ACTOR.MAINTAINER,
      status: DEV_LOOP_STATUS.MERGE_READY,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    gateReviewEvidence: {
      currentHeadSha: "new-sha-123",
      preApprovalGate: {
        visible: true,
        headSha: "old-sha-456",
        verdict: "clean",
      },
    },
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.match(result.reason, /pre_approval_gate/i);
  assert.match(result.reason, /current head sha/i);
});

test("representative translation: 'run dev loop on PR 88 and stay on it' → continue_on_pr + watch", () => {
  // "run dev loop on PR 88 and stay on it" → dev-loop on PR 88 --watch
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    watch: true,
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.WAIT_WATCH);
  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.WAIT);
});

test("representative translation: 'prefer the local path for issue 42' → start_on_issue + targetPreference=prefer_local", () => {
  // "prefer the local path for issue 42" → dev-loop on issue 42 --target-preference prefer_local
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
  });

  assert.equal(result.publicEntrypoint, PUBLIC_DEV_LOOP_ENTRYPOINT);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION);
  assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
});


test("retrospective checkpoint gating blocks routed start/resume when checkpoint is missing", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.CONTINUE_ON_PR,
    target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.equal(result.selectedStrategy, INTERNAL_DEV_LOOP_STRATEGY.NONE);
  assert.match(result.nextAction, /retrospective/i);
});

test("retrospective checkpoint gating does not block inspect_state answers", () => {
  const result = evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(result.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
});

test("authoritative startup/resume bundle applies retrospective gating when checkpoint is missing", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.equal(bundle.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.match(bundle.nextAction, /retrospective/i);
  assert.match(bundle.reason, /retrospective/i);
});

test("authoritative startup/resume bundle preserves inspect semantics despite missing retrospective checkpoint", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    intent: DEV_LOOP_PUBLIC_INTENT.INSPECT_STATE,
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.routeKind, DEV_LOOP_ROUTE_KIND.INSPECT);
  assert.equal(bundle.selectedGate, DEV_LOOP_GATE.COPILOT_PR_FOLLOWUP);
});

test("authoritative status fails closed when retrospective checkpoint input is invalid", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: "bogus",
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
  assert.match(report.reason, /retrospective checkpoint-state/i);
});


test("authoritative startup/resume bundle preserves the retrospective gate nextAction", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.NEEDS_RECONCILE);
  assert.match(bundle.nextAction, /Complete or explicitly skip/i);
});

test("authoritative status preserves the retrospective gate nextAction", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.match(report.nextAction, /Complete or explicitly skip/i);
});

test("authoritative startup/resume bundle carries refreshed wait-state trace context", () => {
  const bundle = resolveAuthoritativeStartupResumeBundle({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.WAITING,
      authorization: DEV_LOOP_AUTHORIZATION.NEEDS_CONFIRMATION,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "waiting_for_copilot_review",
  });

  assert.equal(bundle.bundleKind, DEV_LOOP_STARTUP_RESUME_BUNDLE_KIND.RESOLVED);
  assert.equal(bundle.contractTrace.decision.contractClassification, DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.HEALTHY_WAIT);
  assert.equal(bundle.contractTrace.stateRefresh.boundaryKind, "startup_resume_refresh");
  assert.equal(bundle.contractTrace.stateRefresh.loopState, "waiting_for_copilot_review");
  assert.equal(bundle.contractTrace.stateRefresh.artifactState, DEV_LOOP_ARTIFACT_STATE.OPEN);
});

test("authoritative status reconcile carries contract trace classification", () => {
  const report = resolveAuthoritativeDevLoopStatus({
    currentState: {
      target: { kind: DEV_LOOP_TARGET_KIND.PR, pr: 88 },
      ownership: DEV_LOOP_ACTOR.COPILOT,
      nextActor: DEV_LOOP_ACTOR.COPILOT,
      status: DEV_LOOP_STATUS.ACTIVE,
      authorization: DEV_LOOP_AUTHORIZATION.AUTHORIZED,
    },
    artifactState: DEV_LOOP_ARTIFACT_STATE.OPEN,
    issueLinkageResolution: DEV_LOOP_ISSUE_LINKAGE_RESOLUTION.NOT_APPLICABLE,
    loopState: "copilot_followup_active",
    retrospectiveCheckpointState: RETROSPECTIVE_CHECKPOINT_STATE.MISSING,
  });

  assert.equal(report.statusKind, DEV_LOOP_STATUS_REPORT_KIND.NEEDS_RECONCILE);
  assert.equal(report.contractTrace.stopReason.classification, DEV_LOOP_CONTRACT_TRACE_CLASSIFICATION.RECONCILE);
  assert.equal(report.contractTrace.stateRefresh.boundaryKind, "authoritative_status_refresh");
});

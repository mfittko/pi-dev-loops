import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePrGateCoordination,
  PR_GATE_ACTION,
  PR_GATE_BOUNDARY,
} from "../src/loop/pr-gate-coordination.mjs";
import { LOOP_DISPOSITION, STATE } from "../src/loop/copilot-loop-state.mjs";

function gate({ visible = false, headSha = null, verdict = null, contractComplete = false } = {}) {
  return {
    visible,
    headSha,
    verdict,
    contractComplete,
  };
}

test("draft PR only allows mark-ready after current-head clean draft gate evidence", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.DRAFT_REVIEW);
  assert.equal(result.nextAction, PR_GATE_ACTION.MARK_READY_FOR_REVIEW);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.RUN_DRAFT_GATE));
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.MARK_READY_FOR_REVIEW));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.currentHead, true);
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("ready PR with no review yet forbids pre-approval gate and requests Copilot review next", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "c94679e", verdict: "clean" }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_GATE_ACTION.REQUEST_COPILOT_REVIEW);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.visible, true);
  assert.equal(result.draftGate.currentHead, false);
});

test("clean settled current-head review opens the pre-approval gate window", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: LOOP_DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("current-head clean pre-approval evidence advances to final approval boundary", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: LOOP_DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert.equal(result.preApprovalGate.currentHead, true);
  assert.equal(result.preApprovalGate.currentHeadClean, true);
});

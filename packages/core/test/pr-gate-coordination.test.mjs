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
  assert(!result.forbiddenActions.includes(PR_GATE_ACTION.MARK_READY_FOR_REVIEW));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.currentHead, true);
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("draft PR forbids mark-ready until current-head clean draft gate evidence exists", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "old1111", verdict: "clean" }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.nextAction, PR_GATE_ACTION.RUN_DRAFT_GATE);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.MARK_READY_FOR_REVIEW));
});

test("stale gate markers do not report current-head contract completeness", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "c94679e", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "c94679e", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.draftGate.currentHead, false);
  assert.equal(result.draftGate.contractComplete, false);
  assert.equal(result.draftGate.currentHeadClean, false);
});

test("non-draft PR with clean draft gate on a different head proceeds to post-draft flow (one-time boundary)", () => {
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
  assert.equal(result.draftGate.visible, true);
  assert.equal(result.draftGate.currentHead, false);
  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_DRAFT_GATE));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("ready non-draft PR with current-head clean draft gate evidence requests Copilot review next", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "def5678", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "def5678", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_GATE_ACTION.REQUEST_COPILOT_REVIEW);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.REQUEST_COPILOT_REVIEW));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("waiting_for_ci recommends a dedicated wait-for-ci action", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.WAITING_FOR_CI,
    loopDisposition: LOOP_DISPOSITION.PENDING,
    draftGate: gate({ visible: true, headSha: "def5678", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "def5678", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.nextAction, PR_GATE_ACTION.WAIT_FOR_CI);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.WAIT_FOR_CI));
  assert.match(result.reason, /waiting on current-head CI/i);
});

test("clean settled current-head review opens the pre-approval gate window", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: LOOP_DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
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
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert.equal(result.preApprovalGate.currentHead, true);
  assert.equal(result.preApprovalGate.currentHeadClean, true);
});

test("non-draft PR with clean draft_gate on a different head still allows post-draft flow (one-time boundary)", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "newhead999999",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "oldhead111", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "oldhead111", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.notEqual(result.gateBoundary, PR_GATE_BOUNDARY.BLOCKED);
  assert.equal(result.nextAction, PR_GATE_ACTION.REQUEST_COPILOT_REVIEW);
  assert.equal(result.draftGate.currentHead, false);
  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_DRAFT_GATE));
  assert.equal(
    result.reason,
    "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
  );
});

test("non-draft PR without any clean draft_gate evidence fails closed", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.BLOCKED);
  assert.equal(result.nextAction, PR_GATE_ACTION.REPORT_BLOCKED);
  assert.equal(result.draftGate.cleanEvidenceExists, false);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.REPORT_BLOCKED));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.REQUEST_COPILOT_REVIEW));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_DRAFT_GATE));
  assert.match(result.reason, /no `draft_gate` evidence is visible at all/i);
});

test("non-draft PR with visible non-clean draft_gate evidence blocks without suggesting auto-reconcile", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "findings_present" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "findings_present", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.BLOCKED);
  assert.equal(result.draftGate.cleanEvidenceExists, false);
  assert.equal(result.draftGate.anyVisible, true);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_DRAFT_GATE));
  assert(!result.allowedNextActions.includes(PR_GATE_ACTION.RECONCILE_DRAFT_GATE));
  assert.match(result.reason, /visible `draft_gate` evidence already exists/i);
  assert.doesNotMatch(result.reason, /reconcile-draft-gate\.mjs/i);
});

test("local-first PR with explicit reviewMode skips to pre-approval gate after draft→ready", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    reviewMode: "local_first",
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  // Local-first PRs skip Copilot review and go straight to pre-approval gate
  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /local-first/i);
});

test("local-first PR with both gates clean goes straight to final approval", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    reviewMode: "local_first",
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /local-first/i);
});

test("PR without explicit reviewMode uses standard Copilot review path (default)", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  // Without reviewMode, default to Copilot review (hybrid local-first + external review)
  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_GATE_ACTION.REQUEST_COPILOT_REVIEW);
  assert(result.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("local-first PR without clean draft gate still blocks at post-draft", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    reviewMode: "local_first",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  // No clean draft_gate → blocked regardless of review mode
  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.BLOCKED);
  assert.equal(result.nextAction, PR_GATE_ACTION.REPORT_BLOCKED);
});

test("draft PR with clean current-head draft_gate sets cleanEvidenceExists", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("non-draft PR without clean evidence suggests reconcile_draft_gate as recovery action", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: LOOP_DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_GATE_BOUNDARY.BLOCKED);
  assert.equal(result.nextAction, PR_GATE_ACTION.REPORT_BLOCKED);
  assert.equal(result.draftGate.anyVisible, false);
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.REPORT_BLOCKED));
  assert(result.allowedNextActions.includes(PR_GATE_ACTION.RECONCILE_DRAFT_GATE));
  assert.match(result.reason, /reconcile-draft-gate\.mjs/i);
});


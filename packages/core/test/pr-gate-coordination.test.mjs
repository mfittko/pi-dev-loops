import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePrGateCoordination,
  PR_CHECKPOINT_ACTION,
  PR_CHECKPOINT,
} from "../src/loop/pr-gate-coordination.mjs";
import { DISPOSITION, STATE } from "../src/loop/copilot-loop-state.mjs";

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
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.DRAFT_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.currentHead, true);
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("draft PR waits for CI before allowing draft gate when requireCi is enabled", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.PENDING,
    ciStatus: "pending",
    draftGateRequireCi: true,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.WAIT_FOR_CI);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.WAIT_FOR_CI));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert.match(result.reason, /requires green current-head CI before entering `draft_gate`/i);
});

test("draft PR allows draft gate without green CI when requireCi is disabled", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    ciStatus: "pending",
    draftGateRequireCi: false,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
});

test("draft PR forbids mark-ready until current-head clean draft gate evidence exists", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    ciStatus: "success",
    draftGate: gate({ visible: true, headSha: "old1111", verdict: "clean" }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
});

test("draft PR rejects pre_approval_gate entry — must pass draft gate before pre-approval", () => {
  // A draft PR with no draft-gate evidence at all must forbid pre_approval_gate.
  const result = evaluatePrGateCoordination({
    pr: 543,
    currentHeadSha: "f7a611b723",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    ciStatus: "success",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.DRAFT_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.match(
    result.reason,
    /`draft_gate` is now the legal gate boundary before `gh pr ready`/i,
  );
  // Mark-ready is also forbidden (no current-head clean draft gate evidence yet).
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
  assert(!result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
});

test("stale gate markers do not report current-head contract completeness", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
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
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "c94679e", verdict: "clean" }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert.equal(result.draftGate.visible, true);
  assert.equal(result.draftGate.currentHead, false);
  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("ready non-draft PR with current-head clean draft gate evidence requests Copilot review next", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "def5678", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "def5678", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("waiting_for_ci recommends a dedicated wait-for-ci action", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "def56789abcdef",
    prDraft: false,
    lifecycleState: STATE.WAITING_FOR_CI,
    loopDisposition: DISPOSITION.PENDING,
    draftGate: gate({ visible: true, headSha: "def5678", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "def5678", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.WAIT_FOR_CI);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.WAIT_FOR_CI));
  assert.match(result.reason, /waiting on current-head CI/i);
});

test("clean settled current-head review opens the pre-approval gate window", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("crediblyGreen CI blocks pre-approval progression — CI must be confirmed before gate entry", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "crediblyGreen",
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.lifecycleState, STATE.BLOCKED_NEEDS_USER_DECISION);
  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
  assert.match(result.reason, /failing/i);
});

test("round-cap exhaustion opens the pre-approval gate window even without a current-head Copilot rereview", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    sameHeadCleanConverged: false,
    ciStatus: "success",
    copilotReviewRoundCount: 5,
    maxCopilotRounds: 5,
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.lifecycleState, STATE.READY_TO_REREQUEST_REVIEW);
  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert.equal(result.gateEvidenceNote, "Copilot review rounds exhausted (5/5); current head has zero unresolved threads and green or credibly green CI, so pre_approval_gate fallback is allowed without another Copilot re-request.");
  assert.match(result.reason, /round limit/i);
  assert.match(result.reason, /pre_approval_gate/i);
});

test("missing ciStatus fails closed to wait_for_ci instead of reopening gate progression", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.lifecycleState, STATE.WAITING_FOR_CI);
  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.WAIT_FOR_CI);
});

test("current-head clean pre-approval evidence advances to final approval boundary", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    mergeStateStatus: "CLEAN",
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert.equal(result.preApprovalGate.currentHead, true);
  assert.equal(result.preApprovalGate.currentHeadClean, true);
  assert.equal(result.mergeStateStatus, "CLEAN");
  assert.deepEqual(result.conflictFiles, []);
});

test("retrospective merge gate blocks final approval when checkpoint is missing", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    requireRetrospectiveGate: true,
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.lifecycleState, "retrospective_gate_pending");
  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
  assert.equal(result.loopDisposition, DISPOSITION.BLOCKED);
  assert.match(result.reason, /retrospective_gate_pending/i);
});

test("retrospective merge gate allows final approval when retrospective explicitly approves merge", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    requireRetrospectiveGate: true,
    retrospectiveCheckpoint: {
      state: "complete",
      gateQuality: "Real gates with concrete findings and follow-through.",
      mergeRecommendation: "Merge approved — all gates passed clean.",
      unexpectedFindings: "No unexpected findings.",
      behavioralReview: {
        mergeApproved: true,
        followedWorkingAgreement: true,
        gateQualityAcceptable: true,
        notes: "Real gates with concrete findings and follow-through.",
        drifts: ["No unexpected findings."],
      },
    },
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
});

test("retrospective merge gate: empty drifts array is valid (no unexpected findings)", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    requireRetrospectiveGate: true,
    retrospectiveCheckpoint: {
      state: "complete",
      gateQuality: "All gates clean.",
      mergeRecommendation: "Proceed with merge.",
      behavioralReview: {
        mergeApproved: true,
        followedWorkingAgreement: true,
        gateQualityAcceptable: true,
        notes: "All gates clean.",
        drifts: [],
      },
    },
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
});

test("retrospective merge gate: missing gateQualityAcceptable blocks merge", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "fedcba987654",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    requireRetrospectiveGate: true,
    retrospectiveCheckpoint: {
      state: "complete",
      mergeRecommendation: "Proceed.",
      behavioralReview: {
        mergeApproved: true,
        followedWorkingAgreement: true,
        notes: "Missing gateQualityAcceptable.",
        drifts: ["No unexpected findings."],
      },
    },
    draftGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "fedcba9", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "fedcba9", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.lifecycleState, "retrospective_gate_pending");
  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.match(result.reason, /gateQuality/);
});

test("non-draft PR with clean draft_gate on a different head still allows post-draft flow (one-time boundary)", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "newhead999999",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "oldhead111", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "oldhead111", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.notEqual(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert.equal(result.draftGate.currentHead, false);
  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert.equal(
    result.reason,
    "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
  );
});

test("non-draft PR without any clean draft_gate evidence still enters post-draft external review", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert.equal(result.draftGate.cleanEvidenceExists, false);
  assert.equal(result.draftGateAlreadySatisfied, false);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert.equal(
    result.reason,
    "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
  );
});

test("non-draft PR with visible non-clean draft_gate evidence still follows post-draft flow", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "findings_present" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "findings_present", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert.equal(result.draftGate.cleanEvidenceExists, false);
  assert.equal(result.draftGate.anyVisible, true);
  assert(!result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RECONCILE_DRAFT_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert.equal(
    result.reason,
    "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
  );
});


test("conflicted PR returns the conflict-resolution boundary and reports conflicted files", () => {
  const result = evaluatePrGateCoordination({
    pr: 370,
    currentHeadSha: "deadbeef1234",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    mergeStateStatus: "DIRTY",
    conflictFiles: ["config.test.mjs", "extension/README.md"],
    draftGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.CONFLICT_RESOLUTION);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RESOLVE_MERGE_CONFLICTS);
  assert.equal(result.mergeStateStatus, "DIRTY");
  assert.deepEqual(result.conflictFiles, ["config.test.mjs", "extension/README.md"]);
  assert.deepEqual(result.allowedNextActions, [PR_CHECKPOINT_ACTION.RESOLVE_MERGE_CONFLICTS]);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.DECLARE_MERGE_READY));
  assert.match(result.reason, /resolve the conflict locally on the PR branch/i);
  assert.match(result.reason, /config\.test\.mjs/i);
});

test("conflict state takes precedence over otherwise merge-ready current-head evidence", () => {
  const result = evaluatePrGateCoordination({
    pr: 370,
    currentHeadSha: "deadbeef1234",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    mergeStateStatus: "CONFLICTING",
    draftGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.CONFLICT_RESOLUTION);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RESOLVE_MERGE_CONFLICTS);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.DECLARE_MERGE_READY));
});

test("local git conflict files trigger the conflict-resolution boundary even without DIRTY mergeStateStatus", () => {
  const result = evaluatePrGateCoordination({
    pr: 370,
    currentHeadSha: "deadbeef1234",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    mergeStateStatus: "CLEAN",
    conflictFiles: [".pi/dev-loop/defaults.yaml"],
    draftGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.CONFLICT_RESOLUTION);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RESOLVE_MERGE_CONFLICTS);
  assert.deepEqual(result.conflictFiles, [".pi/dev-loop/defaults.yaml"]);
});

test("normalizeConflictFiles preserves opaque path strings while still rejecting blank entries", () => {
  const result = evaluatePrGateCoordination({
    pr: 370,
    currentHeadSha: "deadbeef1234",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    mergeStateStatus: "CLEAN",
    conflictFiles: ["  spaced-path.txt  ", "   ", "  spaced-path.txt  "],
    draftGate: gate({ visible: true, headSha: "deadbee", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "deadbee", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.deepEqual(result.conflictFiles, ["  spaced-path.txt  "]);
});

test("internal-only PR with explicit reviewMode skips to pre-approval gate after draft→ready", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    reviewMode: "internal_only",
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  // Internal-only PRs skip Copilot review and go straight to pre-approval gate
  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /internal-only/i);
});

test("internal-only PR with both gates clean goes straight to final approval", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    reviewMode: "internal_only",
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /internal-only/i);
});

test("PR without explicit reviewMode uses standard Copilot review path (default)", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  // Without reviewMode, default to standard external Copilot review
  assert.equal(result.gateBoundary, PR_CHECKPOINT.POST_DRAFT_EXTERNAL_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("internal-only PR without clean draft gate still enters pre-approval gate window", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    reviewMode: "internal_only",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
});

test("internal-only PR with retrospective gate blocks when checkpoint missing", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    reviewMode: "internal_only",
    requireRetrospectiveGate: true,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.lifecycleState, "retrospective_gate_pending");
  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
  assert.match(result.reason, /retrospective_gate_pending/i);
});

test("internal-only PR with retrospective gate allows when approved", () => {
  const result = evaluatePrGateCoordination({
    pr: 298,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    reviewMode: "internal_only",
    requireRetrospectiveGate: true,
    retrospectiveCheckpoint: {
      state: "complete",
      behavioralReview: {
        mergeApproved: true,
        followedWorkingAgreement: true,
        gateQualityAcceptable: true,
        notes: "All gates clean.",
        drifts: ["No unexpected findings."],
      },
      gateQuality: "All gates clean.",
      mergeRecommendation: "Proceed with merge.",
    },
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
    preApprovalGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /internal-only/i);
});

test("draft PR with clean current-head draft_gate sets cleanEvidenceExists", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc123456789",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    draftGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.draftGate.cleanEvidenceExists, true);
  assert.equal(result.draftGate.currentHeadClean, true);
});

test("converged non-draft PR without clean draft_gate evidence still enters pre-approval gate window", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: false }),
    preApprovalGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert.equal(result.draftGate.anyVisible, false);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
});

test("converged non-draft PR without clean draft_gate evidence can still reach final approval", () => {
  const result = evaluatePrGateCoordination({
    pr: 266,
    currentHeadSha: "abc123456789",
    prDraft: false,
    lifecycleState: STATE.READY_TO_REREQUEST_REVIEW,
    loopDisposition: DISPOSITION.CLEAN_CONVERGED,
    sameHeadCleanConverged: true,
    ciStatus: "success",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    preApprovalGate: gate({ visible: true, headSha: "abc1234", verdict: "clean" }),
    preApprovalGateMarker: gate({ visible: true, headSha: "abc1234", verdict: "clean", contractComplete: true }),
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.FINAL_APPROVAL_READY);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert.equal(result.draftGate.cleanEvidenceExists, false);
  assert.equal(result.preApprovalGate.currentHeadClean, true);
});


// ── LOW_SIGNAL_CONVERGED gate routing tests ─────────────────────────────

import { normalizeSnapshot } from "../src/loop/copilot-loop-state.mjs";

test("LOW_SIGNAL_CONVERGED routes to pre-approval gate when CI is green", () => {
  const result = evaluatePrGateCoordination({
    repo: "owner/repo", pr: 17,
    lifecycleState: STATE.LOW_SIGNAL_CONVERGED,
    loopDisposition: DISPOSITION.DONE,
    prDraft: false, ciStatus: "success",
    draftGate: { visible: true, verdict: "clean", headSha: "abc1234" },
    preApprovalGate: {},
  });
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE);
  assert.equal(result.gateBoundary, PR_CHECKPOINT.PRE_APPROVAL_GATE_WINDOW);
  assert.ok(!result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.REQUEST_COPILOT_REVIEW));
  assert.match(result.reason, /low-signal/i);
});

test("LOW_SIGNAL_CONVERGED with clean pre-approval gate advances to final approval", () => {
  const result = evaluatePrGateCoordination({
    repo: "owner/repo", pr: 17, currentHeadSha: "abc1234",
    lifecycleState: STATE.LOW_SIGNAL_CONVERGED, loopDisposition: DISPOSITION.DONE,
    prDraft: false, ciStatus: "success",
    preApprovalGate: { visible: true, verdict: "clean", headSha: "abc1234" },
    preApprovalGateMarker: { visible: true, verdict: "clean", headSha: "abc1234", contractComplete: true },
    draftGate: { visible: true, verdict: "clean", headSha: "abc1234" },
  });
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.AWAIT_FINAL_HUMAN_APPROVAL);
  assert.match(result.reason, /low-signal/i);
});

test("LOW_SIGNAL_CONVERGED waits for CI when pending", () => {
  const result = evaluatePrGateCoordination({
    repo: "owner/repo", pr: 17,
    lifecycleState: STATE.LOW_SIGNAL_CONVERGED, loopDisposition: DISPOSITION.DONE,
    prDraft: false, ciStatus: "pending",
    draftGate: { visible: true, verdict: "clean", headSha: "abc1234" },
    preApprovalGate: {},
  });
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.WAIT_FOR_CI);
});

test("LOW_SIGNAL_CONVERGED blocks on CI failure", () => {
  const result = evaluatePrGateCoordination({
    repo: "owner/repo", pr: 17,
    lifecycleState: STATE.LOW_SIGNAL_CONVERGED, loopDisposition: DISPOSITION.DONE,
    prDraft: false, ciStatus: "failure",
    draftGate: { visible: true, verdict: "clean", headSha: "abc1234" },
    preApprovalGate: {},
  });
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
});

test("normalizeSnapshot preserves valid lastCopilotRoundMaxSignal", () => {
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17, lastCopilotRoundMaxSignal: "high" }).lastCopilotRoundMaxSignal, "high");
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17, lastCopilotRoundMaxSignal: "mid" }).lastCopilotRoundMaxSignal, "mid");
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17, lastCopilotRoundMaxSignal: "low" }).lastCopilotRoundMaxSignal, "low");
});

test("normalizeSnapshot rejects invalid lastCopilotRoundMaxSignal values", () => {
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17, lastCopilotRoundMaxSignal: "critical" }).lastCopilotRoundMaxSignal, null);
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17, lastCopilotRoundMaxSignal: "" }).lastCopilotRoundMaxSignal, null);
  assert.equal(normalizeSnapshot({ prExists: true, prNumber: 17 }).lastCopilotRoundMaxSignal, null);
});

test("gateEvidenceRequiredForMerge is always true in coordination output", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc1234",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
  });

  assert.equal(result.gateEvidenceRequiredForMerge, true);
});

test("draft PR is blocked when refinement artifact is missing on linked issue (#532)", () => {
  const result = evaluatePrGateCoordination({
    pr: 532,
    currentHeadSha: "abc1234567",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    refinementArtifact: {
      status: "missing",
      linkedIssue: 532,
      source: "missing",
      reason: "Issue body has no Acceptance criteria section, no DoD section, and no linked refinement doc.",
      finding: "missing_refinement_artifact",
    },
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.MARK_READY_FOR_REVIEW));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_PRE_APPROVAL_GATE));
  assert(result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.DECLARE_MERGE_READY));
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.REPORT_BLOCKED));
  assert.match(result.reason, /no refinement artifact/i);
  assert.match(result.reason, /#532/);
  assert.match(result.reason, /missing_refinement_artifact/);
  assert.equal(result.refinementArtifact?.status, "missing");
  assert.equal(result.refinementArtifact?.linkedIssue, 532);
});

test("draft PR is not blocked when refinement artifact is present (#532)", () => {
  const result = evaluatePrGateCoordination({
    pr: 532,
    currentHeadSha: "abc1234567",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    ciStatus: "success",
    draftGate: gate({ visible: false }),
    draftGateMarker: gate({ visible: false }),
    refinementArtifact: {
      status: "present",
      linkedIssue: 532,
      source: "issue-body-ac",
      acItems: ["First AC", "Second AC"],
      reason: "Found 2 Acceptance criteria checklist item(s) in the issue body.",
    },
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.DRAFT_REVIEW);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE);
  assert(result.allowedNextActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert(!result.forbiddenActions.includes(PR_CHECKPOINT_ACTION.RUN_DRAFT_GATE));
  assert.equal(result.refinementArtifact?.status, "present");
});

test("refinement block takes precedence over non-draft branches for draft PRs", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc1234567",
    prDraft: true,
    lifecycleState: STATE.PR_DRAFT,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    mergeStateStatus: "CLEAN",
    conflictFiles: [],
    refinementArtifact: {
      status: "missing",
      linkedIssue: 10,
      source: "missing",
      reason: "no artifact",
      finding: "missing_refinement_artifact",
    },
  });

  assert.equal(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.nextAction, PR_CHECKPOINT_ACTION.REPORT_BLOCKED);
});

test("non-draft PRs do not block on missing refinement artifact (already left draft)", () => {
  const result = evaluatePrGateCoordination({
    pr: 10,
    currentHeadSha: "abc1234567",
    prDraft: false,
    lifecycleState: STATE.PR_READY_NO_FEEDBACK,
    loopDisposition: DISPOSITION.ACTION_REQUIRED,
    refinementArtifact: {
      status: "missing",
      linkedIssue: 10,
      source: "missing",
      reason: "no artifact",
    },
  });

  assert.notEqual(result.gateBoundary, PR_CHECKPOINT.BLOCKED);
  assert.equal(result.refinementArtifact?.status, "missing");
});

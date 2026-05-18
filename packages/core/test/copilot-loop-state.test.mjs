import assert from "node:assert/strict";
import test from "node:test";

import {
  STATE,
  TRANSITIONS,
  normalizeSnapshot,
  interpretLoopState,
} from "../src/loop/copilot-loop-state.mjs";

// ---------------------------------------------------------------------------
// normalizeSnapshot
// ---------------------------------------------------------------------------

test("normalizeSnapshot rejects non-object input", () => {
  assert.throws(() => normalizeSnapshot(null), /Snapshot must be a non-null object/);
  assert.throws(() => normalizeSnapshot(undefined), /Snapshot must be a non-null object/);
  assert.throws(() => normalizeSnapshot("string"), /Snapshot must be a non-null object/);
  assert.throws(() => normalizeSnapshot(42), /Snapshot must be a non-null object/);
});

test("normalizeSnapshot returns safe defaults for an empty object", () => {
  const result = normalizeSnapshot({});
  assert.deepEqual(result, {
    prExists: false,
    prNumber: null,
    prDraft: false,
    prMerged: false,
    prClosed: false,
    copilotReviewRequestStatus: "none",
    copilotReviewPresent: false,
    copilotReviewOnCurrentHead: false,
    unresolvedThreadCount: 0,
    actionableThreadCount: 0,
    ciStatus: "none",
    agentFixStatus: null,
  });
});

test("normalizeSnapshot coerces boolean-like fields", () => {
  const result = normalizeSnapshot({
    prExists: 1,
    prDraft: "yes",
    prMerged: 0,
    prClosed: "",
    copilotReviewPresent: "true",
  });
  assert.equal(result.prExists, true);
  assert.equal(result.prDraft, true);
  assert.equal(result.prMerged, false);
  assert.equal(result.prClosed, false);
  assert.equal(result.copilotReviewPresent, true);
});

test("normalizeSnapshot normalizes prNumber only when prExists is true", () => {
  const withPr = normalizeSnapshot({ prExists: true, prNumber: 17 });
  assert.equal(withPr.prNumber, 17);

  const withoutPr = normalizeSnapshot({ prExists: false, prNumber: 17 });
  assert.equal(withoutPr.prNumber, null);

  const invalidNumber = normalizeSnapshot({ prExists: true, prNumber: -5 });
  assert.equal(invalidNumber.prNumber, null);

  const zeroNumber = normalizeSnapshot({ prExists: true, prNumber: 0 });
  assert.equal(zeroNumber.prNumber, null);

  const floatNumber = normalizeSnapshot({ prExists: true, prNumber: 7.9 });
  assert.equal(floatNumber.prNumber, 7);
});

test("normalizeSnapshot accepts all valid copilotReviewRequestStatus values", () => {
  for (const status of ["requested", "already-requested", "unavailable", "none", "failed"]) {
    const result = normalizeSnapshot({ copilotReviewRequestStatus: status });
    assert.equal(result.copilotReviewRequestStatus, status, `expected ${status}`);
  }
});

test("normalizeSnapshot replaces unknown copilotReviewRequestStatus with none", () => {
  const result = normalizeSnapshot({ copilotReviewRequestStatus: "bogus" });
  assert.equal(result.copilotReviewRequestStatus, "none");
});

test("normalizeSnapshot floors fractional thread counts and rejects negatives", () => {
  const fractional = normalizeSnapshot({ unresolvedThreadCount: 2.9, actionableThreadCount: 1.1 });
  assert.equal(fractional.unresolvedThreadCount, 2);
  assert.equal(fractional.actionableThreadCount, 1);

  const negative = normalizeSnapshot({ unresolvedThreadCount: -1, actionableThreadCount: -2 });
  assert.equal(negative.unresolvedThreadCount, 0);
  assert.equal(negative.actionableThreadCount, 0);
});

test("normalizeSnapshot accepts all valid ciStatus values", () => {
  for (const status of ["success", "failure", "pending", "none"]) {
    const result = normalizeSnapshot({ ciStatus: status });
    assert.equal(result.ciStatus, status, `expected ${status}`);
  }
});

test("normalizeSnapshot replaces unknown ciStatus with none", () => {
  const result = normalizeSnapshot({ ciStatus: "unknown" });
  assert.equal(result.ciStatus, "none");
});

test("normalizeSnapshot accepts agentFixStatus applied and defaults others to null", () => {
  const applied = normalizeSnapshot({ agentFixStatus: "applied" });
  assert.equal(applied.agentFixStatus, "applied");

  const other = normalizeSnapshot({ agentFixStatus: "pending" });
  assert.equal(other.agentFixStatus, null);

  const missing = normalizeSnapshot({});
  assert.equal(missing.agentFixStatus, null);
});

// ---------------------------------------------------------------------------
// TRANSITIONS graph completeness
// ---------------------------------------------------------------------------

test("TRANSITIONS covers every STATE value", () => {
  for (const stateName of Object.values(STATE)) {
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, stateName), `missing transition entry for ${stateName}`);
  }
});

test("TRANSITIONS only references valid STATE values", () => {
  const validStates = new Set(Object.values(STATE));
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    assert.ok(validStates.has(from), `unknown source state: ${from}`);
    for (const target of targets) {
      assert.ok(validStates.has(target), `unknown target state ${target} in transitions from ${from}`);
    }
  }
});

test("terminal states have empty transition arrays", () => {
  for (const terminal of [STATE.NO_PR, STATE.REVIEW_REQUEST_UNAVAILABLE, STATE.BLOCKED_NEEDS_USER_DECISION, STATE.DONE]) {
    assert.deepEqual(TRANSITIONS[terminal], [], `expected no transitions from ${terminal}`);
  }
});

// ---------------------------------------------------------------------------
// interpretLoopState — core routing
// ---------------------------------------------------------------------------

test("interpretLoopState returns no_pr when prExists is false", () => {
  const result = interpretLoopState({ prExists: false });
  assert.equal(result.state, STATE.NO_PR);
  assert.deepEqual(result.allowedTransitions, []);
  assert.ok(typeof result.nextAction === "string" && result.nextAction.length > 0);
});

test("interpretLoopState returns done for merged PR", () => {
  const result = interpretLoopState({ prExists: true, prNumber: 1, prMerged: true });
  assert.equal(result.state, STATE.DONE);
});

test("interpretLoopState returns done for closed PR", () => {
  const result = interpretLoopState({ prExists: true, prNumber: 1, prClosed: true });
  assert.equal(result.state, STATE.DONE);
});

test("interpretLoopState returns pr_draft for draft PR", () => {
  const result = interpretLoopState({ prExists: true, prNumber: 1, prDraft: true });
  assert.equal(result.state, STATE.PR_DRAFT);
  assert.deepEqual(result.allowedTransitions, [STATE.PR_READY_NO_FEEDBACK]);
});

test("interpretLoopState returns review_request_unavailable for unavailable status", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "unavailable",
  });
  assert.equal(result.state, STATE.REVIEW_REQUEST_UNAVAILABLE);
  assert.deepEqual(result.allowedTransitions, []);
  assert.match(result.nextAction, /stop/i);
});

test("interpretLoopState returns blocked_needs_user_decision for failed review request", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "failed",
  });
  assert.equal(result.state, STATE.BLOCKED_NEEDS_USER_DECISION);
  assert.deepEqual(result.allowedTransitions, []);
});

// ---------------------------------------------------------------------------
// Regression: unresolved feedback must route to fix/reply-resolve, never wait
// ---------------------------------------------------------------------------

test("interpretLoopState routes into unresolved_feedback_present when threads exist — not waiting", () => {
  // Regression: even if Copilot review was recently requested, unresolved threads take priority
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "already-requested",
    copilotReviewPresent: true,
    unresolvedThreadCount: 2,
    actionableThreadCount: 1,
  });
  assert.equal(result.state, STATE.UNRESOLVED_FEEDBACK_PRESENT);
  assert.ok(result.allowedTransitions.includes(STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE));
  assert.ok(!result.allowedTransitions.includes(STATE.WAITING_FOR_COPILOT_REVIEW),
    "must not include waiting_for_copilot_review when unresolved threads exist");
});

test("interpretLoopState routes into unresolved_feedback_present when threads exist regardless of request status", () => {
  for (const status of ["requested", "already-requested", "none"]) {
    const result = interpretLoopState({
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: status,
      copilotReviewPresent: true,
      unresolvedThreadCount: 3,
      actionableThreadCount: 2,
    });
    assert.equal(result.state, STATE.UNRESOLVED_FEEDBACK_PRESENT, `failed for status=${status}`);
  }
});

// ---------------------------------------------------------------------------
// Regression: already-fixed-but-unresolved requires reply/resolve before re-request
// ---------------------------------------------------------------------------

test("interpretLoopState routes to already_fixed_needs_reply_resolve when agentFixStatus is applied", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewPresent: true,
    unresolvedThreadCount: 2,
    actionableThreadCount: 2,
    agentFixStatus: "applied",
  });
  assert.equal(result.state, STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE);
  assert.deepEqual(result.allowedTransitions, [STATE.READY_TO_REREQUEST_REVIEW]);
  assert.ok(!result.allowedTransitions.includes(STATE.WAITING_FOR_COPILOT_REVIEW),
    "reply/resolve must complete before re-request becomes allowed");
  assert.match(result.nextAction, /reply/i);
});

test("interpretLoopState routes to already_fixed_needs_reply_resolve even with pending request when fix applied", () => {
  // Agent fixed code; re-request should NOT happen before reply/resolve
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "none",
    copilotReviewPresent: true,
    unresolvedThreadCount: 1,
    actionableThreadCount: 1,
    agentFixStatus: "applied",
  });
  assert.equal(result.state, STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE);
  assert.deepEqual(result.allowedTransitions, [STATE.READY_TO_REREQUEST_REVIEW]);
});

// ---------------------------------------------------------------------------
// Regression: unavailable/failed must stop/report, not sleep/watch
// ---------------------------------------------------------------------------

test("interpretLoopState does not enter wait states after unavailable review request", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "unavailable",
    copilotReviewPresent: false,
    unresolvedThreadCount: 0,
  });
  assert.equal(result.state, STATE.REVIEW_REQUEST_UNAVAILABLE);
  assert.notEqual(result.state, STATE.WAITING_FOR_COPILOT_REVIEW);
  assert.notEqual(result.state, STATE.WAITING_FOR_CI);
  assert.deepEqual(result.allowedTransitions, []);
});

test("interpretLoopState does not enter wait states after failed review request", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "failed",
    copilotReviewPresent: false,
    unresolvedThreadCount: 0,
  });
  assert.equal(result.state, STATE.BLOCKED_NEEDS_USER_DECISION);
  assert.notEqual(result.state, STATE.WAITING_FOR_COPILOT_REVIEW);
  assert.deepEqual(result.allowedTransitions, []);
});

// ---------------------------------------------------------------------------
// Normal flow states
// ---------------------------------------------------------------------------

test("interpretLoopState returns pr_ready_no_feedback for open ready PR with no review", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    prDraft: false,
    copilotReviewRequestStatus: "none",
    copilotReviewPresent: false,
    unresolvedThreadCount: 0,
    ciStatus: "success",
  });
  assert.equal(result.state, STATE.PR_READY_NO_FEEDBACK);
  assert.deepEqual(result.allowedTransitions, [STATE.WAITING_FOR_COPILOT_REVIEW]);
});

test("interpretLoopState returns waiting_for_copilot_review when Copilot is in requested_reviewers", () => {
  for (const status of ["requested", "already-requested"]) {
    const result = interpretLoopState({
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: status,
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
    });
    assert.equal(result.state, STATE.WAITING_FOR_COPILOT_REVIEW, `failed for status=${status}`);
  }
});

// ---------------------------------------------------------------------------
// Regression: fresh Copilot review on current head should exit waiting_for_copilot_review
// ---------------------------------------------------------------------------

test("interpretLoopState exits waiting_for_copilot_review when Copilot has a submitted review on current head", () => {
  // Even if requested_reviewers still lists Copilot, a submitted review on the current
  // head means the wait is done.
  for (const status of ["requested", "already-requested"]) {
    const result = interpretLoopState({
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: status,
      copilotReviewPresent: true,
      copilotReviewOnCurrentHead: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });
    assert.notEqual(result.state, STATE.WAITING_FOR_COPILOT_REVIEW,
      `must not remain in waiting_for_copilot_review when copilotReviewOnCurrentHead=true (status=${status})`);
    assert.equal(result.state, STATE.READY_TO_REREQUEST_REVIEW,
      `expected ready_to_rerequest_review when copilotReviewOnCurrentHead=true (status=${status})`);
  }
});

test("interpretLoopState stays in waiting_for_copilot_review when review is not yet on current head", () => {
  // Copilot is in requested_reviewers but has NOT submitted a review on this head yet
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "requested",
    copilotReviewPresent: false,
    copilotReviewOnCurrentHead: false,
    unresolvedThreadCount: 0,
  });
  assert.equal(result.state, STATE.WAITING_FOR_COPILOT_REVIEW);
});

test("interpretLoopState routes to waiting_for_ci when copilotReviewOnCurrentHead and CI is pending", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "requested",
    copilotReviewPresent: true,
    copilotReviewOnCurrentHead: true,
    unresolvedThreadCount: 0,
    ciStatus: "pending",
  });
  assert.equal(result.state, STATE.WAITING_FOR_CI);
  assert.notEqual(result.state, STATE.WAITING_FOR_COPILOT_REVIEW);
});

test("interpretLoopState returns ready_to_rerequest_review when Copilot has reviewed and all threads resolved", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewRequestStatus: "none",
    copilotReviewPresent: true,
    unresolvedThreadCount: 0,
    ciStatus: "success",
  });
  assert.equal(result.state, STATE.READY_TO_REREQUEST_REVIEW);
  assert.ok(result.allowedTransitions.includes(STATE.WAITING_FOR_COPILOT_REVIEW));
  assert.ok(result.allowedTransitions.includes(STATE.DONE));
});

test("interpretLoopState returns waiting_for_ci when CI is pending and no unresolved threads", () => {
  const noCopilotReview = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewPresent: false,
    unresolvedThreadCount: 0,
    ciStatus: "pending",
  });
  assert.equal(noCopilotReview.state, STATE.WAITING_FOR_CI);

  const withCopilotReview = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewPresent: true,
    unresolvedThreadCount: 0,
    ciStatus: "pending",
  });
  assert.equal(withCopilotReview.state, STATE.WAITING_FOR_CI);
});

test("interpretLoopState returns blocked_needs_user_decision for CI failure with no unresolved threads", () => {
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewPresent: true,
    unresolvedThreadCount: 0,
    ciStatus: "failure",
  });
  assert.equal(result.state, STATE.BLOCKED_NEEDS_USER_DECISION);
  assert.deepEqual(result.allowedTransitions, []);
});

test("interpretLoopState does not let CI status override unresolved thread routing", () => {
  // Even with CI failure, unresolved threads take priority
  const result = interpretLoopState({
    prExists: true,
    prNumber: 17,
    copilotReviewPresent: true,
    unresolvedThreadCount: 2,
    actionableThreadCount: 2,
    ciStatus: "failure",
  });
  assert.equal(result.state, STATE.UNRESOLVED_FEEDBACK_PRESENT);
});

// ---------------------------------------------------------------------------
// interpretLoopState — return shape
// ---------------------------------------------------------------------------

test("interpretLoopState always returns state, allowedTransitions array, and non-empty nextAction", () => {
  const snapshots = [
    {},
    { prExists: true, prNumber: 1 },
    { prExists: true, prNumber: 1, prDraft: true },
    { prExists: true, prNumber: 1, copilotReviewRequestStatus: "requested" },
    { prExists: true, prNumber: 1, unresolvedThreadCount: 2 },
    { prExists: true, prNumber: 1, prMerged: true },
  ];

  for (const snapshot of snapshots) {
    const result = interpretLoopState(snapshot);
    assert.ok(typeof result.state === "string" && result.state.length > 0, "state must be non-empty string");
    assert.ok(Array.isArray(result.allowedTransitions), "allowedTransitions must be array");
    assert.ok(typeof result.nextAction === "string" && result.nextAction.length > 0, "nextAction must be non-empty string");
  }
});

test("interpretLoopState allowedTransitions array is a fresh copy each call", () => {
  const result1 = interpretLoopState({ prExists: true, prNumber: 1 });
  const result2 = interpretLoopState({ prExists: true, prNumber: 1 });
  result1.allowedTransitions.push("mutated");
  assert.notDeepEqual(result1.allowedTransitions, result2.allowedTransitions);
});

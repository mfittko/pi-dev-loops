import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTING_OUTCOME,
  LOOP_FAMILY,
  SOURCE_MODE,
  ENTRYPOINT,
  evaluateConductorRouting,
} from "../src/loop/conductor-routing.mjs";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_TARGET = { repo: "acme/my-repo", pr: 42 };

/**
 * Build a minimal valid input for evaluateConductorRouting.
 * All required fields are set to a "continue_wait" scenario by default.
 */
function makeInput(overrides = {}) {
  return {
    target: BASE_TARGET,
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
    outerAction: "continue_wait",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ROUTING_OUTCOME constants
// ---------------------------------------------------------------------------

test("ROUTING_OUTCOME exports all seven required outcome values", () => {
  assert.equal(ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT, "continue_current_wait");
  assert.equal(ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP, "handoff_to_copilot_loop");
  assert.equal(ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP, "handoff_to_reviewer_loop");
  assert.equal(ROUTING_OUTCOME.STAY_WITH_CURRENT_LIVE_OWNER, "stay_with_current_live_owner");
  assert.equal(ROUTING_OUTCOME.STOP_NEEDS_HUMAN, "stop_needs_human");
  assert.equal(ROUTING_OUTCOME.DONE_TERMINAL, "done_terminal");
  assert.equal(ROUTING_OUTCOME.NEEDS_RECONCILE, "needs_reconcile");
  assert.equal(Object.keys(ROUTING_OUTCOME).length, 7);
});

// ---------------------------------------------------------------------------
// LOOP_FAMILY constants
// ---------------------------------------------------------------------------

test("LOOP_FAMILY exports the four required family values", () => {
  assert.equal(LOOP_FAMILY.COPILOT_LOOP, "copilot_loop");
  assert.equal(LOOP_FAMILY.REVIEWER_LOOP, "reviewer_loop");
  assert.equal(LOOP_FAMILY.OUTER_LOOP, "outer_loop");
  assert.equal(LOOP_FAMILY.NONE, null);
  assert.equal(Object.keys(LOOP_FAMILY).length, 4);
});

// ---------------------------------------------------------------------------
// SOURCE_MODE constants
// ---------------------------------------------------------------------------

test("SOURCE_MODE exports the three required mode values", () => {
  assert.equal(SOURCE_MODE.AUTHORITATIVE, "authoritative");
  assert.equal(SOURCE_MODE.LOCAL, "local");
  assert.equal(SOURCE_MODE.SNAPSHOT, "snapshot");
  assert.equal(Object.keys(SOURCE_MODE).length, 3);
});

// ---------------------------------------------------------------------------
// ENTRYPOINT constants
// ---------------------------------------------------------------------------

test("ENTRYPOINT exports the four required entrypoint values", () => {
  assert.equal(ENTRYPOINT.COPILOT_PR_HANDOFF, "copilot_pr_handoff");
  assert.equal(ENTRYPOINT.REVIEWER_LOOP_HANDLER, "reviewer_loop_handler");
  assert.equal(ENTRYPOINT.OUTER_LOOP_WAIT, "outer_loop_wait");
  assert.equal(ENTRYPOINT.NONE, null);
  assert.equal(Object.keys(ENTRYPOINT).length, 4);
});

// ---------------------------------------------------------------------------
// Scenario 1: outer wait remains outer wait → continue_current_wait
// ---------------------------------------------------------------------------

test("outer wait: continue_wait → continue_current_wait", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.OUTER_LOOP);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.OUTER_LOOP_WAIT);
  assert.ok(result.handoffEnvelope.reason.length > 0);
  assert.deepEqual(result.handoffEnvelope.requiredArgs, { repo: "acme/my-repo", pr: 42 });
});

test("outer wait: waiting_for_ci → continue_current_wait", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "continue_wait",
    copilotState: "waiting_for_ci",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.OUTER_LOOP);
});

test("outer wait: reviewer waiting_for_author_followup → continue_current_wait", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "continue_wait",
    copilotState: "pr_ready_no_feedback",
    reviewerState: "waiting_for_author_followup",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
});

// ---------------------------------------------------------------------------
// Scenario 2: reviewer-active routes to reviewer-loop handoff
// ---------------------------------------------------------------------------

test("reviewer active: reenter_reviewer_loop → handoff_to_reviewer_loop", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_reviewer_loop",
    copilotState: "pr_ready_no_feedback",
    reviewerState: "review_requested",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.REVIEWER_LOOP);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.REVIEWER_LOOP_HANDLER);
  assert.ok(result.handoffEnvelope.reason.includes("reviewer_state=review_requested"));
  assert.deepEqual(result.handoffEnvelope.requiredArgs, { repo: "acme/my-repo", pr: 42 });
});

test("reviewer active: review_invalidated → handoff_to_reviewer_loop", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_reviewer_loop",
    copilotState: "pr_ready_no_feedback",
    reviewerState: "review_invalidated",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.REVIEWER_LOOP);
});

// ---------------------------------------------------------------------------
// Scenario 3: Copilot-active routes to Copilot-loop handoff
// ---------------------------------------------------------------------------

test("copilot active: reenter_copilot_loop + unresolved_feedback → handoff_to_copilot_loop", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_copilot_loop",
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.COPILOT_LOOP);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.COPILOT_PR_HANDOFF);
  assert.ok(result.handoffEnvelope.reason.includes("copilot_state=unresolved_feedback_present"));
  assert.deepEqual(result.handoffEnvelope.requiredArgs, { repo: "acme/my-repo", pr: 42 });
});

test("copilot active: reenter_copilot_loop + pr_draft → handoff_to_copilot_loop", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_copilot_loop",
    copilotState: "pr_draft",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.COPILOT_LOOP);
});

test("copilot active: reenter_copilot_loop + ready_to_rerequest → handoff_to_copilot_loop", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_copilot_loop",
    copilotState: "ready_to_rerequest_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP);
});

// ---------------------------------------------------------------------------
// Scenario 4: blocked routes to stop_needs_human
// ---------------------------------------------------------------------------

test("blocked: stop/copilot_blocked → stop_needs_human", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    outerReason: "copilot_blocked",
    copilotState: "blocked_needs_user_decision",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.STOP_NEEDS_HUMAN);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.NONE);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.NONE);
  assert.ok(result.handoffEnvelope.reason.includes("copilot_blocked"));
});

test("blocked: stop/reviewer_blocked → stop_needs_human", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    outerReason: "reviewer_blocked",
    copilotState: "pr_ready_no_feedback",
    reviewerState: "blocked_needs_user_decision",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.STOP_NEEDS_HUMAN);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.NONE);
});

test("blocked: stop/review_unavailable → stop_needs_human", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    outerReason: "review_unavailable",
    copilotState: "review_request_unavailable",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.STOP_NEEDS_HUMAN);
});

test("blocked: stop/pr_not_ready → stop_needs_human", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    outerReason: "pr_not_ready",
    copilotState: "no_pr",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.STOP_NEEDS_HUMAN);
});

test("blocked: stop with no reason → stop_needs_human", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    copilotState: "blocked_needs_user_decision",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.STOP_NEEDS_HUMAN);
  assert.ok(result.handoffEnvelope.reason.includes("blocked"));
});

// ---------------------------------------------------------------------------
// Scenario 5: terminal state routes to done_terminal
// ---------------------------------------------------------------------------

test("terminal: done → done_terminal", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "done",
    copilotState: "done",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.DONE_TERMINAL);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.NONE);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.NONE);
  assert.ok(result.handoffEnvelope.reason.length > 0);
});

// ---------------------------------------------------------------------------
// Scenario 6: conflicting inner/outer signals fail closed to needs_reconcile
// ---------------------------------------------------------------------------

test("conflict: outerAction=done but copilotState=active → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "done",
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.equal(result.handoffEnvelope.loopFamily, LOOP_FAMILY.NONE);
  assert.equal(result.handoffEnvelope.entrypoint, ENTRYPOINT.NONE);
  assert.ok(result.handoffEnvelope.reason.length > 0);
});

test("conflict: copilotState=done but outerAction=reenter_copilot_loop → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_copilot_loop",
    copilotState: "done",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.ok(result.handoffEnvelope.reason.includes("Copilot state 'done' conflicts"));
});

test("conflict: unknown outerAction → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "invented_action",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.ok(result.handoffEnvelope.reason.includes("invented_action"));
});

test("conflict: stop/unknown_state → needs_reconcile (not stop_needs_human)", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "stop",
    outerReason: "unknown_state",
    copilotState: "pr_ready_no_feedback",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.ok(result.handoffEnvelope.reason.includes("unknown_state"));
});

test("conflict: ownership duplicate_local_owners → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({
    ownershipState: "duplicate_local_owners",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));

  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.ok(result.handoffEnvelope.reason.includes("duplicate local owners"));
});

// ---------------------------------------------------------------------------
// Scenario 7: non-target / noise inputs do not alter routing for targeted run
// ---------------------------------------------------------------------------

test("non-target: null target → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ target: null }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
  assert.ok(result.handoffEnvelope.reason.includes("Target identity"));
});

test("non-target: missing repo → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ target: { pr: 42 } }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: non-integer pr → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ target: { repo: "acme/my-repo", pr: "not-a-number" } }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: pr=0 → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ target: { repo: "acme/my-repo", pr: 0 } }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: empty copilotState → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ copilotState: "" }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: missing copilotState → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ copilotState: undefined }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: empty reviewerState → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ reviewerState: "" }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: empty outerAction → needs_reconcile", () => {
  const result = evaluateConductorRouting(makeInput({ outerAction: "" }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.NEEDS_RECONCILE);
});

test("non-target: extra noise fields on input do not affect valid routing", () => {
  // Adding unknown fields should not alter a clean continue_wait decision
  const result = evaluateConductorRouting({
    target: BASE_TARGET,
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
    outerAction: "continue_wait",
    unknownField: "noise",
    anotherNoise: 12345,
  });
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
});

// ---------------------------------------------------------------------------
// Handoff envelope shape
// ---------------------------------------------------------------------------

test("handoffEnvelope has all required fields for every routing outcome", () => {
  const scenarios = [
    makeInput({ outerAction: "continue_wait", copilotState: "waiting_for_copilot_review", reviewerState: "waiting_for_review_request" }),
    makeInput({ outerAction: "reenter_copilot_loop", copilotState: "unresolved_feedback_present", reviewerState: "waiting_for_author_followup" }),
    makeInput({ outerAction: "reenter_reviewer_loop", copilotState: "pr_ready_no_feedback", reviewerState: "review_requested" }),
    makeInput({ outerAction: "stop", outerReason: "copilot_blocked", copilotState: "blocked_needs_user_decision", reviewerState: "waiting_for_review_request" }),
    makeInput({ outerAction: "done", copilotState: "done", reviewerState: "waiting_for_review_request" }),
    makeInput({ target: null }), // needs_reconcile
  ];

  for (const input of scenarios) {
    const result = evaluateConductorRouting(input);
    const env = result.handoffEnvelope;
    assert.ok(typeof result.routingOutcome === "string", "routingOutcome must be a string");
    assert.ok("targetIdentity" in env, "envelope must have targetIdentity");
    assert.ok("loopFamily" in env, "envelope must have loopFamily");
    assert.ok("entrypoint" in env, "envelope must have entrypoint");
    assert.ok(typeof env.reason === "string" && env.reason.length > 0, "envelope must have non-empty reason");
    assert.ok(typeof env.requiredArgs === "object" && env.requiredArgs !== null, "envelope must have requiredArgs object");
    assert.ok(typeof env.requiresLocalIsolation === "boolean", "envelope must have requiresLocalIsolation boolean");
    assert.ok(typeof env.confidence === "string", "envelope must have confidence string");
  }
});

// ---------------------------------------------------------------------------
// requiresLocalIsolation passthrough
// ---------------------------------------------------------------------------

test("requiresLocalIsolation=true is propagated to handoff envelope", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "reenter_copilot_loop",
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
    requiresLocalIsolation: true,
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP);
  assert.equal(result.handoffEnvelope.requiresLocalIsolation, true);
});

test("requiresLocalIsolation defaults to false when not provided", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.handoffEnvelope.requiresLocalIsolation, false);
});

// ---------------------------------------------------------------------------
// Source mode / confidence passthrough
// ---------------------------------------------------------------------------

test("sourceMode=authoritative → confidence=authoritative in envelope", () => {
  const result = evaluateConductorRouting(makeInput({
    sourceMode: "authoritative",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.handoffEnvelope.confidence, SOURCE_MODE.AUTHORITATIVE);
});

test("sourceMode=snapshot → confidence=snapshot in envelope", () => {
  const result = evaluateConductorRouting(makeInput({
    sourceMode: "snapshot",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.handoffEnvelope.confidence, SOURCE_MODE.SNAPSHOT);
});

test("sourceMode defaults to local when not provided", () => {
  const result = evaluateConductorRouting(makeInput({
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.handoffEnvelope.confidence, SOURCE_MODE.LOCAL);
});

// ---------------------------------------------------------------------------
// Target identity normalization
// ---------------------------------------------------------------------------

test("target repo is normalized to lowercase in handoff envelope", () => {
  const result = evaluateConductorRouting(makeInput({
    target: { repo: "ACME/My-Repo", pr: 7 },
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
  assert.equal(result.handoffEnvelope.targetIdentity.repo, "acme/my-repo");
  assert.equal(result.handoffEnvelope.requiredArgs.repo, "acme/my-repo");
});

// ---------------------------------------------------------------------------
// Ownership state: non-duplicate values do not block routing
// ---------------------------------------------------------------------------

test("ownershipState=live_owner does not block routing", () => {
  const result = evaluateConductorRouting(makeInput({
    ownershipState: "live_owner",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT);
});

test("ownershipState=no_record does not block routing", () => {
  const result = evaluateConductorRouting(makeInput({
    ownershipState: "no_record",
    outerAction: "reenter_copilot_loop",
    copilotState: "pr_draft",
    reviewerState: "waiting_for_review_request",
  }));
  assert.equal(result.routingOutcome, ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP);
});

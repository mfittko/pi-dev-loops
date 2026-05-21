import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  USER_INTENT,
  TARGET_TYPE,
  OWNER,
  ACTOR_STATE,
  LOOP_PHASE,
  INTERNAL_STRATEGY,
  COMPATIBILITY_MAP,
  parseUserIntent,
  resolveCanonicalState,
  routeToStrategy,
  routeFromLegacyEntrypoint,
} from "../src/loop/unified-dev-loop.mjs";

// ---------------------------------------------------------------------------
// Constants integrity
// ---------------------------------------------------------------------------

describe("unified-dev-loop constants", () => {
  it("USER_INTENT is frozen with expected values", () => {
    assert.ok(Object.isFrozen(USER_INTENT));
    assert.equal(USER_INTENT.START_ISSUE, "start_issue");
    assert.equal(USER_INTENT.CONTINUE_PR, "continue_pr");
    assert.equal(USER_INTENT.START_LOCAL, "start_local");
    assert.equal(USER_INTENT.START_LOCAL_THEN_LOOP, "start_local_then_loop");
    assert.equal(USER_INTENT.CONTINUE, "continue");
    assert.equal(USER_INTENT.STATUS, "status");
  });

  it("TARGET_TYPE is frozen with expected values", () => {
    assert.ok(Object.isFrozen(TARGET_TYPE));
    assert.equal(TARGET_TYPE.ISSUE, "issue");
    assert.equal(TARGET_TYPE.PR, "pr");
    assert.equal(TARGET_TYPE.LOCAL_BRANCH, "local_branch");
    assert.equal(TARGET_TYPE.NONE, "none");
  });

  it("OWNER is frozen with expected values", () => {
    assert.ok(Object.isFrozen(OWNER));
    assert.equal(OWNER.LOCAL, "local");
    assert.equal(OWNER.COPILOT, "copilot");
    assert.equal(OWNER.EXTERNAL_HUMAN, "external_human");
    assert.equal(OWNER.REVIEWER, "reviewer");
    assert.equal(OWNER.MAINTAINER, "maintainer");
    assert.equal(OWNER.UNKNOWN, "unknown");
  });

  it("INTERNAL_STRATEGY is frozen with expected values", () => {
    assert.ok(Object.isFrozen(INTERNAL_STRATEGY));
    assert.equal(INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION, "local_implementation");
    assert.equal(INTERNAL_STRATEGY.ISSUE_INTAKE, "issue_intake");
    assert.equal(INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP, "copilot_pr_followup");
    assert.equal(INTERNAL_STRATEGY.EXTERNAL_PR_FOLLOWUP, "external_pr_followup");
    assert.equal(INTERNAL_STRATEGY.REVIEWER_FIXER, "reviewer_fixer");
    assert.equal(INTERNAL_STRATEGY.WAIT_WATCH, "wait_watch");
    assert.equal(INTERNAL_STRATEGY.APPROVAL_MERGE, "approval_merge");
    assert.equal(INTERNAL_STRATEGY.NEEDS_CLARIFICATION, "needs_clarification");
  });

  it("COMPATIBILITY_MAP maps old entrypoints correctly", () => {
    assert.ok(Object.isFrozen(COMPATIBILITY_MAP));
    assert.equal(COMPATIBILITY_MAP["dev-loop"], INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
    assert.equal(COMPATIBILITY_MAP["copilot-dev-loop"], INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP);
    assert.equal(COMPATIBILITY_MAP["copilot-autopilot"], INTERNAL_STRATEGY.ISSUE_INTAKE);
  });
});

// ---------------------------------------------------------------------------
// parseUserIntent
// ---------------------------------------------------------------------------

describe("parseUserIntent", () => {
  it("parses 'start dev loop on issue #83'", () => {
    const result = parseUserIntent("start dev loop on issue #83");
    assert.equal(result.intent, USER_INTENT.START_ISSUE);
    assert.equal(result.targetNumber, 83);
  });

  it("parses 'start dev loop on issue 83' (no hash)", () => {
    const result = parseUserIntent("start dev loop on issue 83");
    assert.equal(result.intent, USER_INTENT.START_ISSUE);
    assert.equal(result.targetNumber, 83);
  });

  it("parses 'start issue 42 locally'", () => {
    const result = parseUserIntent("start issue 42 locally");
    assert.equal(result.intent, USER_INTENT.START_LOCAL);
    assert.equal(result.targetNumber, 42);
  });

  it("parses 'start implementing issue 42 locally'", () => {
    const result = parseUserIntent("start implementing issue 42 locally");
    assert.equal(result.intent, USER_INTENT.START_LOCAL);
    assert.equal(result.targetNumber, 42);
  });

  it("parses 'start issue 42 locally, then continue the loop'", () => {
    const result = parseUserIntent("start issue 42 locally, then continue the loop");
    assert.equal(result.intent, USER_INTENT.START_LOCAL_THEN_LOOP);
    assert.equal(result.targetNumber, 42);
  });

  it("parses 'start implementing issue 42 locally then enter dev loop'", () => {
    const result = parseUserIntent("start implementing issue 42 locally then enter dev loop");
    assert.equal(result.intent, USER_INTENT.START_LOCAL_THEN_LOOP);
    assert.equal(result.targetNumber, 42);
  });

  it("parses 'continue dev loop on PR #85'", () => {
    const result = parseUserIntent("continue dev loop on PR #85");
    assert.equal(result.intent, USER_INTENT.CONTINUE_PR);
    assert.equal(result.targetNumber, 85);
  });

  it("parses 'continue PR 85'", () => {
    const result = parseUserIntent("continue PR 85");
    assert.equal(result.intent, USER_INTENT.CONTINUE_PR);
    assert.equal(result.targetNumber, 85);
  });

  it("parses 'continue the current dev loop'", () => {
    const result = parseUserIntent("continue the current dev loop");
    assert.equal(result.intent, USER_INTENT.CONTINUE);
    assert.equal(result.targetNumber, null);
  });

  it("parses 'continue dev loop'", () => {
    const result = parseUserIntent("continue dev loop");
    assert.equal(result.intent, USER_INTENT.CONTINUE);
    assert.equal(result.targetNumber, null);
  });

  it("parses 'status'", () => {
    const result = parseUserIntent("status");
    assert.equal(result.intent, USER_INTENT.STATUS);
  });

  it("parses 'what state is the dev loop in?'", () => {
    const result = parseUserIntent("what state is the dev loop in?");
    assert.equal(result.intent, USER_INTENT.STATUS);
  });

  it("parses 'state is the loop in'", () => {
    const result = parseUserIntent("state is the loop in");
    assert.equal(result.intent, USER_INTENT.STATUS);
  });

  it("returns null intent for empty input", () => {
    const result = parseUserIntent("");
    assert.equal(result.intent, null);
  });

  it("returns null intent for null input", () => {
    const result = parseUserIntent(null);
    assert.equal(result.intent, null);
  });

  it("returns null intent for unrecognized input", () => {
    const result = parseUserIntent("do something weird");
    assert.equal(result.intent, null);
    assert.equal(result.raw, "do something weird");
  });

  it("extracts repo from owner/repo#N pattern", () => {
    const result = parseUserIntent("start dev loop on issue mfittko/pi-dev-loops#83");
    assert.equal(result.intent, USER_INTENT.START_ISSUE);
    assert.equal(result.targetNumber, 83);
    assert.equal(result.repo, "mfittko/pi-dev-loops");
  });
});

// ---------------------------------------------------------------------------
// resolveCanonicalState
// ---------------------------------------------------------------------------

describe("resolveCanonicalState", () => {
  it("returns frozen state with defaults when no signals provided", () => {
    const state = resolveCanonicalState();
    assert.ok(Object.isFrozen(state));
    assert.equal(state.targetType, TARGET_TYPE.NONE);
    assert.equal(state.targetNumber, null);
    assert.equal(state.repo, null);
    assert.equal(state.owner, OWNER.UNKNOWN);
    assert.equal(state.actorState, ACTOR_STATE.IDLE);
    assert.equal(state.loopPhase, LOOP_PHASE.INTAKE);
  });

  it("passes through all provided signals", () => {
    const state = resolveCanonicalState({
      targetType: TARGET_TYPE.PR,
      targetNumber: 85,
      repo: "mfittko/pi-dev-loops",
      owner: OWNER.COPILOT,
      actorState: ACTOR_STATE.IMPLEMENTING,
      loopPhase: LOOP_PHASE.IMPLEMENTATION,
      copilotState: "unresolved_feedback_present",
      reviewerState: "idle",
      ownershipState: "live_owner",
      hasLinkedPR: true,
      linkedPRNumber: 85,
    });
    assert.equal(state.targetType, TARGET_TYPE.PR);
    assert.equal(state.targetNumber, 85);
    assert.equal(state.repo, "mfittko/pi-dev-loops");
    assert.equal(state.owner, OWNER.COPILOT);
    assert.equal(state.actorState, ACTOR_STATE.IMPLEMENTING);
    assert.equal(state.loopPhase, LOOP_PHASE.IMPLEMENTATION);
    assert.equal(state.copilotState, "unresolved_feedback_present");
    assert.equal(state.reviewerState, "idle");
    assert.equal(state.ownershipState, "live_owner");
    assert.equal(state.hasLinkedPR, true);
    assert.equal(state.linkedPRNumber, 85);
  });

  it("is deterministic: same input always yields same output", () => {
    const signals = {
      targetType: TARGET_TYPE.PR,
      targetNumber: 42,
      owner: OWNER.COPILOT,
    };
    const a = resolveCanonicalState(signals);
    const b = resolveCanonicalState(signals);
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// routeToStrategy
// ---------------------------------------------------------------------------

describe("routeToStrategy", () => {
  describe("unparseable intent", () => {
    it("returns NEEDS_CLARIFICATION for null parsedIntent", () => {
      const result = routeToStrategy({
        parsedIntent: null,
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.NEEDS_CLARIFICATION);
      assert.equal(result.actionable, false);
    });

    it("returns NEEDS_CLARIFICATION for missing intent field", () => {
      const result = routeToStrategy({
        parsedIntent: { intent: null, targetNumber: null, repo: null, raw: "" },
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.NEEDS_CLARIFICATION);
      assert.equal(result.actionable, false);
    });
  });

  describe("STATUS intent", () => {
    it("returns actionable status response with no strategy", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("status"),
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, null);
      assert.equal(result.actionable, true);
    });
  });

  describe("START_LOCAL intent", () => {
    it("routes to LOCAL_IMPLEMENTATION", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("start issue 42 locally"),
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
      assert.equal(result.compatibility, "dev-loop");
      assert.equal(result.actionable, true);
    });
  });

  describe("START_LOCAL_THEN_LOOP intent", () => {
    it("routes to LOCAL_IMPLEMENTATION", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("start issue 42 locally, then continue the loop"),
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
      assert.equal(result.compatibility, "dev-loop");
      assert.equal(result.actionable, true);
    });
  });

  describe("START_ISSUE intent", () => {
    it("routes to ISSUE_INTAKE when no linked PR exists", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("start dev loop on issue #83"),
        canonicalState: resolveCanonicalState({ hasLinkedPR: false }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.ISSUE_INTAKE);
      assert.equal(result.compatibility, "copilot-autopilot");
      assert.equal(result.actionable, true);
    });

    it("routes to COPILOT_PR_FOLLOWUP when linked PR exists with copilot state", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("start dev loop on issue #83"),
        canonicalState: resolveCanonicalState({
          hasLinkedPR: true,
          copilotState: "waiting_for_copilot_review",
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP);
      assert.equal(result.compatibility, "copilot-dev-loop");
      assert.equal(result.actionable, true);
    });
  });

  describe("CONTINUE_PR intent", () => {
    it("routes to COPILOT_PR_FOLLOWUP for Copilot-owned PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.COPILOT,
          actorState: ACTOR_STATE.IMPLEMENTING,
          loopPhase: LOOP_PHASE.IMPLEMENTATION,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP);
      assert.equal(result.actionable, true);
    });

    it("routes to EXTERNAL_PR_FOLLOWUP for external human PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.EXTERNAL_HUMAN,
          actorState: ACTOR_STATE.IMPLEMENTING,
          loopPhase: LOOP_PHASE.IMPLEMENTATION,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.EXTERNAL_PR_FOLLOWUP);
      assert.equal(result.actionable, true);
    });

    it("routes to LOCAL_IMPLEMENTATION for locally-owned PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.LOCAL,
          actorState: ACTOR_STATE.IMPLEMENTING,
          loopPhase: LOOP_PHASE.IMPLEMENTATION,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
      assert.equal(result.actionable, true);
    });

    it("routes to REVIEWER_FIXER for PR in review phase", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.COPILOT,
          actorState: ACTOR_STATE.REVIEWING,
          loopPhase: LOOP_PHASE.REVIEW,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.REVIEWER_FIXER);
      assert.equal(result.actionable, true);
    });

    it("routes to WAIT_WATCH for PR in waiting state", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.COPILOT,
          actorState: ACTOR_STATE.WAITING,
          loopPhase: LOOP_PHASE.WAITING,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.WAIT_WATCH);
      assert.equal(result.actionable, true);
    });

    it("routes to APPROVAL_MERGE for merge-ready PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.COPILOT,
          actorState: ACTOR_STATE.MERGE_READY,
          loopPhase: LOOP_PHASE.MERGE,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.APPROVAL_MERGE);
      assert.equal(result.actionable, true);
    });

    it("returns not actionable for done PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          actorState: ACTOR_STATE.DONE,
          loopPhase: LOOP_PHASE.DONE,
        }),
      });
      assert.equal(result.actionable, false);
    });

    it("returns not actionable for blocked PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue PR 85"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          actorState: ACTOR_STATE.BLOCKED,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.NEEDS_CLARIFICATION);
      assert.equal(result.actionable, false);
    });
  });

  describe("CONTINUE intent", () => {
    it("returns NEEDS_CLARIFICATION when nothing is active", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue dev loop"),
        canonicalState: resolveCanonicalState(),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.NEEDS_CLARIFICATION);
      assert.equal(result.actionable, false);
    });

    it("routes to LOCAL_IMPLEMENTATION for active local branch", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue dev loop"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.LOCAL_BRANCH,
          owner: OWNER.LOCAL,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
      assert.equal(result.actionable, true);
    });

    it("routes to ISSUE_INTAKE for active issue without PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue dev loop"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.ISSUE,
          targetNumber: 83,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.ISSUE_INTAKE);
      assert.equal(result.actionable, true);
    });

    it("routes to COPILOT_PR_FOLLOWUP for active Copilot PR", () => {
      const result = routeToStrategy({
        parsedIntent: parseUserIntent("continue dev loop"),
        canonicalState: resolveCanonicalState({
          targetType: TARGET_TYPE.PR,
          targetNumber: 85,
          owner: OWNER.COPILOT,
          actorState: ACTOR_STATE.IMPLEMENTING,
          loopPhase: LOOP_PHASE.IMPLEMENTATION,
        }),
      });
      assert.equal(result.strategy, INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP);
      assert.equal(result.actionable, true);
    });
  });

  describe("determinism", () => {
    it("same inputs always produce same output", () => {
      const intent = parseUserIntent("start dev loop on issue #83");
      const state = resolveCanonicalState({ hasLinkedPR: false });
      const a = routeToStrategy({ parsedIntent: intent, canonicalState: state });
      const b = routeToStrategy({ parsedIntent: intent, canonicalState: state });
      assert.deepEqual(a, b);
    });
  });
});

// ---------------------------------------------------------------------------
// routeFromLegacyEntrypoint
// ---------------------------------------------------------------------------

describe("routeFromLegacyEntrypoint", () => {
  it("routes 'dev-loop' to LOCAL_IMPLEMENTATION with deprecated flag", () => {
    const result = routeFromLegacyEntrypoint("dev-loop");
    assert.equal(result.strategy, INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION);
    assert.equal(result.compatibility, "dev-loop");
    assert.equal(result.deprecated, true);
  });

  it("routes 'copilot-dev-loop' to COPILOT_PR_FOLLOWUP with deprecated flag", () => {
    const result = routeFromLegacyEntrypoint("copilot-dev-loop");
    assert.equal(result.strategy, INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP);
    assert.equal(result.compatibility, "copilot-dev-loop");
    assert.equal(result.deprecated, true);
  });

  it("routes 'copilot-autopilot' to ISSUE_INTAKE with deprecated flag", () => {
    const result = routeFromLegacyEntrypoint("copilot-autopilot");
    assert.equal(result.strategy, INTERNAL_STRATEGY.ISSUE_INTAKE);
    assert.equal(result.compatibility, "copilot-autopilot");
    assert.equal(result.deprecated, true);
  });

  it("returns NEEDS_CLARIFICATION for unknown entrypoint", () => {
    const result = routeFromLegacyEntrypoint("unknown-thing");
    assert.equal(result.strategy, INTERNAL_STRATEGY.NEEDS_CLARIFICATION);
    assert.equal(result.deprecated, false);
  });
});

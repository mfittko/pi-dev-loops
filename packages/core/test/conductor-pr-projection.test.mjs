import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECTION_TRANSITION,
  PROJECTION_REQUIREMENT,
  POST_MERGE_KIND,
  MENTION_TRIGGER,
  defaultProjectionConfig,
  evaluateProjection,
  computeProjectionKey,
  classifyPostMergeKind,
  evaluateMentionEligibility,
} from "../src/loop/conductor-pr-projection.mjs";

// ---------------------------------------------------------------------------
// PROJECTION_TRANSITION constants
// ---------------------------------------------------------------------------

test("PROJECTION_TRANSITION exports all required transition values", () => {
  assert.equal(PROJECTION_TRANSITION.DRAFT_GATE_ENTERED, "draft_gate_entered");
  assert.equal(PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED, "ready_for_review_entered");
  assert.equal(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, "copilot_review_requested");
  assert.equal(PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED, "copilot_settle_wait_entered");
  assert.equal(PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED, "copilot_settle_achieved");
  assert.equal(PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED, "copilot_loop_converged");
  assert.equal(PROJECTION_TRANSITION.FINAL_GATE_COMPLETED, "final_gate_completed");
  assert.equal(PROJECTION_TRANSITION.WAITING_FOR_HUMAN_APPROVAL, "waiting_for_human_approval");
  assert.equal(PROJECTION_TRANSITION.WAITING_FOR_MERGE, "waiting_for_merge");
  assert.equal(PROJECTION_TRANSITION.MERGE_DETECTED, "merge_detected");
  assert.equal(PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION, "blocked_needs_human_decision");
  assert.equal(PROJECTION_TRANSITION.CONDUCTOR_STOP, "conductor_stop");
  assert.equal(PROJECTION_TRANSITION.RECONCILE_REQUIRED, "reconcile_required");
  assert.equal(Object.keys(PROJECTION_TRANSITION).length, 13);
});

// ---------------------------------------------------------------------------
// PROJECTION_REQUIREMENT constants
// ---------------------------------------------------------------------------

test("PROJECTION_REQUIREMENT exports four required output class values", () => {
  assert.equal(PROJECTION_REQUIREMENT.VISIBLE_COMMENT, "visible_comment");
  assert.equal(PROJECTION_REQUIREMENT.DURABLE_ARTIFACT, "durable_artifact");
  assert.equal(PROJECTION_REQUIREMENT.BOTH, "both");
  assert.equal(PROJECTION_REQUIREMENT.NONE, "none");
  assert.equal(Object.keys(PROJECTION_REQUIREMENT).length, 4);
});

// ---------------------------------------------------------------------------
// POST_MERGE_KIND constants
// ---------------------------------------------------------------------------

test("POST_MERGE_KIND exports terminal_closeout and resumable_continuation", () => {
  assert.equal(POST_MERGE_KIND.TERMINAL_CLOSEOUT, "terminal_closeout");
  assert.equal(POST_MERGE_KIND.RESUMABLE_CONTINUATION, "resumable_continuation");
  assert.equal(Object.keys(POST_MERGE_KIND).length, 2);
});

// ---------------------------------------------------------------------------
// MENTION_TRIGGER constants
// ---------------------------------------------------------------------------

test("MENTION_TRIGGER exports required trigger values", () => {
  assert.equal(MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION, "blocked_needs_human_decision");
  assert.equal(MENTION_TRIGGER.RECONCILE_REQUIRED, "reconcile_required");
  assert.equal(MENTION_TRIGGER.CONDUCTOR_STOP_WITH_PENDING_ACTION, "conductor_stop_with_pending_action");
  assert.equal(Object.keys(MENTION_TRIGGER).length, 3);
});

// ---------------------------------------------------------------------------
// defaultProjectionConfig
// ---------------------------------------------------------------------------

test("defaultProjectionConfig returns status comments disabled by default", () => {
  const config = defaultProjectionConfig();
  assert.equal(config.githubStatusComments.enabled, false);
});

test("defaultProjectionConfig returns mentions disabled by default", () => {
  const config = defaultProjectionConfig();
  assert.equal(config.mentions.enabled, false);
});

test("defaultProjectionConfig returns upsert mode for status comments", () => {
  const config = defaultProjectionConfig();
  assert.equal(config.githubStatusComments.mode, "upsert");
});

test("defaultProjectionConfig returns empty allowedUsers for mentions", () => {
  const config = defaultProjectionConfig();
  assert.deepEqual(config.mentions.allowedUsers, []);
});

test("defaultProjectionConfig returns two independent objects on successive calls", () => {
  const a = defaultProjectionConfig();
  const b = defaultProjectionConfig();
  assert.notEqual(a, b);
  a.githubStatusComments.enabled = true;
  assert.equal(b.githubStatusComments.enabled, false);
});

// ---------------------------------------------------------------------------
// computeProjectionKey
// ---------------------------------------------------------------------------

const BASE_TARGET = { repo: "acme/my-repo", pr: 42 };

test("computeProjectionKey returns stable key for known transition + valid target", () => {
  const key = computeProjectionKey(PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED, BASE_TARGET);
  assert.equal(key, "acme/my-repo#42/ready_for_review_entered");
});

test("computeProjectionKey normalizes repo to lowercase", () => {
  const key = computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "Acme/My-Repo", pr: 7 });
  assert.equal(key, "acme/my-repo#7/copilot_review_requested");
});

test("computeProjectionKey returns null for repo values that are not owner/name slugs", () => {
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "not-a-slug", pr: 7 }), null);
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "owner/repo/extra", pr: 7 }), null);
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "owner /repo", pr: 7 }), null);
});


test("computeProjectionKey returns null for repo values with unsafe path segments", () => {
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "owner/..", pr: 7 }), null);
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, { repo: "owner/re\\po", pr: 7 }), null);
});

test("computeProjectionKey returns null for unknown transitions", () => {
  assert.equal(computeProjectionKey("continue_wait", BASE_TARGET), null);
  assert.equal(computeProjectionKey(undefined, BASE_TARGET), null);
});

test("computeProjectionKey returns null for missing target", () => {
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, null), null);
});


test("computeProjectionKey treats null or non-object context as omitted", () => {
  assert.equal(
    computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, BASE_TARGET, null),
    "acme/my-repo#42/merge_detected/terminal_closeout",
  );
  assert.equal(
    computeProjectionKey(PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION, BASE_TARGET, "bad-context"),
    "acme/my-repo#42/blocked_needs_human_decision",
  );
});

test("computeProjectionKey returns null for target with invalid pr", () => {
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "a/b", pr: 0 }), null);
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "a/b", pr: -1 }), null);
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "a/b", pr: 1.5 }), null);
});

test("computeProjectionKey returns null for target with empty repo", () => {
  assert.equal(computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "  ", pr: 1 }), null);
});

test("computeProjectionKey appends postMergeKind for MERGE_DETECTED when provided", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.MERGE_DETECTED,
    BASE_TARGET,
    { postMergeKind: POST_MERGE_KIND.TERMINAL_CLOSEOUT },
  );
  assert.equal(key, "acme/my-repo#42/merge_detected/terminal_closeout");
});

test("computeProjectionKey defaults MERGE_DETECTED postMergeKind to terminal_closeout when omitted", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.MERGE_DETECTED,
    BASE_TARGET,
  );
  assert.equal(key, "acme/my-repo#42/merge_detected/terminal_closeout");
});


test("computeProjectionKey trims and validates MERGE_DETECTED postMergeKind", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.MERGE_DETECTED,
    BASE_TARGET,
    { postMergeKind: `  ${POST_MERGE_KIND.RESUMABLE_CONTINUATION}  ` },
  );
  assert.equal(key, "acme/my-repo#42/merge_detected/resumable_continuation");
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.MERGE_DETECTED,
      BASE_TARGET,
      { postMergeKind: "  unexpected  " },
    ),
    null,
  );
});


test("computeProjectionKey treats undefined/null MERGE_DETECTED postMergeKind as omitted", () => {
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.MERGE_DETECTED,
      BASE_TARGET,
      { postMergeKind: undefined },
    ),
    "acme/my-repo#42/merge_detected/terminal_closeout",
  );
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.MERGE_DETECTED,
      BASE_TARGET,
      { postMergeKind: null },
    ),
    "acme/my-repo#42/merge_detected/terminal_closeout",
  );
});

test("computeProjectionKey does NOT append postMergeKind for non-MERGE_DETECTED transitions", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED,
    BASE_TARGET,
    { postMergeKind: POST_MERGE_KIND.RESUMABLE_CONTINUATION },
  );
  assert.equal(key, "acme/my-repo#42/copilot_loop_converged");
});

test("computeProjectionKey appends blockerKey for BLOCKED transition when provided", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
    BASE_TARGET,
    { blockerKey: "compat-shim-decision" },
  );
  assert.equal(key, "acme/my-repo#42/blocked_needs_human_decision/compat-shim-decision");
});


test("computeProjectionKey returns null for unsafe blockerKey segments", () => {
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
      BASE_TARGET,
      { blockerKey: "needs / decision" },
    ),
    null,
  );
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.RECONCILE_REQUIRED,
      BASE_TARGET,
      { blockerKey: ".." },
    ),
    null,
  );
});


test("computeProjectionKey treats undefined/null blockerKey as omitted", () => {
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
      BASE_TARGET,
      { blockerKey: undefined },
    ),
    "acme/my-repo#42/blocked_needs_human_decision",
  );
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.RECONCILE_REQUIRED,
      BASE_TARGET,
      { blockerKey: null },
    ),
    "acme/my-repo#42/reconcile_required",
  );
});

test("computeProjectionKey appends headSha for COPILOT_SETTLE_WAIT_ENTERED when provided", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED,
    BASE_TARGET,
    { headSha: "abc1234" },
  );
  assert.equal(key, "acme/my-repo#42/copilot_settle_wait_entered/abc1234");
});


test("computeProjectionKey normalizes and validates settle headSha", () => {
  const key = computeProjectionKey(
    PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED,
    BASE_TARGET,
    { headSha: "  ABCDEF1234  " },
  );
  assert.equal(key, "acme/my-repo#42/copilot_settle_achieved/abcdef1234");
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED,
      BASE_TARGET,
      { headSha: "abc 1234" },
    ),
    null,
  );
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED,
      BASE_TARGET,
      { headSha: "abc/1234" },
    ),
    null,
  );
});


test("computeProjectionKey treats undefined/null settle headSha as omitted", () => {
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED,
      BASE_TARGET,
      { headSha: undefined },
    ),
    "acme/my-repo#42/copilot_settle_wait_entered",
  );
  assert.equal(
    computeProjectionKey(
      PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED,
      BASE_TARGET,
      { headSha: null },
    ),
    "acme/my-repo#42/copilot_settle_achieved",
  );
});

test("computeProjectionKey is stable across repeated calls with same inputs", () => {
  const k1 = computeProjectionKey(PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED, BASE_TARGET, { headSha: "def5678" });
  const k2 = computeProjectionKey(PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED, BASE_TARGET, { headSha: "def5678" });
  assert.equal(k1, k2);
});

// ---------------------------------------------------------------------------
// classifyPostMergeKind
// ---------------------------------------------------------------------------

test("classifyPostMergeKind defaults to terminal_closeout when no continuation signal", () => {
  const result = classifyPostMergeKind();
  assert.equal(result.kind, POST_MERGE_KIND.TERMINAL_CLOSEOUT);
});

test("classifyPostMergeKind returns resumable_continuation when hasKnownNextStep=true", () => {
  const result = classifyPostMergeKind({ hasKnownNextStep: true });
  assert.equal(result.kind, POST_MERGE_KIND.RESUMABLE_CONTINUATION);
});

test("classifyPostMergeKind returns resumable_continuation when followUpIssue is present", () => {
  const result = classifyPostMergeKind({ followUpIssue: "#99" });
  assert.equal(result.kind, POST_MERGE_KIND.RESUMABLE_CONTINUATION);
  assert.match(result.reason, /#99/);
});

test("classifyPostMergeKind returns terminal_closeout for empty followUpIssue", () => {
  const result = classifyPostMergeKind({ followUpIssue: "  " });
  assert.equal(result.kind, POST_MERGE_KIND.TERMINAL_CLOSEOUT);
});

test("classifyPostMergeKind returns terminal_closeout for null followUpIssue", () => {
  const result = classifyPostMergeKind({ followUpIssue: null });
  assert.equal(result.kind, POST_MERGE_KIND.TERMINAL_CLOSEOUT);
});

test("classifyPostMergeKind result always has kind and reason", () => {
  const result = classifyPostMergeKind();
  assert.ok(typeof result.kind === "string");
  assert.ok(typeof result.reason === "string");
});

// ---------------------------------------------------------------------------
// evaluateProjection — config-gating tests
// ---------------------------------------------------------------------------

test("evaluateProjection: emitComment=false when githubStatusComments.enabled=false (default)", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED,
    target: BASE_TARGET,
  });
  assert.equal(result.emitComment, false);
});

test("evaluateProjection: emitComment=true when githubStatusComments.enabled=true", () => {
  const config = { ...defaultProjectionConfig(), githubStatusComments: { enabled: true } };
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED,
    target: BASE_TARGET,
    config,
  });
  assert.equal(result.emitComment, true);
});

test("evaluateProjection: emitComment=false for NONE-requirement transitions even when comments enabled", () => {
  const config = { ...defaultProjectionConfig(), githubStatusComments: { enabled: true } };
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.DRAFT_GATE_ENTERED,
    target: BASE_TARGET,
    config,
  });
  assert.equal(result.emitComment, false);
});

// ---------------------------------------------------------------------------
// evaluateProjection — artifact tests
// ---------------------------------------------------------------------------

test("evaluateProjection: emitArtifact=true for MERGE_DETECTED regardless of comments config", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.MERGE_DETECTED,
    target: BASE_TARGET,
    context: { postMergeKind: POST_MERGE_KIND.TERMINAL_CLOSEOUT },
  });
  assert.equal(result.emitArtifact, true);
});

test("evaluateProjection: emitArtifact=true for BLOCKED_NEEDS_HUMAN_DECISION", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
    target: BASE_TARGET,
  });
  assert.equal(result.emitArtifact, true);
});

test("evaluateProjection: emitArtifact=true for CONDUCTOR_STOP", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.CONDUCTOR_STOP,
    target: BASE_TARGET,
  });
  assert.equal(result.emitArtifact, true);
});

test("evaluateProjection: emitArtifact=false for READY_FOR_REVIEW_ENTERED (visible-only)", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED,
    target: BASE_TARGET,
  });
  assert.equal(result.emitArtifact, false);
});

// ---------------------------------------------------------------------------
// evaluateProjection — projectionKey tests
// ---------------------------------------------------------------------------

test("evaluateProjection: projectionKey is present and stable for valid inputs", () => {
  const r1 = evaluateProjection({ transition: PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, target: BASE_TARGET });
  const r2 = evaluateProjection({ transition: PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, target: BASE_TARGET });
  assert.ok(typeof r1.projectionKey === "string");
  assert.equal(r1.projectionKey, r2.projectionKey);
});

test("evaluateProjection: invalid target suppresses projection output", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.MERGE_DETECTED,
    target: null,
    config: { ...defaultProjectionConfig(), githubStatusComments: { enabled: true } },
  });
  assert.equal(result.projectionKey, null);
  assert.equal(result.emitComment, false);
  assert.equal(result.emitArtifact, false);
});


test("evaluateProjection: null or non-object context is treated as empty context", () => {
  const nullContext = evaluateProjection({
    transition: PROJECTION_TRANSITION.MERGE_DETECTED,
    target: BASE_TARGET,
    context: null,
  });
  assert.equal(nullContext.projectionKey, "acme/my-repo#42/merge_detected/terminal_closeout");

  const stringContext = evaluateProjection({
    transition: PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
    target: BASE_TARGET,
    context: "bad-context",
  });
  assert.equal(stringContext.projectionKey, "acme/my-repo#42/blocked_needs_human_decision");
  assert.equal(stringContext.checkMention, true);
});


test("evaluateProjection: invalid projection identity suppresses mention checks", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION,
    target: { repo: "owner/..", pr: 7 },
  });
  assert.equal(result.projectionKey, null);
  assert.equal(result.checkMention, false);
  assert.equal(result.mentionTrigger, null);
});

// ---------------------------------------------------------------------------
// evaluateProjection — checkMention tests
// ---------------------------------------------------------------------------

test("evaluateProjection: checkMention=true for BLOCKED_NEEDS_HUMAN_DECISION", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION, target: BASE_TARGET });
  assert.equal(result.checkMention, true);
});

test("evaluateProjection: checkMention=true for RECONCILE_REQUIRED", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.RECONCILE_REQUIRED, target: BASE_TARGET });
  assert.equal(result.checkMention, true);
  assert.equal(result.mentionTrigger, MENTION_TRIGGER.RECONCILE_REQUIRED);
});

test("evaluateProjection: CONDUCTOR_STOP only requests mention checks when pending action exists", () => {
  const withoutPending = evaluateProjection({ transition: PROJECTION_TRANSITION.CONDUCTOR_STOP, target: BASE_TARGET });
  assert.equal(withoutPending.checkMention, false);
  assert.equal(withoutPending.mentionTrigger, null);

  const withPending = evaluateProjection({
    transition: PROJECTION_TRANSITION.CONDUCTOR_STOP,
    target: BASE_TARGET,
    context: { hasPendingAction: true },
  });
  assert.equal(withPending.checkMention, true);
  assert.equal(withPending.mentionTrigger, MENTION_TRIGGER.CONDUCTOR_STOP_WITH_PENDING_ACTION);
});

test("evaluateProjection: checkMention=false for routine wait transitions", () => {
  const routineTransitions = [
    PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED,
    PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED,
    PROJECTION_TRANSITION.WAITING_FOR_MERGE,
    PROJECTION_TRANSITION.FINAL_GATE_COMPLETED,
    PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED,
    PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED,
    PROJECTION_TRANSITION.WAITING_FOR_HUMAN_APPROVAL,
    PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED,
    PROJECTION_TRANSITION.DRAFT_GATE_ENTERED,
    PROJECTION_TRANSITION.MERGE_DETECTED,
  ];
  for (const t of routineTransitions) {
    const result = evaluateProjection({ transition: t, target: BASE_TARGET });
    assert.equal(result.checkMention, false, `Expected checkMention=false for transition: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// evaluateProjection — unknown transition tests
// ---------------------------------------------------------------------------

test("evaluateProjection: returns safe no-op for unknown transition", () => {
  const result = evaluateProjection({ transition: "not_a_real_transition", target: BASE_TARGET });
  assert.equal(result.emitComment, false);
  assert.equal(result.emitArtifact, false);
  assert.equal(result.projectionKey, null);
  assert.equal(result.checkMention, false);
  assert.match(result.summary, /unknown conductor projection transition/i);
});

test("evaluateProjection: returns safe no-op when transition is missing", () => {
  const result = evaluateProjection({ target: BASE_TARGET });
  assert.equal(result.emitComment, false);
  assert.equal(result.emitArtifact, false);
});

// ---------------------------------------------------------------------------
// evaluateProjection — summary tests
// ---------------------------------------------------------------------------

test("evaluateProjection: summary is a non-empty string for all known transitions", () => {
  const target = BASE_TARGET;
  for (const transition of Object.values(PROJECTION_TRANSITION)) {
    const result = evaluateProjection({ transition, target });
    assert.ok(typeof result.summary === "string" && result.summary.length > 0,
      `Expected non-empty summary for transition: ${transition}`);
  }
});

test("evaluateProjection: MERGE_DETECTED summary mentions continuation when postMergeKind=resumable", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.MERGE_DETECTED,
    target: BASE_TARGET,
    context: { postMergeKind: POST_MERGE_KIND.RESUMABLE_CONTINUATION },
  });
  assert.match(result.summary, /continuation/i);
});

test("evaluateProjection: MERGE_DETECTED summary mentions complete when postMergeKind=terminal", () => {
  const result = evaluateProjection({
    transition: PROJECTION_TRANSITION.MERGE_DETECTED,
    target: BASE_TARGET,
    context: { postMergeKind: POST_MERGE_KIND.TERMINAL_CLOSEOUT },
  });
  assert.match(result.summary, /complete/i);
});

// ---------------------------------------------------------------------------
// evaluateProjection — projectionRequirement field
// ---------------------------------------------------------------------------

test("evaluateProjection: exposes projectionRequirement for caller introspection", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.MERGE_DETECTED, target: BASE_TARGET });
  assert.equal(result.projectionRequirement, PROJECTION_REQUIREMENT.BOTH);
});

test("evaluateProjection: READY_FOR_REVIEW_ENTERED has visible_comment requirement", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED, target: BASE_TARGET });
  assert.equal(result.projectionRequirement, PROJECTION_REQUIREMENT.VISIBLE_COMMENT);
});

test("evaluateProjection: DRAFT_GATE_ENTERED has none requirement", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.DRAFT_GATE_ENTERED, target: BASE_TARGET });
  assert.equal(result.projectionRequirement, PROJECTION_REQUIREMENT.NONE);
});

test("evaluateProjection: CONDUCTOR_STOP has durable_artifact requirement", () => {
  const result = evaluateProjection({ transition: PROJECTION_TRANSITION.CONDUCTOR_STOP, target: BASE_TARGET });
  assert.equal(result.projectionRequirement, PROJECTION_REQUIREMENT.DURABLE_ARTIFACT);
});

// ---------------------------------------------------------------------------
// evaluateMentionEligibility
// ---------------------------------------------------------------------------

function makeMentionConfig(overrides = {}) {
  return {
    ...defaultProjectionConfig(),
    mentions: {
      enabled: true,
      allowedUsers: ["mfittko"],
      cooldownMinutes: 120,
      ...overrides,
    },
  };
}

test("evaluateMentionEligibility: eligible when all criteria satisfied with no prior mention", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide whether to keep the shim or deprecate it.",
  });
  assert.equal(result.eligible, true);
});

test("evaluateMentionEligibility: not eligible when mentions.enabled=false", () => {
  const result = evaluateMentionEligibility({
    config: defaultProjectionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /enabled/i);
});


test("evaluateMentionEligibility: fails closed unless mentions.enabled is exactly true", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ enabled: "false" }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /enabled/i);
});

test("evaluateMentionEligibility: not eligible for unknown trigger", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: "not_a_real_trigger",
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /trigger/i);
});

test("evaluateMentionEligibility: not eligible when mentionUser not in allowedUsers", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ allowedUsers: ["other-user"] }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /allowedUsers/i);
});

test("evaluateMentionEligibility: normalizes mentionUser and allowedUsers case/whitespace", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ allowedUsers: ["  MFITTKO  "] }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, true);
});

test("evaluateMentionEligibility: not eligible when cooldown has not elapsed", () => {
  const nowMs = Date.now();
  const lastMentionAt = nowMs - 30 * 60 * 1000; // 30 min ago, cooldown is 120 min
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ cooldownMinutes: 120 }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt,
    nowMs,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /cooldown/i);
});

test("evaluateMentionEligibility: eligible when cooldown has elapsed", () => {
  const nowMs = Date.now();
  const lastMentionAt = nowMs - 130 * 60 * 1000; // 130 min ago, cooldown is 120 min
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ cooldownMinutes: 120 }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt,
    nowMs,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, true);
});

test("evaluateMentionEligibility: rejects non-numeric cooldownMinutes", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig({ cooldownMinutes: "later" }),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /cooldownMinutes/i);
});

test("evaluateMentionEligibility: rejects non-numeric lastMentionAt", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: "yesterday",
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /lastMentionAt/i);
});

test("evaluateMentionEligibility: not eligible when actionableAsk is missing", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /actionableAsk/i);
});

test("evaluateMentionEligibility: not eligible when actionableAsk is empty string", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "mfittko",
    lastMentionAt: null,
    actionableAsk: "  ",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /actionableAsk/i);
});

test("evaluateMentionEligibility: not eligible when mentionUser is empty", () => {
  const result = evaluateMentionEligibility({
    config: makeMentionConfig(),
    trigger: MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION,
    mentionUser: "",
    lastMentionAt: null,
    actionableAsk: "Please decide.",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /mentionUser/i);
});

// ---------------------------------------------------------------------------
// Idempotency — same transition does not produce different keys across restarts
// ---------------------------------------------------------------------------

test("idempotency: computeProjectionKey is stable across simulated restarts", () => {
  const target = { repo: "owner/project", pr: 100 };
  const context = { postMergeKind: POST_MERGE_KIND.TERMINAL_CLOSEOUT };

  // Simulate two separate 'process instances' both observing the same transition
  const key1 = computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, target, context);
  const key2 = computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, target, context);

  assert.equal(key1, key2);
  assert.equal(typeof key1, "string");
});

test("idempotency: different transitions produce different keys for the same target", () => {
  const target = BASE_TARGET;
  const k1 = computeProjectionKey(PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED, target);
  const k2 = computeProjectionKey(PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED, target);
  assert.notEqual(k1, k2);
});

test("idempotency: same transition on different PRs produces different keys", () => {
  const k1 = computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "a/b", pr: 1 });
  const k2 = computeProjectionKey(PROJECTION_TRANSITION.MERGE_DETECTED, { repo: "a/b", pr: 2 });
  assert.notEqual(k1, k2);
});

// ---------------------------------------------------------------------------
// Authority boundary: lossy outerAction is not accepted as a transition
// ---------------------------------------------------------------------------

test("evaluateProjection treats outerAction values as unknown transitions → safe no-op", () => {
  // outerAction compatibility projections like 'continue_wait', 'stop', 'done'
  // must NOT be treated as authoritative projection transitions.
  const lossy = ["continue_wait", "stop", "done", "reenter_copilot_loop", "reenter_reviewer_loop"];
  for (const t of lossy) {
    const result = evaluateProjection({ transition: t, target: BASE_TARGET });
    assert.equal(result.emitComment, false, `outerAction '${t}' must not emit a comment`);
    assert.equal(result.emitArtifact, false, `outerAction '${t}' must not emit an artifact`);
    assert.equal(result.projectionKey, null, `outerAction '${t}' must not produce an idempotency key`);
    assert.equal(result.projectionRequirement, PROJECTION_REQUIREMENT.NONE);
  }
});

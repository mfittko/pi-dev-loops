import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION,
  OWNERSHIP_STATE,
  OUTCOME,
  normalizeOwnershipKey,
  classifyOwnershipState,
  evaluateOwnershipAction,
} from "../src/loop/conductor-ownership.mjs";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeKey(overrides = {}) {
  return normalizeOwnershipKey({
    repo: "acme/my-repo",
    scopeType: "issue",
    scopeId: "42",
    ...overrides,
  });
}

function makeRecord(overrides = {}) {
  return {
    ownerId: "owner-abc",
    state: "active",
    isWatcher: false,
    ...overrides,
  };
}

function makeAuth(hasLiveOwner, liveOwnerId) {
  return liveOwnerId !== undefined
    ? { hasLiveOwner, liveOwnerId }
    : { hasLiveOwner };
}

// ---------------------------------------------------------------------------
// ACTION constants
// ---------------------------------------------------------------------------

test("ACTION exports the six required action values", () => {
  assert.equal(ACTION.START, "start");
  assert.equal(ACTION.KICKOFF, "kickoff");
  assert.equal(ACTION.RESUME, "resume");
  assert.equal(ACTION.WATCH, "watch");
  assert.equal(ACTION.REQUEST_REVIEW, "request-review");
  assert.equal(ACTION.ASSIGN, "assign");
  assert.equal(Object.keys(ACTION).length, 6);
});

// ---------------------------------------------------------------------------
// OWNERSHIP_STATE constants
// ---------------------------------------------------------------------------

test("OWNERSHIP_STATE exports the six required state values", () => {
  assert.equal(OWNERSHIP_STATE.LIVE_OWNER, "live_owner");
  assert.equal(OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER, "recorded_no_live_owner");
  assert.equal(OWNERSHIP_STATE.STALE_LOCAL_RECORD, "stale_local_record");
  assert.equal(OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS, "duplicate_local_owners");
  assert.equal(OWNERSHIP_STATE.WATCHER_ONLY, "watcher_only");
  assert.equal(OWNERSHIP_STATE.NO_RECORD, "no_record");
  assert.equal(Object.keys(OWNERSHIP_STATE).length, 6);
});

// ---------------------------------------------------------------------------
// OUTCOME constants
// ---------------------------------------------------------------------------

test("OUTCOME exports the seven required outcome values", () => {
  assert.equal(OUTCOME.START_NEW, "start_new");
  assert.equal(OUTCOME.ATTACH_EXISTING_LIVE_OWNER, "attach_existing_live_owner");
  assert.equal(OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE, "resume_recorded_but_not_live_state");
  assert.equal(OUTCOME.NOOP_ALREADY_SATISFIED, "noop_already_satisfied");
  assert.equal(OUTCOME.REJECT_DUPLICATE_OWNER, "reject_duplicate_owner");
  assert.equal(OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME, "needs_reconcile_before_resume");
  assert.equal(OUTCOME.REJECT_AMBIGUOUS_SCOPE, "reject_ambiguous_scope");
  assert.equal(Object.keys(OUTCOME).length, 7);
});

// ---------------------------------------------------------------------------
// normalizeOwnershipKey
// ---------------------------------------------------------------------------

test("normalizeOwnershipKey rejects non-object input", () => {
  assert.throws(() => normalizeOwnershipKey(null), /non-null object/);
  assert.throws(() => normalizeOwnershipKey(undefined), /non-null object/);
  assert.throws(() => normalizeOwnershipKey("string"), /non-null object/);
});

test("normalizeOwnershipKey rejects missing or empty repo", () => {
  assert.throws(() => normalizeOwnershipKey({ scopeType: "issue", scopeId: "1" }), /repo/);
  assert.throws(() => normalizeOwnershipKey({ repo: "  ", scopeType: "issue", scopeId: "1" }), /repo/);
});

test("normalizeOwnershipKey rejects repo without slash", () => {
  assert.throws(
    () => normalizeOwnershipKey({ repo: "no-slash-repo", scopeType: "issue", scopeId: "1" }),
    /owner\/name/,
  );
});

test("normalizeOwnershipKey rejects malformed owner/name repo slugs", () => {
  for (const repo of ["owner/", "/repo", "owner/repo/extra", "owner name/repo", "owner/repo name"]) {
    assert.throws(
      () => normalizeOwnershipKey({ repo, scopeType: "issue", scopeId: "1" }),
      /owner\/name/,
      `expected rejection for repo '${repo}'`,
    );
  }
});

test("normalizeOwnershipKey canonicalizes repo slug case", () => {
  const key = normalizeOwnershipKey({ repo: "Acme/My-Repo", scopeType: "issue", scopeId: 42 });
  assert.equal(key.repo, "acme/my-repo");
  assert.equal(key.keyString, "acme/my-repo:issue:42");
});

test("normalizeOwnershipKey rejects invalid scopeType", () => {
  assert.throws(
    () => normalizeOwnershipKey({ repo: "a/b", scopeType: "unknown", scopeId: "1" }),
    /scopeType must be one of/,
  );
});

test("normalizeOwnershipKey rejects other invalid scopeType strings", () => {
  for (const scopeType of ["ticket", "epic", "task", "sprint", "", "  "]) {
    assert.throws(
      () => normalizeOwnershipKey({ repo: "a/b", scopeType, scopeId: "1" }),
      /scopeType must be one of/,
      `expected rejection for scopeType '${scopeType}'`,
    );
  }
});

test("normalizeOwnershipKey rejects missing or empty scopeId", () => {
  assert.throws(
    () => normalizeOwnershipKey({ repo: "a/b", scopeType: "issue" }),
    /scopeId/,
  );
  assert.throws(
    () => normalizeOwnershipKey({ repo: "a/b", scopeType: "issue", scopeId: "" }),
    /scopeId/,
  );
});

test("normalizeOwnershipKey returns normalized fields and stable keyString", () => {
  const key = normalizeOwnershipKey({ repo: "  acme/repo  ", scopeType: "issue", scopeId: 42 });
  assert.equal(key.repo, "acme/repo");
  assert.equal(key.scopeType, "issue");
  assert.equal(key.scopeId, "42");
  assert.equal(key.keyString, "acme/repo:issue:42");
  assert.equal(key.isAmbiguous, false);
});

test("normalizeOwnershipKey accepts all valid scopeType values", () => {
  for (const scopeType of ["issue", "pr", "branch", "generic"]) {
    const key = normalizeOwnershipKey({ repo: "a/b", scopeType, scopeId: "x" });
    assert.equal(key.scopeType, scopeType);
  }
});

test("normalizeOwnershipKey flags wildcard scopeId as ambiguous", () => {
  for (const scopeId of ["*", "42*", "?", "[123]", "{a,b}"]) {
    const key = normalizeOwnershipKey({ repo: "a/b", scopeType: "issue", scopeId });
    assert.equal(key.isAmbiguous, true, `expected ambiguous for scopeId '${scopeId}'`);
  }
});

test("normalizeOwnershipKey flags 'unknown' and 'any' scopeId as ambiguous", () => {
  assert.equal(normalizeOwnershipKey({ repo: "a/b", scopeType: "issue", scopeId: "unknown" }).isAmbiguous, true);
  assert.equal(normalizeOwnershipKey({ repo: "a/b", scopeType: "issue", scopeId: "any" }).isAmbiguous, true);
});

test("normalizeOwnershipKey excludes noise fields from identity", () => {
  // runId, processId, timestamps should not appear in keyString
  const key = normalizeOwnershipKey({
    repo: "a/b",
    scopeType: "pr",
    scopeId: "99",
    runId: "run-xyz",
    processId: "pid-123",
    createdAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(key.keyString, "a/b:pr:99");
  assert.ok(!("runId" in key));
  assert.ok(!("processId" in key));
  assert.ok(!("createdAt" in key));
});

// ---------------------------------------------------------------------------
// classifyOwnershipState
// ---------------------------------------------------------------------------

test("classifyOwnershipState returns NO_RECORD for empty records", () => {
  assert.equal(classifyOwnershipState([]), OWNERSHIP_STATE.NO_RECORD);
  assert.equal(classifyOwnershipState(null), OWNERSHIP_STATE.NO_RECORD);
  assert.equal(classifyOwnershipState(undefined), OWNERSHIP_STATE.NO_RECORD);
});

test("classifyOwnershipState rejects non-array localRecords input", () => {
  assert.throws(() => classifyOwnershipState({ ownerId: "x", state: "active" }), /localRecords must be an array/);
});

test("classifyOwnershipState returns LIVE_OWNER for one active non-watcher record", () => {
  const records = [makeRecord({ state: "active" })];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.LIVE_OWNER);
});

test("classifyOwnershipState returns LIVE_OWNER when authoritative confirms live owner", () => {
  // Even with no local records, authoritative signal wins
  assert.equal(
    classifyOwnershipState([], makeAuth(true, "owner-remote")),
    OWNERSHIP_STATE.LIVE_OWNER,
  );
});

test("classifyOwnershipState keeps duplicate-local-owner state when authoritative reports a live owner", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "active" }),
  ];
  assert.equal(
    classifyOwnershipState(records, makeAuth(true, "owner-remote")),
    OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS,
  );
});

test("classifyOwnershipState treats mixed active + inactive non-terminal records as duplicate owners", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "inactive" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS);
  assert.equal(classifyOwnershipState(records, makeAuth(true, "owner-remote")), OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS);
});

test("classifyOwnershipState returns DUPLICATE_LOCAL_OWNERS for two active non-watcher records", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "active" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS);
});

test("classifyOwnershipState returns RECORDED_NO_LIVE_OWNER for one inactive non-watcher record", () => {
  const records = [makeRecord({ state: "inactive" })];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER);
});

test("classifyOwnershipState returns DUPLICATE_LOCAL_OWNERS for multiple inactive non-watcher records", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "inactive" }),
    makeRecord({ ownerId: "owner-2", state: "inactive" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS);
});

test("classifyOwnershipState returns STALE_LOCAL_RECORD for one stale non-watcher record", () => {
  const records = [makeRecord({ state: "stale" })];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.STALE_LOCAL_RECORD);
});

test("classifyOwnershipState returns WATCHER_ONLY for watcher-only records", () => {
  const records = [
    makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" }),
    makeRecord({ ownerId: "watcher-2", isWatcher: true, state: "inactive" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.WATCHER_ONLY);
});

test("classifyOwnershipState returns NO_RECORD when only terminal records exist", () => {
  const records = [makeRecord({ state: "terminal" })];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.NO_RECORD);
});

test("classifyOwnershipState: authoritative no-live-owner overrides local active record", () => {
  // Local says active, but authoritative says no live owner → RECORDED_NO_LIVE_OWNER
  const records = [makeRecord({ state: "active" })];
  assert.equal(
    classifyOwnershipState(records, makeAuth(false)),
    OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER,
  );
});

test("classifyOwnershipState: authoritative no-live-owner with two active locals → DUPLICATE_LOCAL_OWNERS", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "active" }),
  ];
  assert.equal(
    classifyOwnershipState(records, makeAuth(false)),
    OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS,
  );
});

test("classifyOwnershipState throws when authoritativeLiveState.hasLiveOwner is not boolean", () => {
  assert.throws(
    () => classifyOwnershipState([], { hasLiveOwner: "yes" }),
    /hasLiveOwner must be a boolean/,
  );
});

test("classifyOwnershipState rejects invalid record state", () => {
  assert.throws(
    () => classifyOwnershipState([{ ownerId: "x", state: "unknown" }]),
    /state must be one of/,
  );
});

test("classifyOwnershipState rejects record missing ownerId", () => {
  assert.throws(
    () => classifyOwnershipState([{ state: "active" }]),
    /ownerId/,
  );
});

// ---------------------------------------------------------------------------
// evaluateOwnershipAction — input validation
// ---------------------------------------------------------------------------

test("evaluateOwnershipAction throws for unknown action", () => {
  const key = makeKey();
  assert.throws(
    () => evaluateOwnershipAction("bogus", key, []),
    /action must be one of/,
  );
});

test("evaluateOwnershipAction throws when ownershipKey is not a normalized key", () => {
  assert.throws(
    () => evaluateOwnershipAction(ACTION.START, null, []),
    /normalized ownershipKey/,
  );
  assert.throws(
    () => evaluateOwnershipAction(ACTION.START, { notAKey: true }, []),
    /normalized ownershipKey/,
  );
});

test("evaluateOwnershipAction rejects partially constructed ownershipKey objects", () => {
  assert.throws(
    () => evaluateOwnershipAction(ACTION.START, { repo: "a/b", scopeType: "issue", scopeId: "*", keyString: "a/b:issue:*", isAmbiguous: false }, []),
    /normalized ownershipKey/,
  );
});

// ---------------------------------------------------------------------------
// Scenario 1: repeated `start` against an already-live equivalent scope
// ---------------------------------------------------------------------------

test("[scenario] repeated start against already-live scope → attach_existing_live_owner (authoritative)", () => {
  const key = makeKey();
  const records = [makeRecord()];
  const result = evaluateOwnershipAction(ACTION.START, key, records, makeAuth(true, "live-owner-1"));

  assert.equal(result.outcome, OUTCOME.ATTACH_EXISTING_LIVE_OWNER);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

test("[scenario] repeated start against already-live scope (local only) → attach + requires auth check", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  // No authoritative signal supplied
  const result = evaluateOwnershipAction(ACTION.START, key, records, null);

  assert.equal(result.outcome, OUTCOME.ATTACH_EXISTING_LIVE_OWNER);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("[scenario] kickoff is treated as start alias — same outcome as start", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  const auth = makeAuth(true);

  const startResult = evaluateOwnershipAction(ACTION.START, key, records, auth);
  const kickoffResult = evaluateOwnershipAction(ACTION.KICKOFF, key, records, auth);

  assert.equal(kickoffResult.outcome, startResult.outcome);
  assert.equal(kickoffResult.allowOwnerCreation, startResult.allowOwnerCreation);
  assert.equal(kickoffResult.requiresAuthoritativeConsultation, startResult.requiresAuthoritativeConsultation);
});

// ---------------------------------------------------------------------------
// Scenario 2: `resume` with recorded non-terminal state and no live owner
// ---------------------------------------------------------------------------

test("[scenario] resume with recorded non-terminal state + authoritative no-live-owner → resume_recorded_but_not_live_state", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "inactive" })];
  const result = evaluateOwnershipAction(ACTION.RESUME, key, records, makeAuth(false));

  assert.equal(result.outcome, OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

test("[scenario] resume with recorded non-terminal state + no authoritative signal → needs_reconcile_before_resume", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "inactive" })];
  const result = evaluateOwnershipAction(ACTION.RESUME, key, records, null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("multiple inactive resume candidates are rejected as duplicate owners", () => {
  const key = makeKey();
  const records = [
    makeRecord({ ownerId: "owner-1", state: "inactive" }),
    makeRecord({ ownerId: "owner-2", state: "inactive" }),
  ];
  const result = evaluateOwnershipAction(ACTION.RESUME, key, records, makeAuth(false));

  assert.equal(result.outcome, OUTCOME.REJECT_DUPLICATE_OWNER);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("mixed active and inactive owner records are rejected as duplicate owners", () => {
  const key = makeKey();
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "inactive" }),
  ];
  const result = evaluateOwnershipAction(ACTION.START, key, records, makeAuth(true, "owner-remote"));

  assert.equal(result.outcome, OUTCOME.REJECT_DUPLICATE_OWNER);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

// ---------------------------------------------------------------------------
// Scenario 3: `watch` against an active run owned elsewhere
// ---------------------------------------------------------------------------

test("[scenario] watch against active run → noop_already_satisfied, non-owning", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "other-owner", state: "active" })];
  const result = evaluateOwnershipAction(ACTION.WATCH, key, records, makeAuth(true, "other-owner"));

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

test("[scenario] watch with no records → noop_already_satisfied, non-owning", () => {
  const key = makeKey();
  const result = evaluateOwnershipAction(ACTION.WATCH, key, [], null);

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.allowOwnerCreation, false);
});

test("[scenario] watch with watcher records → noop_already_satisfied, non-owning", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "watcher-1", isWatcher: true })];
  const result = evaluateOwnershipAction(ACTION.WATCH, key, records, null);

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.allowOwnerCreation, false);
});

// ---------------------------------------------------------------------------
// Scenario 4: duplicate local owner records for one clear scope
// ---------------------------------------------------------------------------

test("[scenario] duplicate local owner records → reject_duplicate_owner", () => {
  const key = makeKey();
  const records = [
    makeRecord({ ownerId: "owner-1" }),
    makeRecord({ ownerId: "owner-2" }),
  ];
  const result = evaluateOwnershipAction(ACTION.START, key, records, null);

  assert.equal(result.outcome, OUTCOME.REJECT_DUPLICATE_OWNER);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("[scenario] duplicate local owners → reject_duplicate_owner for all owning actions", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "a" }), makeRecord({ ownerId: "b" })];

  for (const action of [ACTION.START, ACTION.KICKOFF, ACTION.RESUME, ACTION.REQUEST_REVIEW, ACTION.ASSIGN]) {
    const result = evaluateOwnershipAction(action, key, records, null);
    assert.equal(result.outcome, OUTCOME.REJECT_DUPLICATE_OWNER, `expected REJECT_DUPLICATE_OWNER for action '${action}'`);
  }
});

// ---------------------------------------------------------------------------
// Scenario 5: stale local owner record with no live owner
// ---------------------------------------------------------------------------

test("[scenario] stale local record + start → start_new (stale overrideable)", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "stale" })];
  const result = evaluateOwnershipAction(ACTION.START, key, records, null);

  assert.equal(result.outcome, OUTCOME.START_NEW);
  assert.equal(result.allowOwnerCreation, true);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

test("[scenario] stale local record + request-review → needs_reconcile_before_resume", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "stale" })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.allowOwnerCreation, false);
});

// ---------------------------------------------------------------------------
// Scenario 6: ambiguous scope equivalence
// ---------------------------------------------------------------------------

test("[scenario] ambiguous scopeId → reject_ambiguous_scope regardless of action", () => {
  const ambiguousKey = makeKey({ scopeId: "*" });

  for (const action of [ACTION.START, ACTION.RESUME, ACTION.WATCH, ACTION.REQUEST_REVIEW, ACTION.ASSIGN]) {
    const result = evaluateOwnershipAction(action, ambiguousKey, [], null);
    assert.equal(result.outcome, OUTCOME.REJECT_AMBIGUOUS_SCOPE, `expected REJECT_AMBIGUOUS_SCOPE for action '${action}'`);
    assert.equal(result.allowOwnerCreation, false);
  }
});

test("[scenario] ambiguous scope 'unknown' → reject_ambiguous_scope", () => {
  const ambiguousKey = makeKey({ scopeId: "unknown" });
  const result = evaluateOwnershipAction(ACTION.START, ambiguousKey, [], null);
  assert.equal(result.outcome, OUTCOME.REJECT_AMBIGUOUS_SCOPE);
});

// ---------------------------------------------------------------------------
// Scenario 7: conflicting local vs authoritative state
// ---------------------------------------------------------------------------

test("[scenario] conflicting local (active) vs authoritative (no live owner) → authoritative wins → RECORDED_NO_LIVE_OWNER", () => {
  // Local says active but authoritative says no live owner
  const records = [makeRecord({ state: "active" })];
  const ownershipState = classifyOwnershipState(records, makeAuth(false));
  assert.equal(ownershipState, OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER);
});

test("[scenario] conflicting local vs authoritative → start sees resume_recorded_but_not_live_state", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })]; // local says active
  // Authoritative says no live owner — authoritative wins
  const result = evaluateOwnershipAction(ACTION.START, key, records, makeAuth(false));

  assert.equal(result.outcome, OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE);
  assert.equal(result.allowOwnerCreation, false);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

// ---------------------------------------------------------------------------
// Scenario 8: `request-review` and `assign` against an already-satisfied scope
// ---------------------------------------------------------------------------

test("[scenario] request-review against live owner → noop_already_satisfied", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, makeAuth(true));

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.allowOwnerCreation, false);
});

test("request-review against local-only live owner still requires authoritative consultation", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, null);

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("assign against local-only live owner still requires authoritative consultation", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  const result = evaluateOwnershipAction(ACTION.ASSIGN, key, records, null);

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("[scenario] assign against live owner → noop_already_satisfied", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "active" })];
  const result = evaluateOwnershipAction(ACTION.ASSIGN, key, records, makeAuth(true));

  assert.equal(result.outcome, OUTCOME.NOOP_ALREADY_SATISFIED);
  assert.equal(result.allowOwnerCreation, false);
});

test("[scenario] request-review with no record → needs_reconcile_before_resume", () => {
  const key = makeKey();
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, [], null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.allowOwnerCreation, false);
});

test("[scenario] assign with no record → needs_reconcile_before_resume", () => {
  const key = makeKey();
  const result = evaluateOwnershipAction(ACTION.ASSIGN, key, [], null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.allowOwnerCreation, false);
});

test("request-review with no record requires authoritative consultation", () => {
  const key = makeKey();
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, [], null);

  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("assign with stale local record requires authoritative consultation", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "stale" })];
  const result = evaluateOwnershipAction(ACTION.ASSIGN, key, records, null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("request-review with watcher-only records requires authoritative consultation", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "watcher-1", isWatcher: true })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("start with duplicate local owners stays reject_duplicate_owner even when authoritative reports live owner", () => {
  const key = makeKey();
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "owner-2", state: "active" }),
  ];
  const result = evaluateOwnershipAction(ACTION.START, key, records, makeAuth(true, "owner-remote"));

  assert.equal(result.outcome, OUTCOME.REJECT_DUPLICATE_OWNER);
  assert.equal(result.requiresAuthoritativeConsultation, true);
});

test("[scenario] request-review with recorded-no-live-owner + auth → resume_recorded_but_not_live_state", () => {
  const key = makeKey();
  const records = [makeRecord({ state: "inactive" })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, makeAuth(false));

  assert.equal(result.outcome, OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE);
  assert.equal(result.allowOwnerCreation, false);
});

// ---------------------------------------------------------------------------
// Watcher-ownership separation tests
// ---------------------------------------------------------------------------

test("watcher record does not satisfy conductor ownership for start", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" })];
  const result = evaluateOwnershipAction(ACTION.START, key, records, null);

  // Watcher-only records should allow a new owner to be created
  assert.equal(result.outcome, OUTCOME.START_NEW);
  assert.equal(result.allowOwnerCreation, true);
});

test("watcher record does not satisfy conductor ownership for resume", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" })];
  const result = evaluateOwnershipAction(ACTION.RESUME, key, records, null);

  assert.equal(result.outcome, OUTCOME.START_NEW);
  assert.equal(result.allowOwnerCreation, true);
});

test("watcher record does not satisfy conductor ownership for request-review", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" })];
  const result = evaluateOwnershipAction(ACTION.REQUEST_REVIEW, key, records, null);

  assert.equal(result.outcome, OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME);
  assert.equal(result.allowOwnerCreation, false);
});

test("watch action cannot create an owner regardless of ownership state", () => {
  const key = makeKey();

  // No record
  assert.equal(evaluateOwnershipAction(ACTION.WATCH, key, [], null).allowOwnerCreation, false);

  // Live owner
  const active = [makeRecord()];
  assert.equal(evaluateOwnershipAction(ACTION.WATCH, key, active, makeAuth(true)).allowOwnerCreation, false);

  // Duplicate owners
  const dup = [makeRecord({ ownerId: "a" }), makeRecord({ ownerId: "b" })];
  assert.equal(evaluateOwnershipAction(ACTION.WATCH, key, dup, null).allowOwnerCreation, false);
});

// ---------------------------------------------------------------------------
// start-with-no-record scenario
// ---------------------------------------------------------------------------

test("[scenario] start with no record → start_new", () => {
  const key = makeKey();
  const result = evaluateOwnershipAction(ACTION.START, key, [], null);

  assert.equal(result.outcome, OUTCOME.START_NEW);
  assert.equal(result.allowOwnerCreation, true);
  assert.equal(result.requiresAuthoritativeConsultation, false);
});

// ---------------------------------------------------------------------------
// Repeated equivalent requests converge on one effective owner
// ---------------------------------------------------------------------------

test("repeated equivalent start/kickoff/resume requests converge on one effective owner", () => {
  const key = makeKey();
  const records = [makeRecord({ ownerId: "existing-owner", state: "active" })];
  const auth = makeAuth(true, "existing-owner");

  for (const action of [ACTION.START, ACTION.KICKOFF, ACTION.RESUME]) {
    const result = evaluateOwnershipAction(action, key, records, auth);
    assert.equal(
      result.outcome,
      OUTCOME.ATTACH_EXISTING_LIVE_OWNER,
      `action '${action}' should converge on existing live owner`,
    );
    assert.equal(result.allowOwnerCreation, false, `action '${action}' must not create a new owner`);
  }
});

// ---------------------------------------------------------------------------
// Authoritative-state precedence proof
// ---------------------------------------------------------------------------

test("authoritative live-owner signal overrides empty local records", () => {
  const state = classifyOwnershipState([], makeAuth(true, "remote-owner"));
  assert.equal(state, OWNERSHIP_STATE.LIVE_OWNER);
});

test("authoritative no-live-owner signal overrides local active record", () => {
  const records = [makeRecord({ state: "active" })];
  const state = classifyOwnershipState(records, makeAuth(false));
  assert.equal(state, OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER);
});

// ---------------------------------------------------------------------------
// keyString uniqueness: near-matching but non-equivalent scopes
// ---------------------------------------------------------------------------

test("near-matching but non-equivalent scopes produce different keyStrings", () => {
  const key1 = normalizeOwnershipKey({ repo: "acme/repo", scopeType: "issue", scopeId: "42" });
  const key2 = normalizeOwnershipKey({ repo: "acme/repo", scopeType: "issue", scopeId: "43" });
  const key3 = normalizeOwnershipKey({ repo: "acme/repo", scopeType: "pr", scopeId: "42" });
  const key4 = normalizeOwnershipKey({ repo: "other/repo", scopeType: "issue", scopeId: "42" });

  assert.notEqual(key1.keyString, key2.keyString);
  assert.notEqual(key1.keyString, key3.keyString);
  assert.notEqual(key1.keyString, key4.keyString);
});

// ---------------------------------------------------------------------------
// classifyOwnershipState: mixed watcher + terminal owner records
// ---------------------------------------------------------------------------

test("terminal owner records with watchers → WATCHER_ONLY", () => {
  const records = [
    makeRecord({ ownerId: "old-owner", state: "terminal" }),
    makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.WATCHER_ONLY);
});

test("active owner with watcher records → LIVE_OWNER (owner takes precedence)", () => {
  const records = [
    makeRecord({ ownerId: "owner-1", state: "active" }),
    makeRecord({ ownerId: "watcher-1", isWatcher: true, state: "active" }),
  ];
  assert.equal(classifyOwnershipState(records), OWNERSHIP_STATE.LIVE_OWNER);
});

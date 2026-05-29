import assert from "node:assert/strict";
import test from "node:test";

import {
  ASYNC_START_STATUS,
  PI_ASYNC_CONTEXT_MARKERS,
  PI_ASYNC_START_BYPASS_VAR,
  buildAsyncStartRejection,
  validateAsyncStartContext,
} from "../src/loop/async-start-contract.mjs";

// ---------------------------------------------------------------------------
// validateAsyncStartContext: rejection (no markers present)
// ---------------------------------------------------------------------------

test("validateAsyncStartContext: rejects when no Pi context markers are present", () => {
  const result = validateAsyncStartContext({ env: {} });
  assert.equal(result.status, ASYNC_START_STATUS.REJECTED);
  assert.equal(result.detectedMarker, null);
  assert.ok(result.reason.includes("No Pi-managed async context detected"));
});

test("validateAsyncStartContext: rejects when markers are empty strings", () => {
  const env = {
    PI_SUBAGENT_RUN_ID: "",
    PI_SESSION_ID: "",
    PI_ASYNC_CONTEXT: "",
  };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.REJECTED);
});

test("validateAsyncStartContext: rejects when markers are whitespace-only", () => {
  const env = {
    PI_SUBAGENT_RUN_ID: "   ",
    PI_SESSION_ID: "\t",
    PI_ASYNC_CONTEXT: " ",
  };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.REJECTED);
});

// ---------------------------------------------------------------------------
// validateAsyncStartContext: valid (Pi-managed context detected)
// ---------------------------------------------------------------------------

test("validateAsyncStartContext: valid when PI_SUBAGENT_RUN_ID is set", () => {
  const env = { PI_SUBAGENT_RUN_ID: "run-abc123" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.VALID);
  assert.equal(result.detectedMarker, "PI_SUBAGENT_RUN_ID");
});

test("validateAsyncStartContext: valid when PI_SESSION_ID is set", () => {
  const env = { PI_SESSION_ID: "session-xyz" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.VALID);
  assert.equal(result.detectedMarker, "PI_SESSION_ID");
});

test("validateAsyncStartContext: valid when PI_ASYNC_CONTEXT is set", () => {
  const env = { PI_ASYNC_CONTEXT: "1" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.VALID);
  assert.equal(result.detectedMarker, "PI_ASYNC_CONTEXT");
});

test("validateAsyncStartContext: first matching marker wins (priority order)", () => {
  const env = {
    PI_SUBAGENT_RUN_ID: "run-1",
    PI_SESSION_ID: "sess-2",
    PI_ASYNC_CONTEXT: "1",
  };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.VALID);
  assert.equal(result.detectedMarker, "PI_SUBAGENT_RUN_ID");
});

// ---------------------------------------------------------------------------
// validateAsyncStartContext: bypass
// ---------------------------------------------------------------------------

test("validateAsyncStartContext: bypassed when PI_ASYNC_START_BYPASS=1", () => {
  const env = { [PI_ASYNC_START_BYPASS_VAR]: "1" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.BYPASSED);
  assert.equal(result.detectedMarker, null);
  assert.ok(result.reason.includes("bypassed"));
});

test("validateAsyncStartContext: bypass does not require context markers", () => {
  // Only bypass set, no other markers
  const env = { PI_ASYNC_START_BYPASS: "1" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.BYPASSED);
});

test("validateAsyncStartContext: bypass not triggered for non-1 values", () => {
  const env = { PI_ASYNC_START_BYPASS: "true" };
  const result = validateAsyncStartContext({ env });
  assert.equal(result.status, ASYNC_START_STATUS.REJECTED);
});

// ---------------------------------------------------------------------------
// validateAsyncStartContext: snapshot mode
// ---------------------------------------------------------------------------

test("validateAsyncStartContext: snapshot mode skips the check", () => {
  const result = validateAsyncStartContext({ env: {}, isSnapshotMode: true });
  assert.equal(result.status, ASYNC_START_STATUS.SNAPSHOT_MODE);
  assert.equal(result.detectedMarker, null);
});

test("validateAsyncStartContext: snapshot mode takes priority over bypass", () => {
  const env = { PI_ASYNC_START_BYPASS: "1" };
  const result = validateAsyncStartContext({ env, isSnapshotMode: true });
  assert.equal(result.status, ASYNC_START_STATUS.SNAPSHOT_MODE);
});

// ---------------------------------------------------------------------------
// buildAsyncStartRejection
// ---------------------------------------------------------------------------

test("buildAsyncStartRejection: builds error payload from rejected validation", () => {
  const validation = validateAsyncStartContext({ env: {} });
  const rejection = buildAsyncStartRejection(validation);
  assert.equal(rejection.ok, false);
  assert.equal(rejection.asyncStartContract, "rejected");
  assert.ok(rejection.error.includes("No Pi-managed async context detected"));
});

// ---------------------------------------------------------------------------
// Constants are correctly exported
// ---------------------------------------------------------------------------

test("PI_ASYNC_CONTEXT_MARKERS contains expected markers", () => {
  assert.ok(PI_ASYNC_CONTEXT_MARKERS.includes("PI_SUBAGENT_RUN_ID"));
  assert.ok(PI_ASYNC_CONTEXT_MARKERS.includes("PI_SESSION_ID"));
  assert.ok(PI_ASYNC_CONTEXT_MARKERS.includes("PI_ASYNC_CONTEXT"));
  assert.equal(PI_ASYNC_CONTEXT_MARKERS.length, 3);
});

test("ASYNC_START_STATUS has all expected values", () => {
  assert.equal(ASYNC_START_STATUS.VALID, "valid");
  assert.equal(ASYNC_START_STATUS.BYPASSED, "bypassed");
  assert.equal(ASYNC_START_STATUS.SNAPSHOT_MODE, "snapshot_mode");
  assert.equal(ASYNC_START_STATUS.REJECTED, "rejected");
});

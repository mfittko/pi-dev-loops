import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeHeadScopedCiStatuses,
  normalizeStatusCheckRollupStatus,
  normalizeStatusCheckRollupContract,
  normalizeHeadScopedCheckRunsStatus,
  normalizeHeadScopedCommitStatus,
  normalizeHeadScopedCiContract,
} from "../src/loop/copilot-ci-status.mjs";

test("normalizeStatusCheckRollupStatus returns failure over pending for mixed rollup entries", () => {
  const status = normalizeStatusCheckRollupStatus([
    { status: "IN_PROGRESS", conclusion: null },
    { status: "COMPLETED", conclusion: "FAILURE" },
  ]);

  assert.equal(status, "failure");
});

test("normalizeStatusCheckRollupStatus treats cancelled-only rollup entries as none", () => {
  const status = normalizeStatusCheckRollupStatus([
    { status: "COMPLETED", conclusion: "CANCELLED" },
  ]);

  assert.equal(status, "none");
});

test("normalizeStatusCheckRollupContract emits shared wait semantics for missing rollup", () => {
  const contract = normalizeStatusCheckRollupContract([]);

  assert.equal(contract.overallStatus, "none");
  assert.equal(contract.rollup.none, true);
  assert.equal(contract.semantics.wait, true);
  assert.equal(contract.semantics.blocked, false);
  assert.equal(contract.semantics.timeoutDisposition, "remain_waiting");
});

test("normalizeHeadScopedCheckRunsStatus returns failure over pending for mixed check runs", () => {
  const status = normalizeHeadScopedCheckRunsStatus({
    check_runs: [
      { status: "IN_PROGRESS", conclusion: null },
      { status: "COMPLETED", conclusion: "FAILURE" },
    ],
  });

  assert.equal(status, "failure");
});

test("normalizeHeadScopedCheckRunsStatus treats cancelled completed check runs as none", () => {
  const status = normalizeHeadScopedCheckRunsStatus({
    check_runs: [
      { status: "COMPLETED", conclusion: "CANCELLED" },
    ],
  });

  assert.equal(status, "none");
});

test("normalizeStatusCheckRollupStatus treats successful status-context rollup entries as success", () => {
  const status = normalizeStatusCheckRollupStatus([
    { state: "SUCCESS" },
  ]);

  assert.equal(status, "success");
});

test("normalizeHeadScopedCheckRunsStatus treats skipped completed check runs as success", () => {
  const status = normalizeHeadScopedCheckRunsStatus({
    check_runs: [
      { status: "COMPLETED", conclusion: "SKIPPED" },
    ],
  });

  assert.equal(status, "success");
});

test("normalizeHeadScopedCommitStatus returns failure when statuses include error", () => {
  const status = normalizeHeadScopedCommitStatus({
    statuses: [
      { state: "pending" },
      { state: "error" },
    ],
  });

  assert.equal(status, "failure");
});

test("mergeHeadScopedCiStatuses keeps failure-over-pending-over-success precedence", () => {
  assert.equal(mergeHeadScopedCiStatuses("pending", "success"), "pending");
  assert.equal(mergeHeadScopedCiStatuses("success", "failure"), "failure");
  assert.equal(mergeHeadScopedCiStatuses("none", "success"), "success");
});

test("normalizeHeadScopedCiContract emits wait semantics for pending and none", () => {
  const pending = normalizeHeadScopedCiContract({ checkRunsStatus: "pending", commitStatus: "none" });
  assert.equal(pending.overallStatus, "pending");
  assert.equal(pending.rollup.pending, true);
  assert.equal(pending.semantics.wait, true);
  assert.equal(pending.semantics.blocked, false);
  assert.equal(pending.semantics.timeoutDisposition, "remain_waiting");

  const none = normalizeHeadScopedCiContract({ checkRunsStatus: "none", commitStatus: "none" });
  assert.equal(none.overallStatus, "none");
  assert.equal(none.rollup.none, true);
  assert.equal(none.semantics.wait, true);
  assert.equal(none.semantics.blocked, false);
  assert.equal(none.semantics.timeoutDisposition, "remain_waiting");
});

test("normalizeHeadScopedCiContract emits blocked semantics for failure", () => {
  const blocked = normalizeHeadScopedCiContract({ checkRunsStatus: "failure", commitStatus: "pending" });

  assert.equal(blocked.overallStatus, "failure");
  assert.equal(blocked.rollup.failure, true);
  assert.equal(blocked.semantics.wait, false);
  assert.equal(blocked.semantics.blocked, true);
  assert.equal(blocked.semantics.timeoutDisposition, "not_applicable");
});

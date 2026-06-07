import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import { parseHandoffCliArgs } from "../../scripts/loop/copilot-pr-handoff.mjs";
import { claimRunnerOwnership } from "../../scripts/loop/_pr-runner-coordination.mjs";
import { EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY } from "../../packages/core/src/loop/timeout-policy.mjs";

const scriptPath = path.resolve("scripts/loop/copilot-pr-handoff.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, {
  ...options,
  env: {
    ...process.env,
    ...(options.env ?? {}),
    PI_SUBAGENT_RUN_ID: options.env?.PI_SUBAGENT_RUN_ID ?? "",
  },
});

/**
 * Write a gh stub that responds to a sequence of calls.
 * Each entry: { assertArgs?, stdout?, stderr?, exitCode? }
 */
async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries);
  return { ...env, PI_SUBAGENT_RUN_ID: "" };
}

const EMPTY_THREADS = JSON.stringify({
  data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
});

const OPEN_PR = JSON.stringify({
  isDraft: false,
  state: "OPEN",
  number: 17,
  reviews: [],
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
});

// ---------------------------------------------------------------------------
// Help and argument validation
// ---------------------------------------------------------------------------

test("copilot-pr-handoff --help prints usage and exits 0", async () => {
  const helpLong = await runNode(["--help"]);
  assert.equal(helpLong.code, 0);
  assert.equal(helpLong.stderr, "");
  assert(helpLong.stdout.includes("copilot-pr-handoff.mjs"), `expected script name in help, got: ${helpLong.stdout}`);
  assert(helpLong.stdout.includes("--repo"), "expected --repo in help");
  assert(helpLong.stdout.includes("--pr"), "expected --pr in help");
  assert(helpLong.stdout.includes("watch"), "expected watch action in help");

  const helpShort = await runNode(["-h"]);
  assert.equal(helpShort.code, 0);
  assert.equal(helpShort.stderr, "");
  assert.equal(helpShort.stdout, helpLong.stdout);
});

test("copilot-pr-handoff normalizes watch-status input", async () => {
  const parsed = parseHandoffCliArgs(["--repo", "owner/repo", "--pr", "17", "--watch-status", " Timeout "]);
  assert.equal(parsed.watchStatus, "timeout");
});

test("copilot-pr-handoff rejects malformed arguments with usage guidance", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.equal(missingPr.stdout, "");
  const missingPrErr = JSON.parse(missingPr.stderr);
  assert.equal(missingPrErr.ok, false);
  assert.equal(missingPrErr.error, "copilot-pr-handoff requires both --repo <owner/name> and --pr <number>");
  assert.equal(typeof missingPrErr.usage, "string");
  assert(missingPrErr.usage.length > 0);

  const noArgs = await runNode([]);
  assert.equal(noArgs.code, 1);
  assert.equal(noArgs.stdout, "");
  const noArgsErr = JSON.parse(noArgs.stderr);
  assert.equal(noArgsErr.ok, false);
  assert.equal(typeof noArgsErr.usage, "string");

  const unknown = await runNode(["--repo", "owner/repo", "--pr", "17", "--unexpected"]);
  assert.equal(unknown.code, 1);
  const unknownErr = JSON.parse(unknown.stderr);
  assert.equal(unknownErr.ok, false);
  assert.equal(unknownErr.error, "Unknown argument: --unexpected");
  assert.equal(typeof unknownErr.usage, "string");
  assert(unknownErr.usage.length > 0);

  const badWatchStatus = await runNode(["--repo", "owner/repo", "--pr", "17", "--watch-status", "later"]);
  assert.equal(badWatchStatus.code, 1);
  const badWatchStatusErr = JSON.parse(badWatchStatus.stderr);
  assert.equal(badWatchStatusErr.ok, false);
  assert.equal(badWatchStatusErr.error, "--watch-status must be one of: changed, timeout, idle");

  const conflictingWatchRefresh = await runNode([
    "--repo", "owner/repo", "--pr", "17", "--watch-status", "timeout", "--force-rerequest-review",
  ]);
  assert.equal(conflictingWatchRefresh.code, 1);
  const conflictingWatchRefreshErr = JSON.parse(conflictingWatchRefresh.stderr);
  assert.equal(conflictingWatchRefreshErr.ok, false);
  assert.equal(
    conflictingWatchRefreshErr.error,
    "--force-rerequest-review has been removed. Copilot re-requests are managed internally. Omit the flag.",
  );
});

// ---------------------------------------------------------------------------
// Handoff: pr_ready_no_feedback → request → watch
// ---------------------------------------------------------------------------

test("copilot-pr-handoff requests review and emits watch action for pr_ready_no_feedback", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-watch-"));

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: requested_reviewers (Copilot not requested yet)
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // detect: graphql threads
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      // request: check requested_reviewers before requesting
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // request: check reviews before requesting
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
      // request: add reviewer
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
      // request: verify requested_reviewers after
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      // request: verify reviews after
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "requested");
    assert.deepEqual(output.watchTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
    assert.ok(Array.isArray(output.allowedTransitions));
    assert.ok(typeof output.nextAction === "string");
    assert.ok(output.snapshot && typeof output.snapshot === "object");

    assert.ok(output.watchArgs, "expected watchArgs in watch action");
    assert.equal(output.watchArgs.repo, "owner/repo");
    assert.equal(output.watchArgs.pr, 17);
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 1_800_000);
    assert.equal(output.requestWatchContract.requestStatus, "requested");
    assert.equal(output.requestWatchContract.routingState, "copilot_request_confirmed_waiting");
    assert.equal(output.requestWatchContract.watchEntryConfirmed, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: already-requested → watch
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits watch action when Copilot is already requested", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-already-requested-"));

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: Copilot already in requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      // detect: graphql threads
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.deepEqual(output.watchTimeoutPolicy, EXTERNAL_HEALTHY_WAIT_TIMEOUT_POLICY);
    assert.ok(output.watchArgs, "expected watchArgs");
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 1_800_000);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff treats watch timeout with pending requested review as non-terminal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-timeout-pending-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--watch-status", "timeout"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.watchStatus, "timeout");
    assert.equal(output.loopDisposition, "pending");
    assert.equal(output.terminal, false);
    assert.equal(output.sameHeadCleanConverged, false);
    assert.ok(output.watchArgs, "expected watchArgs while review is still pending");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff does not request review when checks have not materialized on the first-request path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-no-checks-first-request-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [],
          statusCheckRollup: [],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "waiting_for_ci");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.watchArgs, undefined);
    assert.equal(output.snapshot.ciStatus, "none");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff does not request review when statusCheckRollup is missing on the first-request path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-missing-rollup-first-request-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "waiting_for_ci");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.watchArgs, undefined);
    assert.equal(output.snapshot.ciStatus, "none");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff reports draft reset as ready-state reentry requirement", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-draft-reentry-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          ...JSON.parse(OPEN_PR),
          isDraft: true,
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "pr_draft");
    assert.equal(output.watchArgs, undefined);
    assert.equal(output.requestWatchContract.routingState, "draft_reset_requires_ready_state_reentry");
    assert.equal(output.requestWatchContract.stopState, "draft_requires_ready_state_reentry");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: unavailable → stop
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits stop action when Copilot review is unavailable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-unavailable-"));

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view (pr_ready_no_feedback triggers request attempt)
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: not requested
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // detect: threads empty
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      // request: check before
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
      // request: gh returns unavailable error
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stderr: "gh: Reviews may only be requested from collaborators.\n",
        exitCode: 1,
      },
      // post-failure verification: Copilot still not in requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // post-failure verification: no pending Copilot review
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "review_request_unavailable");
    assert.equal(output.reviewRequestStatus, "unavailable");
    assert.equal(output.watchArgs, undefined);
    assert.equal(output.requestWatchContract.requestStatus, "unavailable");
    assert.equal(output.requestWatchContract.stopState, "unavailable");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: 422 + Copilot review in progress → watch
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits watch action when 422 but Copilot is in requested_reviewers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-422-in-progress-"));

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view (pr_ready_no_feedback triggers request attempt)
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: Copilot not yet in requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // detect: threads empty
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      // request: check before
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
      // request: gh returns 422
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stderr: "gh: Reviews may only be requested from collaborators.\n",
        exitCode: 1,
      },
      // post-failure verification: Copilot is now in requested_reviewers (GitHub queued it internally)
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"copilot-pull-request-reviewer[bot]"}],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "already-requested");
    assert.ok(output.watchArgs, "expected watchArgs in watch action");
    assert.equal(output.watchArgs.repo, "owner/repo");
    assert.equal(output.watchArgs.pr, 17);
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 1_800_000);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff emits watch action when 422 but Copilot has a pending review in progress", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-422-pending-"));

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view (pr_ready_no_feedback triggers request attempt)
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: Copilot not in requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // detect: threads empty
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      // request: check before
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"reviews":[]}\n',
      },
      // request: gh returns 422
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stderr: "gh: Reviews may only be requested from collaborators.\n",
        exitCode: 1,
      },
      // post-failure verification: Copilot not in requested_reviewers but has a PENDING review
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"abc123","reviews":[{"id":"r-1","state":"PENDING","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"abc123"}}]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "already-requested");
    assert.ok(output.watchArgs, "expected watchArgs in watch action");
    assert.equal(output.watchArgs.repo, "owner/repo");
    assert.equal(output.watchArgs.pr, 17);
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 1_800_000);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff treats stale pending Copilot review on an older commit plus no checks as waiting_for_ci", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-422-stale-pending-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-0",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "oldsha" },
            },
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "PENDING",
              commit: { oid: "oldsha" },
            },
          ],
          statusCheckRollup: [],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: `${EMPTY_THREADS}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "waiting_for_ci");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff still re-requests review when a stale pending Copilot review exists on an older commit and CI is green", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-stale-pending-success-rerequest-"));

  try {
    const ghPath = path.join(tempDir, "gh");
    const requestedStatePath = path.join(tempDir, "requested-state.txt");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const write = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value) + "\\n");
const requestedStatePath = process.env.GH_REREQUEST_STATE_PATH;

if (args[0] === "pr" && args[1] === "view" && !args.includes("--json")) {
  write({
    isDraft: false,
    state: "OPEN",
    number: 17,
    headRefOid: "newsha",
    reviews: [
      {
        id: "r-0",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        state: "COMMENTED",
        commit: { oid: "oldsha" }
      },
      {
        id: "r-1",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        state: "PENDING",
        commit: { oid: "oldsha" }
      }
    ],
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }]
  });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/17/requested_reviewers") {
  const requested = existsSync(requestedStatePath);
  write(requested ? { users: [{ login: "Copilot" }], teams: [] } : { users: [], teams: [] });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  write(${JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })});
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/commits/newsha/check-runs?per_page=100") {
  write({ check_runs: [{ status: "COMPLETED", conclusion: "SUCCESS" }] });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/commits/newsha/status?per_page=100") {
  write({ statuses: [] });
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "view" && args.includes("--json") && args.includes("headRefOid,isDraft,state,number,reviews,statusCheckRollup")) {
  write({
    headRefOid: "newsha",
    isDraft: false,
    state: "OPEN",
    number: 17,
    reviews: [
      {
        id: "r-0",
        state: "COMMENTED",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        commit: { oid: "oldsha" }
      },
      {
        id: "r-1",
        state: "PENDING",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        commit: { oid: "oldsha" }
      }
    ],
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }]
  });
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "edit" && args.includes("--add-reviewer") && args.includes("@copilot")) {
  writeFileSync(requestedStatePath, "requested\\n");
  write("https://github.com/owner/repo/pull/17\\n");
  process.exit(0);
}

if (args[0] === "api" && args[1] && args[1].includes("issues/") && args[1].includes("/comments")) {
  // No comments — human comment check returns no pause
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(97);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      GH_REREQUEST_STATE_PATH: requestedStatePath,
      GH_SEQUENCE_PATH: path.join(tempDir, "gh-sequence.json"),
    };

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "requested");
    assert.ok(output.watchArgs, "expected watchArgs after green re-request path");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff treats stale requested_reviewers as clean convergence after current-head review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-current-head-review-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "newsha" },
              submittedAt: "2026-01-15T10:30:00Z",
            },
          ],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        // Timeline: review_requested predates the submitted review (stale)
        assertArgs: ["api", "repos/owner/repo/issues/17/timeline", "--paginate", "--jq"],
        stdout: '{"login":"Copilot","created_at":"2026-01-15T10:00:00Z"}\n',
      },

      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "ready_to_rerequest_review");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.snapshot.copilotReviewOnCurrentHead, true);
    assert.equal(output.sameHeadCleanConverged, true);
    assert.equal(output.loopDisposition, "clean_converged");
    assert.equal(output.terminal, true);
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff classifies watch timeout plus stale requested_reviewers as clean-converged", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-timeout-clean-converged-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "newsha" },
              submittedAt: "2026-01-15T10:30:00Z",
            },
          ],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        // Timeline: review_requested predates the submitted review (stale)
        assertArgs: ["api", "repos/owner/repo/issues/17/timeline", "--paginate", "--jq"],
        stdout: '{"login":"Copilot","created_at":"2026-01-15T10:00:00Z"}\n',
      },

      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--watch-status", "timeout"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "ready_to_rerequest_review");
    assert.equal(output.watchStatus, "timeout");
    assert.equal(output.sameHeadCleanConverged, true);
    assert.equal(output.loopDisposition, "clean_converged");
    assert.equal(output.terminal, true);
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff preserves copilotReviewPresent=false for an initial request with no prior review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-initial-request-preserves-review-presence-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"newsha","reviews":[]}\n',
      },
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"newsha","reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "requested");
    assert.equal(output.snapshot.copilotReviewRequestStatus, "requested");
    assert.equal(output.snapshot.copilotReviewOnCurrentHead, false);
    assert.equal(output.snapshot.copilotReviewPresent, false);
    assert.ok(output.watchArgs, "expected watchArgs after initial request");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff auto re-requests when a newer head has no submitted Copilot review yet", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-reenabled-after-head-change-"));

  try {
    const ghPath = path.join(tempDir, "gh");
    const requestedStatePath = path.join(tempDir, "requested-state.txt");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const write = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value) + "\\n");
const requestedStatePath = process.env.GH_REREQUEST_STATE_PATH;

if (args[0] === "pr" && args[1] === "view" && !args.includes("--json")) {
  write({
    isDraft: false,
    state: "OPEN",
    number: 17,
    headRefOid: "newsha",
    reviews: [
      {
        id: "r-1",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        state: "COMMENTED",
        commit: { oid: "oldsha" }
      }
    ],
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }]
  });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/17/requested_reviewers") {
  const requested = existsSync(requestedStatePath);
  write(requested ? { users: [{ login: "Copilot" }], teams: [] } : { users: [], teams: [] });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  write(${JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })});
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/commits/newsha/check-runs?per_page=100") {
  write({ check_runs: [{ status: "COMPLETED", conclusion: "SUCCESS" }] });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/commits/newsha/status?per_page=100") {
  write({ statuses: [] });
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "view" && args.includes("--json") && args.includes("headRefOid,isDraft,state,number,reviews,statusCheckRollup")) {
  write({
    headRefOid: "newsha",
    isDraft: false,
    state: "OPEN",
    number: 17,
    reviews: [
      {
        id: "r-1",
        state: "COMMENTED",
        author: { login: "copilot-pull-request-reviewer[bot]" },
        commit: { oid: "oldsha" }
      }
    ],
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }]
  });
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "edit" && args.includes("--add-reviewer") && args.includes("@copilot")) {
  writeFileSync(requestedStatePath, "requested\\n");
  write("https://github.com/owner/repo/pull/17\\n");
  process.exit(0);
}

if (args[0] === "api" && args[1] && args[1].includes("issues/") && args[1].includes("/comments")) {
  // No comments — human comment check returns no pause
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(97);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      GH_REREQUEST_STATE_PATH: requestedStatePath,
      GH_SEQUENCE_PATH: path.join(tempDir, "gh-sequence.json"),
    };

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "requested");
    assert.ok(output.watchArgs, "expected watchArgs in watch action");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff rejects --force-rerequest-review as a removed policy flag (standalone)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-force-rerequest-rejected-"));
  try {
    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--force-rerequest-review"]);
    assert.equal(result.code, 1);
    const error = JSON.parse(result.stderr);
    assert.match(error.error, /--force-rerequest-review has been removed/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff does not re-request review when checks have not materialized on the re-request path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-no-checks-rerequest-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "oldsha" },
            },
          ],
          statusCheckRollup: [],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "waiting_for_ci");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.watchArgs, undefined);
    assert.equal(output.snapshot.ciStatus, "none");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff keeps same-head suppression (no force flag)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-no-force-rerequest-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "newsha" },
            },
          ],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "ready_to_rerequest_review");
    assert.equal(output.reviewRequestStatus, undefined);
    assert.equal(output.requestWatchContract.requestStatus, "none");
    assert.equal(output.requestWatchContract.routingState, "non_ready_state");
    assert.equal(output.requestWatchContract.stopState, "no_automatic_next_step");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: unresolved feedback → fix
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits fix action when unresolved threads exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-fix-"));

  const unresolvedThreads = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "t-1",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      id: "c-1",
                      body: "Please add a test.",
                      author: { login: "reviewer", __typename: "User" },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });

  try {
    const env = await writeGhStub(tempDir, [
      // detect: pr view
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [{ id: "r-1", author: { login: "copilot-pull-request-reviewer[bot]" } }],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      // detect: not in requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      // detect: threads with unresolved feedback
      {
        assertArgs: ["api", "graphql"],
        stdout: unresolvedThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "fix");
    assert.equal(output.state, "unresolved_feedback_present");
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff classifies watch timeout with refreshed unresolved thread as unresolved feedback", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-timeout-unresolved-"));

  const unresolvedThreads = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "t-1",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      id: "c-1",
                      body: "Please add a test.",
                      author: { login: "copilot-pull-request-reviewer[bot]", __typename: "Bot" },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "newsha" },
              submittedAt: "2026-01-15T10:30:00Z",
            },
          ],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        // Timeline: review_requested predates the submitted review (stale)
        assertArgs: ["api", "repos/owner/repo/issues/17/timeline", "--paginate", "--jq"],
        stdout: '{"login":"Copilot","created_at":"2026-01-15T10:00:00Z"}\n',
      },

      {
        assertArgs: ["api", "graphql"],
        stdout: unresolvedThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--watch-status", "timeout"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "fix");
    assert.equal(output.state, "unresolved_feedback_present");
    assert.equal(output.watchStatus, "timeout");
    assert.equal(output.loopDisposition, "unresolved_feedback");
    assert.equal(output.terminal, false);
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: no PR → stop
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits stop action when no PR exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-no-pr-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stderr: "no pull requests found for branch\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "no_pr");
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handoff: merged PR → stop
// ---------------------------------------------------------------------------

test("copilot-pr-handoff emits stop action for merged PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-merged-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "MERGED",
          number: 17,
          reviews: [],
          statusCheckRollup: [],
        }) + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "done");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff classifies watch timeout with CI still pending as non-terminal pending", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-timeout-ci-pending-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "newsha",
          reviews: [
            {
              id: "r-1",
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "COMMENTED",
              commit: { oid: "newsha" },
              submittedAt: "2026-01-15T10:30:00Z",
            },
          ],
          statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "", name: "ci" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        // Timeline: review_requested predates the submitted review (stale)
        assertArgs: ["api", "repos/owner/repo/issues/17/timeline", "--paginate", "--jq"],
        stdout: '{"login":"Copilot","created_at":"2026-01-15T10:00:00Z"}\n',
      },

      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--watch-status", "timeout"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "waiting_for_ci");
    assert.equal(output.watchStatus, "timeout");
    assert.equal(output.loopDisposition, "pending");
    assert.equal(output.terminal, false);
    assert.equal(output.sameHeadCleanConverged, false);
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("copilot-pr-handoff stops cleanly when another run already owns the PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-ownership-"));

  try {
    await claimRunnerOwnership({ repo: "owner/repo", pr: 17, runId: "run-active", cwd: tempDir });

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], {
      cwd: tempDir,
      env: { ...process.env, PI_SUBAGENT_RUN_ID: "run-new" },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "blocked_needs_user_decision");
    assert.equal(output.loopDisposition, "blocked");
    assert.equal(output.terminal, true);
    assert.equal(output.runnerOwnership.ok, false);
    assert.equal(output.runnerOwnership.error, "ownership_lost");
    assert.equal(output.runnerOwnership.activeRun.runId, "run-active");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Human comment detection (detectRecentHumanComments) unit tests
// ---------------------------------------------------------------------------

test("detectRecentHumanComments detects human comment after last bot comment", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-detect-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT_COMMENT = JSON.stringify({
      id: 100,
      body: "**draft_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });
    const HUMAN_COMMENT = JSON.stringify({
      id: 101,
      body: "Let's reconsider the approach here.",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT_COMMENT + "\n" + HUMAN_COMMENT + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, true);
    assert.ok(result.humanComments, "expected humanComments array");
    assert.equal(result.humanComments.length, 1);
    assert.equal(result.humanComments[0].author, "human-dev");
    assert.equal(result.humanComments[0].id, 101);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments does not pause when human comment is before bot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-before-bot-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT_COMMENT = JSON.stringify({
      id: 100,
      body: "**pre_approval_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T10:00:00Z",
    });
    const HUMAN_COMMENT = JSON.stringify({
      id: 101,
      body: "Looks good.",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T09:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT_COMMENT + "\n" + HUMAN_COMMENT + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments skips gate-pattern human comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-gate-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT_COMMENT = JSON.stringify({
      id: 100,
      body: "**draft_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });
    const HUMAN_GATE = JSON.stringify({
      id: 101,
      body: "**pre_approval_gate** manual check done",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT_COMMENT + "\n" + HUMAN_GATE + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments skips Gate review: format gate comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-gate-format-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT_COMMENT = JSON.stringify({
      id: 100,
      body: "Gate review: draft_gate\n\nReviewed head SHA: abc1234\nVerdict: clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });
    const HUMAN_GATE = JSON.stringify({
      id: 101,
      body: "Gate review: pre_approval_gate\n\nReviewed head SHA: abc1234\nVerdict: clean",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", "."],
        stdout: BOT_COMMENT + "\n" + HUMAN_GATE + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments returns false when only bots commented", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-bots-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT1 = JSON.stringify({
      id: 100,
      body: "**draft_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });
    const BOT2 = JSON.stringify({
      id: 101,
      body: "**pre_approval_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T10:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT1 + "\n" + BOT2 + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments returns false when no bot baseline exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-no-baseline-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const HUMAN_COMMENT = JSON.stringify({
      id: 101,
      body: "Just a regular comment.",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: HUMAN_COMMENT + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRecentHumanComments detects multiple human comments after last bot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-multi-"));

  try {
    const { detectRecentHumanComments } = await import("../../scripts/loop/copilot-pr-handoff.mjs");

    const BOT = JSON.stringify({
      id: 100,
      body: "bot action",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });
    const HUMAN1 = JSON.stringify({
      id: 101,
      body: "First human note.",
      user: { login: "dev-1", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });
    const HUMAN2 = JSON.stringify({
      id: 102,
      body: "Second human note.",
      user: { login: "dev-2", type: "User" },
      created_at: "2026-06-07T11:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT + "\n" + HUMAN1 + "\n" + HUMAN2 + "\n",
      },
    ]);

    const result = await detectRecentHumanComments(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(result.paused, true);
    assert.equal(result.humanComments.length, 2);
    assert.equal(result.humanComments[0].author, "dev-1");
    assert.equal(result.humanComments[1].author, "dev-2");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff skips human comment check when PI_SUBAGENT_RUN_ID not set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-skip-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
    ]);

    // PI_SUBAGENT_RUN_ID is "" (empty/falsy) from writeGhStub defaults
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    // No humanCommentPause field since check was skipped
    assert.equal(output.humanCommentPause, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});



test("copilot-pr-handoff runs human comment check when PI_SUBAGENT_RUN_ID is set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-human-active-"));

  try {
    const HUMAN_COMMENT = JSON.stringify({
      id: 200,
      body: "Please stop and reconsider the approach.",
      user: { login: "human-dev", type: "User" },
      created_at: "2026-06-07T10:00:00Z",
    });
    const BOT_COMMENT = JSON.stringify({
      id: 199,
      body: "**draft_gate** verdict=clean",
      user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
      created_at: "2026-06-07T09:00:00Z",
    });

    const { env } = await writeGhStubHelper(tempDir, [
      // detect: pr view
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: OPEN_PR + "\n",
      },
      // detect: requested_reviewers
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      // detect: graphql threads
      {
        assertArgs: ["api", "graphql"],
        stdout: EMPTY_THREADS + "\n",
      },
      // human comment check
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "--paginate", "--jq", ".[]"],
        stdout: BOT_COMMENT + "\n" + HUMAN_COMMENT + "\n",
      },
    ]);

    const runEnv = { ...env, PI_SUBAGENT_RUN_ID: "run-test-human-pause" };
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { cwd: tempDir, env: runEnv });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.action, "stop");
    assert.equal(output.state, "blocked_needs_user_decision");
    assert.equal(output.loopDisposition, "blocked");
    assert.equal(output.terminal, true);
    assert.ok(output.humanCommentPause, "expected humanCommentPause field");
    assert.equal(output.humanCommentPause.reason, "human_comment_detected");
    assert.equal(output.humanCommentPause.humanComments.length, 1);
    assert.equal(output.humanCommentPause.humanComments[0].author, "human-dev");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

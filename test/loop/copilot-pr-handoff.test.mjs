import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { parseHandoffCliArgs } from "../../scripts/loop/copilot-pr-handoff.mjs";

const scriptPath = path.resolve("scripts/loop/copilot-pr-handoff.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Write a gh stub that responds to a sequence of calls.
 * Each entry: { assertArgs?, stdout?, stderr?, exitCode? }
 */
async function writeGhStub(tempDir, entries) {
  const sequencePath = path.join(tempDir, "gh-sequence.json");
  const counterPath = path.join(tempDir, "gh-counter.txt");
  const ghPath = path.join(tempDir, "gh");

  await writeFile(sequencePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await writeFile(counterPath, "0\n", "utf8");
  await writeFile(
    ghPath,
    [
      "#!/usr/bin/env node",
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const sequencePath = process.env.GH_SEQUENCE_PATH;",
      "const counterPath = process.env.GH_COUNTER_PATH;",
      'const entries = JSON.parse(readFileSync(sequencePath, "utf8"));',
      'const current = Number(readFileSync(counterPath, "utf8").trim() || "0");',
      'if (current >= entries.length) {',
      '  process.stderr.write("unexpected gh call beyond scripted sequence\\n");',
      '  process.exit(97);',
      '}',
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
      '      process.stderr.write(`missing expected gh arg: ${expected}\\n`);',
      '      process.exit(98);',
      '    }',
      '  }',
      '}',
      'if (entry.stderr) {',
      '  process.stderr.write(entry.stderr);',
      '}',
      'if (entry.stdout) {',
      '  process.stdout.write(entry.stdout);',
      '}',
      'process.exit(entry.exitCode ?? 0);',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(ghPath, 0o755);

  return {
    ...process.env,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    GH_SEQUENCE_PATH: sequencePath,
    GH_COUNTER_PATH: counterPath,
  };
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
    "--force-rerequest-review cannot be combined with --watch-status because watch refresh mode never requests review",
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
    assert.ok(Array.isArray(output.allowedTransitions));
    assert.ok(typeof output.nextAction === "string");
    assert.ok(output.snapshot && typeof output.snapshot === "object");

    assert.ok(output.watchArgs, "expected watchArgs in watch action");
    assert.equal(output.watchArgs.repo, "owner/repo");
    assert.equal(output.watchArgs.pr, 17);
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 86_400_000);
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
    assert.ok(output.watchArgs, "expected watchArgs");
    assert.equal(output.watchArgs.pollIntervalMs, 60_000);
    assert.equal(output.watchArgs.timeoutMs, 86_400_000);
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
    assert.equal(output.watchArgs.timeoutMs, 86_400_000);
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
    assert.equal(output.watchArgs.timeoutMs, 86_400_000);
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
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
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
      {
        assertArgs: ["api", "repos/owner/repo/commits/newsha/check-runs"],
        stdout: '{"check_runs":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/commits/newsha/status"],
        stdout: '{"statuses":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-0","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}},{"id":"r-1","state":"PENDING","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}}]}\n',
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
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-0","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}},{"id":"r-1","state":"PENDING","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}}]}\n',
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
    assert.ok(output.watchArgs, "expected watchArgs after green re-request path");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff stops after a current-head Copilot review even if requested_reviewers lingers", async () => {
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
    assert.equal(output.watchArgs, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff classifies watch timeout plus current-head clean review as clean-converged", async () => {
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
        assertArgs: ["api", "repos/owner/repo/commits/newsha/check-runs"],
        stdout: '{"check_runs":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/commits/newsha/status"],
        stdout: '{"statuses":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-1","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}}]}\n',
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
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-1","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"oldsha"}}]}\n',
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
    assert.ok(output.watchArgs, "expected watchArgs in watch action");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copilot-pr-handoff allows explicit operator same-head re-request via --force-rerequest-review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-handoff-force-rerequest-"));

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
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid,isDraft,state,number,reviews,statusCheckRollup"],
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-1","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"newsha"}}]}\n',
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
        stdout: '{"headRefOid":"newsha","reviews":[{"id":"r-1","state":"COMMENTED","author":{"login":"copilot-pull-request-reviewer[bot]"},"commit":{"oid":"newsha"}}]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--force-rerequest-review"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "watch");
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.reviewRequestStatus, "requested");
    assert.equal(output.snapshot.copilotReviewRequestStatus, "requested");
    assert.equal(output.snapshot.copilotReviewOnCurrentHead, false);
    assert.ok(output.watchArgs, "expected watchArgs after explicit force re-request");
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

test("copilot-pr-handoff keeps same-head suppression without --force-rerequest-review", async () => {
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

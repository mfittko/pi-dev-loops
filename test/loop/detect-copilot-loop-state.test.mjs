import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { autoDetectSnapshot, parseDetectCliArgs } from "../../scripts/loop/detect-copilot-loop-state.mjs";

const scriptPath = path.resolve("scripts/loop/detect-copilot-loop-state.mjs");
const fixturePath = path.resolve("packages/core/test/fixtures/github/review-threads/mixed-threads.json");

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

async function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    env: {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      GH_SEQUENCE_PATH: sequencePath,
      GH_COUNTER_PATH: counterPath,
    },
  };
}

// ---------------------------------------------------------------------------
// --input mode
// ---------------------------------------------------------------------------

test("detect-copilot-loop-state --input interprets a snapshot file and emits state JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-input-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "pr_ready_no_feedback");
    assert.ok(Array.isArray(output.allowedTransitions));
    assert.ok(typeof output.nextAction === "string" && output.nextAction.length > 0);
    assert.ok(output.snapshot && typeof output.snapshot === "object");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --input routes unresolved threads to unresolved_feedback_present", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-unresolved-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 2,
      actionableThreadCount: 1,
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "unresolved_feedback_present");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --input routes unavailable status to review_request_unavailable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-unavailable-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: "unavailable",
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "review_request_unavailable");
    assert.deepEqual(output.allowedTransitions, []);
    assert.match(output.nextAction, /stop/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --input routes already-fixed threads to already_fixed_needs_reply_resolve", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-fixed-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 1,
      actionableThreadCount: 1,
      agentFixStatus: "applied",
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "already_fixed_needs_reply_resolve");
    assert.deepEqual(output.allowedTransitions, ["ready_to_rerequest_review"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --input routes failed review request to blocked_needs_user_decision", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-failed-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: "failed",
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "blocked_needs_user_decision");
    assert.deepEqual(output.allowedTransitions, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --input returns done for merged PR snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-done-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prMerged: true,
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "done");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Auto-detect mode via gh stubs
// ---------------------------------------------------------------------------

test("detect-copilot-loop-state auto-detect returns pr_ready_no_feedback for open PR with no review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-ready-"));

  try {
    // Fixture has unresolved threads, but we use a clean threads response here
    const emptyThreads = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [] },
          },
        },
      },
    });

    const { env } = await writeGhStub(tempDir, [
      {
        // gh pr view
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
        // gh api requested_reviewers
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        // gh api graphql (review threads)
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "pr_ready_no_feedback");
    assert.equal(output.snapshot.prExists, true);
    assert.equal(output.snapshot.prNumber, 17);
    assert.equal(output.snapshot.copilotReviewRequestStatus, "none");
    assert.equal(output.snapshot.copilotReviewPresent, false);
    assert.equal(output.snapshot.unresolvedThreadCount, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect returns unresolved_feedback_present when threads exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-unresolved-"));
  const fixtureText = await readFile(fixturePath, "utf8");

  try {
    const { env } = await writeGhStub(tempDir, [
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
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: fixtureText,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    // mixed-threads fixture has 2 unresolved threads (1 actionable from human reviewer)
    assert.equal(output.state, "unresolved_feedback_present");
    assert.equal(output.snapshot.unresolvedThreadCount, 2);
    assert.equal(output.snapshot.actionableThreadCount, 1);
    assert.equal(output.snapshot.copilotReviewPresent, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("autoDetectSnapshot uses the default ghCommand when deps omit it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-auto-detect-default-deps-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
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
        stdout: `${emptyThreads}\n`,
      },
    ]);

    const snapshot = await autoDetectSnapshot(
      { repo: "owner/repo", pr: 17 },
      { env },
    );

    assert.equal(snapshot.prExists, true);
    assert.equal(snapshot.prNumber, 17);
    assert.equal(snapshot.copilotReviewRequestStatus, "none");
    assert.equal(snapshot.unresolvedThreadCount, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect returns waiting_for_copilot_review when Copilot is requested", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-waiting-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
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
        stdout: '{"users":[{"login":"copilot-pull-request-reviewer[bot]"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.snapshot.copilotReviewRequestStatus, "requested");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("detect-copilot-loop-state auto-detect treats a pending Copilot review as in-progress evidence", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-pending-copilot-review-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [
            {
              author: { login: "copilot-pull-request-reviewer[bot]" },
              state: "PENDING",
            },
          ],
          statusCheckRollup: [],
        }) + "\n",
      },
      // No requested_reviewers call here: a PENDING Copilot review is already sufficient
      // in-progress evidence, so auto-detect should skip that extra API round-trip.
      {
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.snapshot.copilotReviewPresent, true);
    assert.equal(output.snapshot.copilotReviewRequestStatus, "requested");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect returns done for merged PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-merged-"));

  try {
    const { env } = await writeGhStub(tempDir, [
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

    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "done");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect returns no_pr when gh reports PR not found", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-auto-no-pr-"));

  try {
    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "99", "--repo", "owner/repo"],
        stderr: "no pull requests found for branch\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "99"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "no_pr");
    assert.equal(output.snapshot.prExists, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state --review-request-status override injects status without re-probing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-override-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
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
      // Note: NO requested_reviewers call — override skips it
      {
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--pr", "17", "--review-request-status", "unavailable"],
      { env },
    );

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "review_request_unavailable");
    assert.equal(output.snapshot.copilotReviewRequestStatus, "unavailable");
    assert.deepEqual(output.allowedTransitions, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect detects CI pending status", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-ci-pending-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [],
          statusCheckRollup: [
            { status: "IN_PROGRESS", conclusion: null, name: "build" },
            { status: "COMPLETED", conclusion: "SUCCESS", name: "lint" },
          ],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.snapshot.ciStatus, "pending");
    assert.equal(output.state, "waiting_for_ci");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect prioritizes CI failure over pending checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-ci-failure-priority-"));

  try {
    const emptyThreads = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    });

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [],
          statusCheckRollup: [
            { status: "COMPLETED", conclusion: "FAILURE", name: "test" },
            { status: "IN_PROGRESS", conclusion: null, name: "build" },
          ],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: emptyThreads + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.equal(output.snapshot.ciStatus, "failure");
    assert.equal(output.state, "blocked_needs_user_decision");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state auto-detect fails when gh stub call budget is exceeded", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gh-budget-"));

  try {
    const { env } = await writeGhStub(tempDir, [
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
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "gh command failed: unexpected gh call beyond scripted sequence",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test("detect-copilot-loop-state rejects malformed arguments deterministically", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.equal(missingPr.stdout, "");
  const missingPrErr = JSON.parse(missingPr.stderr);
  assert.equal(missingPrErr.ok, false);
  assert.equal(missingPrErr.error, "Auto-detect mode requires both --repo <owner/name> and --pr <number>");
  assert.equal(typeof missingPrErr.usage, "string");
  assert(missingPrErr.usage.length > 0);

  const zeroPr = await runNode(["--repo", "owner/repo", "--pr", "0"]);
  assert.equal(zeroPr.code, 1);
  const zeroPrErr = JSON.parse(zeroPr.stderr);
  assert.equal(zeroPrErr.ok, false);
  assert.equal(zeroPrErr.error, "--pr must be a positive integer");
  assert.equal(typeof zeroPrErr.usage, "string");
  assert(zeroPrErr.usage.length > 0);

  const noArgs = await runNode([]);
  assert.equal(noArgs.code, 1);
  const noArgsErr = JSON.parse(noArgs.stderr);
  assert.equal(noArgsErr.ok, false);
  assert.equal(noArgsErr.error, "Provide either --input <path> or --repo <owner/name> --pr <number>");
  assert.equal(typeof noArgsErr.usage, "string");
  assert(noArgsErr.usage.length > 0);

  const mixedSources = await runNode(["--input", "/tmp/snap.json", "--repo", "owner/repo", "--pr", "17"]);
  assert.equal(mixedSources.code, 1);
  const mixedErr = JSON.parse(mixedSources.stderr);
  assert.equal(mixedErr.ok, false);
  assert.equal(mixedErr.error, "Choose exactly one input source: --input <path> or --repo/--pr auto-detect");
  assert.equal(typeof mixedErr.usage, "string");
  assert(mixedErr.usage.length > 0);

  const unknown = await runNode(["--repo", "owner/repo", "--pr", "17", "--wat"]);
  assert.equal(unknown.code, 1);
  const unknownErr = JSON.parse(unknown.stderr);
  assert.equal(unknownErr.ok, false);
  assert.equal(unknownErr.error, "Unknown argument: --wat");
  assert.equal(typeof unknownErr.usage, "string");
  assert(unknownErr.usage.length > 0);

  const badOverride = await runNode(["--repo", "owner/repo", "--pr", "17", "--review-request-status", "bogus"]);
  assert.equal(badOverride.code, 1);
  assert.match(JSON.parse(badOverride.stderr).error, /--review-request-status/);

  const overrideWithInput = await runNode(["--input", "/tmp/snap.json", "--review-request-status", "none"]);
  assert.equal(overrideWithInput.code, 1);
  assert.match(JSON.parse(overrideWithInput.stderr).error, /--review-request-status/);
});

test("detect-copilot-loop-state --help prints usage and exits 0", async () => {
  const helpLong = await runNode(["--help"]);
  assert.equal(helpLong.code, 0);
  assert.equal(helpLong.stderr, "");
  assert(helpLong.stdout.includes("detect-copilot-loop-state.mjs"), `expected script name in help, got: ${helpLong.stdout}`);
  assert(helpLong.stdout.includes("--repo"), `expected --repo in help`);
  assert(helpLong.stdout.includes("--pr"), `expected --pr in help`);
  assert(helpLong.stdout.includes("--input"), `expected --input in help`);

  const helpShort = await runNode(["-h"]);
  assert.equal(helpShort.code, 0);
  assert.equal(helpShort.stderr, "");
  assert.equal(helpShort.stdout, helpLong.stdout);
});

test("detect-copilot-loop-state reports gh failures deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gh-failure-"));

  try {
    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stderr: "gh: authentication required\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "gh command failed: gh: authentication required",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state fails closed when review threads cannot be fetched", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-thread-failure-"));

  try {
    const { env } = await writeGhStub(tempDir, [
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
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stderr: "GraphQL error: reviewThreads unavailable\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "Could not determine review-thread state: gh command failed: GraphQL error: reviewThreads unavailable",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Steering integration — real loop surface changes behavior after steering
// ---------------------------------------------------------------------------

test("parseDetectCliArgs accepts --steering-state-file flag", () => {
  const opts = parseDetectCliArgs(["--input", "/tmp/snap.json", "--steering-state-file", "/tmp/st.json"]);
  assert.equal(opts.steeringStateFile, "/tmp/st.json");
  assert.equal(opts.inputPath, "/tmp/snap.json");
});

test("parseDetectCliArgs leaves steeringStateFile undefined when flag is absent", () => {
  const opts = parseDetectCliArgs(["--input", "/tmp/snap.json"]);
  assert.equal(opts.steeringStateFile, undefined);
});

test("detect-copilot-loop-state without --steering-state-file omits steeringApplied from output (backward-compatible)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-compat-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    const result = await runNode(["--input", snapshotPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(output, "steeringApplied"),
      "steeringApplied must not appear when no steering file is provided");
    assert.ok(!Object.prototype.hasOwnProperty.call(output, "effectiveConstraints"),
      "effectiveConstraints must not appear when no steering file is provided");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state with empty steering file adds steering fields but keeps original nextAction", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-empty-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    // Steering file exists but has no effective events (fresh state)
    await writeJson(steeringPath, {
      runId: "run-17",
      schemaVersion: 1,
      events: [],
      effectiveStack: [],
      queuedEvents: [],
      resultHistory: [],
      latestResult: null,
      nextSeq: 1,
    });

    const result = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "ready_to_rerequest_review");
    assert.equal(output.steeringApplied, false, "steeringApplied must be false when no effective steering");
    assert.ok(output.effectiveConstraints, "effectiveConstraints must be present");
    assert.deepEqual(output.effectiveConstraints.hardConstraints, []);
    assert.equal(output.effectiveConstraints.stopAtNextSafeGate, false);
    // nextAction unchanged from base interpretation
    assert.ok(!/Stop at this safe gate/.test(output.nextAction));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state: stop_at_next_safe_gate steering overrides nextAction on the real loop surface", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-stop-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    // Loop is at ready_to_rerequest_review (an IMMEDIATE safe point)
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    // Steering state with a stop_at_next_safe_gate directive in effect
    await writeJson(steeringPath, {
      runId: "run-17",
      schemaVersion: 1,
      events: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop before next review cycle",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      effectiveStack: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop before next review cycle",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      queuedEvents: [],
      resultHistory: [{
        eventId: "evt-001",
        seq: 1,
        result: "applied_now",
        reason: null,
        acknowledgedAt: "2026-05-16T09:00:00.000Z",
      }],
      latestResult: {
        eventId: "evt-001",
        seq: 1,
        result: "applied_now",
        reason: null,
        acknowledgedAt: "2026-05-16T09:00:00.000Z",
      },
      nextSeq: 2,
    });

    const result = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    // Loop state is still ready_to_rerequest_review — steering doesn't change the state
    assert.equal(output.state, "ready_to_rerequest_review");
    // But nextAction IS overridden by the stop_at_next_safe_gate directive
    assert.equal(output.steeringApplied, true);
    assert.match(output.nextAction, /Stop at this safe gate/);
    assert.match(output.nextAction, /stop_at_next_safe_gate/);
    assert.equal(output.effectiveConstraints.stopAtNextSafeGate, true);
    assert.deepEqual(output.effectiveConstraints.hardConstraints, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state: hard_constraint steering is visible in effectiveConstraints on the real loop surface", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-hard-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 42,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
    });

    await writeJson(steeringPath, {
      runId: "run-42",
      schemaVersion: 1,
      events: [{
        eventId: "evt-001",
        runId: "run-42",
        kind: "hard_constraint",
        directive: "Do not add new npm dependencies",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      effectiveStack: [{
        eventId: "evt-001",
        runId: "run-42",
        kind: "hard_constraint",
        directive: "Do not add new npm dependencies",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      queuedEvents: [],
      resultHistory: [],
      latestResult: null,
      nextSeq: 2,
    });

    const result = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "waiting_for_copilot_review");
    assert.equal(output.steeringApplied, true);
    assert.deepEqual(output.effectiveConstraints.hardConstraints, ["Do not add new npm dependencies"]);
    assert.equal(output.effectiveConstraints.stopAtNextSafeGate, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state: stop_at_next_safe_gate is visible as pending when loop is not at a safe point", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-nogate-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    // Loop is in unresolved_feedback_present (a NEXT_POINT state, not a safe point)
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 2,
      actionableThreadCount: 2,
    });

    await writeJson(steeringPath, {
      runId: "run-17",
      schemaVersion: 1,
      events: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop at next gate",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      effectiveStack: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop at next gate",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      queuedEvents: [],
      resultHistory: [],
      latestResult: null,
      nextSeq: 2,
    });

    const result = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "unresolved_feedback_present");
    assert.equal(output.steeringApplied, true);
    assert.equal(output.pendingStopAtNextSafeGate, true);
    assert.match(output.nextAction, /Pending stop_at_next_safe_gate/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state: missing --steering-state-file path returns steering-free output (ENOENT tolerant)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-missing-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    // Point to a non-existent steering file; should not error
    const result = await runNode([
      "--input", snapshotPath,
      "--steering-state-file", path.join(tempDir, "nonexistent-steering.json"),
    ]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "ready_to_rerequest_review");
    // With a missing file, treated as empty steering
    assert.equal(output.steeringApplied, false);
    assert.equal(output.effectiveConstraints.stopAtNextSafeGate, false);
    assert.equal(output.terminalStopAtNextSafeGate, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("detect-copilot-loop-state: terminal stop_at_next_safe_gate is surfaced when the loop is blocked", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-terminal-stop-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      copilotReviewRequestStatus: "failed",
    });

    await writeJson(steeringPath, {
      runId: "run-17",
      schemaVersion: 1,
      events: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop at next gate",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      effectiveStack: [{
        eventId: "evt-001",
        runId: "run-17",
        kind: "stop_at_next_safe_gate",
        directive: "Stop at next gate",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-16T09:00:00.000Z",
      }],
      queuedEvents: [],
      resultHistory: [],
      latestResult: null,
      nextSeq: 2,
    });

    const result = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.state, "blocked_needs_user_decision");
    assert.equal(output.pendingStopAtNextSafeGate, false);
    assert.equal(output.terminalStopAtNextSafeGate, true);
    assert.match(output.nextAction, /inactive because the loop is in terminal state/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-loop-state: durable reload — steering applied after steer-loop submit is reflected on real loop surface", async () => {
  const steerScriptPath = path.resolve("scripts/loop/steer-loop.mjs");

  function runSteerNode(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [steerScriptPath, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => { resolve({ code, stdout, stderr }); });
    });
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-detect-steer-reload-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    const steeringPath = path.join(tempDir, "steering.json");

    // Snapshot: loop is at ready_to_rerequest_review
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 77,
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    // Step 1: submit stop_at_next_safe_gate via steer-loop CLI
    const submitResult = await runSteerNode([
      "submit",
      "--run-id", "run-77",
      "--kind", "stop_at_next_safe_gate",
      "--directive", "Stop before next review pass",
      "--seq", "1",
      "--loop-state", "waiting_for_copilot_review",
      "--state-file", steeringPath,
    ]);
    assert.equal(submitResult.code, 0, `steer-loop submit failed: ${submitResult.stderr || submitResult.stdout}`);
    const submitOut = JSON.parse(submitResult.stdout);
    assert.equal(submitOut.result.result, "applied_now");

    // Step 2: detect loop state with the durable steering file
    const detectResult = await runNode(["--input", snapshotPath, "--steering-state-file", steeringPath]);

    assert.equal(detectResult.code, 0, `detect failed: ${detectResult.stdout}`);
    const detectOut = JSON.parse(detectResult.stdout);
    assert.equal(detectOut.ok, true);
    assert.equal(detectOut.state, "ready_to_rerequest_review");
    // The real loop surface now returns an overridden nextAction
    assert.equal(detectOut.steeringApplied, true);
    assert.match(detectOut.nextAction, /Stop at this safe gate/);
    assert.equal(detectOut.effectiveConstraints.stopAtNextSafeGate, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

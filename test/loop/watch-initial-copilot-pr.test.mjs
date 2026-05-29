import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseWatchInitialCopilotPrCliArgs,
  watchInitialCopilotPr,
} from "../../scripts/loop/watch-initial-copilot-pr.mjs";

const scriptPath = path.resolve("scripts/loop/watch-initial-copilot-pr.mjs");

// ---------------------------------------------------------------------------
// Subprocess helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// gh stub helpers (for subprocess / CLI integration tests)
// ---------------------------------------------------------------------------

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
      '  process.stderr.write(`unexpected extra gh call #${current + 1}: ${process.argv.slice(2).join(" ")}\\n`);',
      "  process.exit(97);",
      "}",
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
      '      process.stderr.write(`missing expected gh arg: ${expected}\\nactual: ${actual.join(" ")}\\n`);',
      "      process.exit(98);",
      "    }",
      "  }",
      "}",
      'if (entry.stderr) {',
      "  process.stderr.write(entry.stderr);",
      "}",
      'if (entry.stdout) {',
      "  process.stdout.write(entry.stdout);",
      "}",
      "process.exit(entry.exitCode ?? 0);",
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

function linkedPrPayload({ hasOpenLinkedPr = true, prNumber = 79, prUrl = "https://github.com/owner/repo/pull/79" } = {}) {
  return `${JSON.stringify({
    data: {
      repository: {
        issue: {
          timelineItems: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: hasOpenLinkedPr ? [
              {
                __typename: "ConnectedEvent",
                createdAt: "2026-05-21T09:49:32Z",
                subject: {
                  __typename: "PullRequest",
                  number: prNumber,
                  state: "OPEN",
                  url: prUrl,
                  repository: { nameWithOwner: "owner/repo" },
                },
              },
            ] : [],
          },
        },
      },
    },
  })}\n`;
}

function pullRequestFactsPayload({
  number = 79,
  url = "https://github.com/owner/repo/pull/79",
  state = "OPEN",
  isDraft = true,
  repo = "owner/repo",
  authorLogin = "Copilot",
  authorType = "Bot",
  changedFiles = 0,
  commitCount = 1,
  messageHeadline = "Initial plan",
} = {}) {
  const nodes = commitCount > 0 ? [{ commit: { messageHeadline } }] : [];

  return `${JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number,
          url,
          state,
          isDraft,
          changedFiles,
          repository: { nameWithOwner: repo },
          author: { login: authorLogin, __typename: authorType },
          commits: { totalCount: commitCount, nodes },
        },
      },
    },
  })}\n`;
}

// ---------------------------------------------------------------------------
// Injectable mock factory for watchInitialCopilotPr unit tests
// ---------------------------------------------------------------------------

/**
 * Build a mock detectInitialCopilotPrState function that replays a sequence
 * of state responses.  Each element of `states` is returned on successive calls.
 * If all states are consumed the last element is repeated indefinitely.
 */
function makeDetectMock(states) {
  let callCount = 0;
  return async () => {
    const index = Math.min(callCount, states.length - 1);
    callCount += 1;
    return states[index];
  };
}

/** Monotonically advancing fake clock.  Advances by `step` on each call. */
function makeFakeNow(startMs = 0, step = 0) {
  let current = startMs;
  return () => {
    const t = current;
    current += step;
    return t;
  };
}

// ---------------------------------------------------------------------------
// CLI arg-parsing unit tests
// ---------------------------------------------------------------------------

test("parseWatchInitialCopilotPrCliArgs parses required args", () => {
  const opts = parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "59"]);
  assert.equal(opts.repo, "owner/repo");
  assert.equal(opts.issue, 59);
  assert.equal(opts.pollIntervalMs, 60_000);
  assert.equal(opts.timeoutMs, 3_600_000);
});

test("parseWatchInitialCopilotPrCliArgs accepts --poll-interval-ms and --timeout-ms overrides", () => {
  const opts = parseWatchInitialCopilotPrCliArgs([
    "--repo", "owner/repo",
    "--issue", "59",
    "--poll-interval-ms", "5000",
    "--timeout-ms", "30000",
  ]);
  assert.equal(opts.pollIntervalMs, 5000);
  assert.equal(opts.timeoutMs, 30000);
});

test("parseWatchInitialCopilotPrCliArgs accepts --timeout-ms 0 (single-check mode)", () => {
  const opts = parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "59", "--timeout-ms", "0"]);
  assert.equal(opts.timeoutMs, 0);
});

test("parseWatchInitialCopilotPrCliArgs trims whitespace from --repo", () => {
  const opts = parseWatchInitialCopilotPrCliArgs(["--repo", "  owner/repo  ", "--issue", "59"]);
  assert.equal(opts.repo, "owner/repo");
});

test("parseWatchInitialCopilotPrCliArgs throws on missing --repo", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--issue", "59"]),
    /watch-initial-copilot-pr requires both --repo.*and --issue/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs throws on missing --issue", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo"]),
    /watch-initial-copilot-pr requires both --repo.*and --issue/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs throws on bad issue number", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "0"]),
    /--issue must be a positive integer/i,
  );
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "abc"]),
    /--issue must be a positive integer/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs throws on invalid --poll-interval-ms", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "1", "--poll-interval-ms", "0"]),
    /--poll-interval-ms must be a positive integer/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs throws on invalid --timeout-ms", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "1", "--timeout-ms", "-1"]),
    /--timeout-ms must be a non-negative integer/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs throws on unknown flag", () => {
  assert.throws(
    () => parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "1", "--unknown"]),
    /Unknown argument: --unknown/i,
  );
});

test("parseWatchInitialCopilotPrCliArgs sets help flag and returns early", () => {
  const opts = parseWatchInitialCopilotPrCliArgs(["--help"]);
  assert.equal(opts.help, true);
});

// ---------------------------------------------------------------------------
// watchInitialCopilotPr unit tests (injected mocks, no real gh calls)
// ---------------------------------------------------------------------------

test("watchInitialCopilotPr returns ready_for_followup immediately when PR is already substantive", async () => {
  const detect = makeDetectMock([
    { ok: true, state: "linked_pr_ready_for_followup", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 60_000, timeoutMs: 3_600_000 },
    { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_followup");
  assert.equal(result.repo, "owner/repo");
  assert.equal(result.issue, 59);
  assert.equal(result.prNumber, 79);
  assert.equal(result.prUrl, "https://github.com/owner/repo/pull/79");
  assert.equal(result.attempts, 1);
});

test("watchInitialCopilotPr bootstrap-only draft PR is a healthy wait state (not a failure)", async () => {
  // Single-check mode: bootstrap-only → timed_out (not an error)
  const detect = makeDetectMock([
    {
      ok: true,
      state: "waiting_for_initial_copilot_implementation",
      prNumber: 79,
      prUrl: "https://github.com/owner/repo/pull/79",
    },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 60_000, timeoutMs: 0 },
    { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "timed_out");
  assert.equal(result.prNumber, 79);
  assert.equal(result.attempts, 1);
});

test("watchInitialCopilotPr no_linked_pr is a healthy wait state (not a failure)", async () => {
  // no_linked_pr is transient and must not surface as an error
  const detect = makeDetectMock([
    { ok: true, state: "no_linked_pr", prNumber: null, prUrl: null },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 60_000, timeoutMs: 0 },
    { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "timed_out");
  assert.equal(result.prNumber, null);
  assert.equal(result.attempts, 1);
});

test("watchInitialCopilotPr transitions to ready_for_followup when PR becomes substantive", async () => {
  // Simulates the durable-auto path: first poll = still bootstrap-only,
  // second poll = substantive.  This is the core handoff scenario.
  const detect = makeDetectMock([
    {
      ok: true,
      state: "waiting_for_initial_copilot_implementation",
      prNumber: 79,
      prUrl: "https://github.com/owner/repo/pull/79",
    },
    {
      ok: true,
      state: "linked_pr_ready_for_followup",
      prNumber: 79,
      prUrl: "https://github.com/owner/repo/pull/79",
    },
  ]);

  let delayCount = 0;
  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 100, timeoutMs: 60_000 },
    {
      detectInitialCopilotPrStateImpl: detect,
      delayImpl: async () => { delayCount += 1; },
      nowMs: makeFakeNow(0, 0),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_followup");
  assert.equal(result.prNumber, 79);
  assert.equal(result.attempts, 2);
  assert.equal(delayCount, 1); // waited once between the two polls
});

test("watchInitialCopilotPr quiet idle/timeout cycles are healthy non-terminal waits", async () => {
  // Multiple bootstrap-only cycles before eventual transition.
  // None of the quiet cycles should surface as failures.
  const detect = makeDetectMock([
    { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
    { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
    { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
    { ok: true, state: "linked_pr_ready_for_followup", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 100, timeoutMs: 3_600_000 },
    {
      detectInitialCopilotPrStateImpl: detect,
      delayImpl: async () => {},
      nowMs: makeFakeNow(0, 0),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_followup");
  assert.equal(result.attempts, 4);
});

test("watchInitialCopilotPr 1-hour watch budget expiry produces explicit timed_out outcome (not implementation failure)", async () => {
  // After 3 polls the fake clock exceeds the budget.
  // The result must be timed_out, not a runtime error.
  const detect = makeDetectMock([
    { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
    { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
  ]);

  // Clock: 0 → 30 min → 60 min (= timeoutMs) → triggers timed_out on 2nd poll
  // The first two 0s are the start-time read and the elapsed check after poll 1;
  // 1_800_000 is the elapsed check after delayImpl; 3_600_000 is elapsed after poll 2.
  const HALF_HOUR_MS = 1_800_000;
  const ONE_HOUR_MS = 3_600_000;
  let tick = 0;
  const nowMs = () => {
    const times = [0, 0, HALF_HOUR_MS, ONE_HOUR_MS];
    return times[Math.min(tick++, times.length - 1)];
  };

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 1_800_000, timeoutMs: 3_600_000 },
    {
      detectInitialCopilotPrStateImpl: detect,
      delayImpl: async () => {},
      nowMs,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "timed_out");
  assert.equal(result.attempts, 2);
  // elapsedMs should be at or beyond the timeout
  assert.ok(result.elapsedMs >= 3_600_000, `expected elapsedMs >= 3600000, got ${result.elapsedMs}`);
});

test("watchInitialCopilotPr no regression: bootstrap-only PR never triggers implementation-style failure", async () => {
  // Ensures the existing bug (subagent failure for no-edit implementation task)
  // is not re-introduced.  The ok field must be true for all healthy wait outcomes.
  for (const state of ["waiting_for_initial_copilot_implementation", "no_linked_pr"]) {
    const detect = makeDetectMock([
      { ok: true, state, prNumber: state === "no_linked_pr" ? null : 79, prUrl: null },
    ]);

    const result = await watchInitialCopilotPr(
      { repo: "owner/repo", issue: 59, pollIntervalMs: 60_000, timeoutMs: 0 },
      { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
    );

    assert.equal(result.ok, true, `expected ok=true for state=${state}`);
    assert.equal(result.status, "timed_out", `expected timed_out for state=${state}`);
  }
});

test("watchInitialCopilotPr false-positive prevention: unrelated no_linked_pr does not trigger follow-up handoff", async () => {
  // no_linked_pr is a wait state, not a signal to continue or fail.
  const detect = makeDetectMock([
    { ok: true, state: "no_linked_pr", prNumber: null, prUrl: null },
    { ok: true, state: "no_linked_pr", prNumber: null, prUrl: null },
    { ok: true, state: "linked_pr_ready_for_followup", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 100, timeoutMs: 3_600_000 },
    {
      detectInitialCopilotPrStateImpl: detect,
      delayImpl: async () => {},
      nowMs: makeFakeNow(0, 0),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_followup");
  assert.equal(result.prNumber, 79);
  assert.equal(result.attempts, 3);
});

test("watchInitialCopilotPr re-checks the authoritative linked PR state on each watch cycle", async () => {
  // Validates that each cycle calls detectInitialCopilotPrState with the same
  // repo+issue target (not a stale cached value).
  const calls = [];
  const detect = async ({ repo, issue }) => {
    calls.push({ repo, issue });
    return calls.length < 3
      ? { ok: true, state: "waiting_for_initial_copilot_implementation", prNumber: 79, prUrl: null }
      : { ok: true, state: "linked_pr_ready_for_followup", prNumber: 79, prUrl: "https://github.com/owner/repo/pull/79" };
  };

  await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 59, pollIntervalMs: 100, timeoutMs: 3_600_000 },
    { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
  );

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.repo, "owner/repo");
    assert.equal(call.issue, 59);
  }
});

test("watchInitialCopilotPr output shape includes all required fields", async () => {
  const detect = makeDetectMock([
    { ok: true, state: "linked_pr_ready_for_followup", prNumber: 42, prUrl: "https://github.com/owner/repo/pull/42" },
  ]);

  const result = await watchInitialCopilotPr(
    { repo: "owner/repo", issue: 10, pollIntervalMs: 60_000, timeoutMs: 3_600_000 },
    { detectInitialCopilotPrStateImpl: detect, delayImpl: async () => {}, nowMs: makeFakeNow(0, 0) },
  );

  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.status, "string");
  assert.equal(typeof result.repo, "string");
  assert.equal(typeof result.issue, "number");
  assert.ok("prNumber" in result);
  assert.ok("prUrl" in result);
  assert.equal(typeof result.attempts, "number");
  assert.equal(typeof result.elapsedMs, "number");
});

// ---------------------------------------------------------------------------
// CLI subprocess tests (with gh stubs)
// ---------------------------------------------------------------------------

test("watch-initial-copilot-pr returns ready_for_followup via CLI when PR is immediately substantive", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-initial-pr-ready-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ changedFiles: 3, commitCount: 2, messageHeadline: "Add feature" }),
      },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--issue", "59", "--timeout-ms", "0"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "ready_for_followup");
    assert.equal(payload.prNumber, 79);
    assert.equal(payload.issue, 59);
    assert.equal(payload.repo, "owner/repo");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-initial-copilot-pr returns timed_out via CLI for bootstrap-only PR (healthy, not failure)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-initial-pr-bootstrap-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload(),
      },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--issue", "59", "--timeout-ms", "0"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "timed_out");
    assert.equal(payload.prNumber, 79);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-initial-copilot-pr returns timed_out via CLI for no_linked_pr (healthy, not failure)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-initial-pr-nopr-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload({ hasOpenLinkedPr: false }),
      },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--issue", "59", "--timeout-ms", "0"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "timed_out");
    assert.equal(payload.prNumber, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI error-handling tests
// ---------------------------------------------------------------------------

test("watch-initial-copilot-pr rejects malformed arguments deterministically", async () => {
  const missingIssue = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingIssue.code, 1);
  assert.equal(missingIssue.stdout, "");
  const missingIssueErr = JSON.parse(missingIssue.stderr);
  assert.equal(missingIssueErr.ok, false);
  assert.match(missingIssueErr.error, /watch-initial-copilot-pr requires both --repo.*and --issue/i);
  assert.equal(typeof missingIssueErr.usage, "string");
  assert.ok(missingIssueErr.usage.length > 0);

  const missingRepo = await runNode(["--issue", "59"]);
  assert.equal(missingRepo.code, 1);
  const missingRepoErr = JSON.parse(missingRepo.stderr);
  assert.equal(missingRepoErr.ok, false);
  assert.match(missingRepoErr.error, /watch-initial-copilot-pr requires both --repo.*and --issue/i);

  const badIssue = await runNode(["--repo", "owner/repo", "--issue", "abc"]);
  assert.equal(badIssue.code, 1);
  const badIssueErr = JSON.parse(badIssue.stderr);
  assert.equal(badIssueErr.ok, false);
  assert.match(badIssueErr.error, /--issue must be a positive integer/i);
  assert.equal(typeof badIssueErr.usage, "string");
  assert.ok(badIssueErr.usage.length > 0);

  const badPollInterval = await runNode(["--repo", "owner/repo", "--issue", "1", "--poll-interval-ms", "0"]);
  assert.equal(badPollInterval.code, 1);
  const badPollErr = JSON.parse(badPollInterval.stderr);
  assert.equal(badPollErr.ok, false);
  assert.match(badPollErr.error, /--poll-interval-ms must be a positive integer/i);

  const badTimeout = await runNode(["--repo", "owner/repo", "--issue", "1", "--timeout-ms", "abc"]);
  assert.equal(badTimeout.code, 1);
  const badTimeoutErr = JSON.parse(badTimeout.stderr);
  assert.equal(badTimeoutErr.ok, false);
  assert.match(badTimeoutErr.error, /--timeout-ms must be a non-negative integer/i);
});

test("watch-initial-copilot-pr --help prints usage and exits 0", async () => {
  const helpLong = await runNode(["--help"]);
  assert.equal(helpLong.code, 0);
  assert.equal(helpLong.stderr, "");
  assert.ok(helpLong.stdout.includes("watch-initial-copilot-pr.mjs"), `expected script name in help`);
  assert.ok(helpLong.stdout.includes("--repo"), `expected --repo in help`);
  assert.ok(helpLong.stdout.includes("--issue"), `expected --issue in help`);
  assert.ok(helpLong.stdout.includes("--poll-interval-ms"), `expected --poll-interval-ms in help`);
  assert.ok(helpLong.stdout.includes("--timeout-ms"), `expected --timeout-ms in help`);
  assert.ok(helpLong.stdout.includes("ready_for_followup"), `expected ready_for_followup status in help`);
  assert.ok(helpLong.stdout.includes("timed_out"), `expected timed_out status in help`);

  const helpShort = await runNode(["-h"]);
  assert.equal(helpShort.code, 0);
  assert.equal(helpShort.stdout, helpLong.stdout);
});

test("watch-initial-copilot-pr uses production-safe defaults (1-minute poll, 1-hour timeout)", () => {
  const opts = parseWatchInitialCopilotPrCliArgs(["--repo", "owner/repo", "--issue", "59"]);
  assert.equal(opts.pollIntervalMs, 60_000);
  assert.equal(opts.timeoutMs, 3_600_000);
});

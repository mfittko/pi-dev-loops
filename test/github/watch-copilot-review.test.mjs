import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import { buildAttemptBudget, buildPollDelayMs, parseWatchCliArgs } from "../../scripts/github/watch-copilot-review.mjs";

const scriptPath = path.resolve("scripts/github/watch-copilot-review.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

function createThread(commentId, login, body, type = "User") {
  return {
    id: `t-${commentId}`,
    isResolved: false,
    comments: {
      nodes: [
        {
          id: commentId,
          body,
          author: {
            login,
            __typename: type,
            isBot: type === "Bot",
          },
        },
      ],
    },
  };
}

function createReview(id, login, body, type = "User") {
  return {
    id,
    body,
    author: {
      login,
      __typename: type,
      isBot: type === "Bot",
    },
  };
}

function createIssueComment(id, login, body, type = "User") {
  return {
    id,
    body,
    author: {
      login,
      __typename: type,
      isBot: type === "Bot",
    },
  };
}

function createActivityPayload({ threads = [], reviews = [], issueComments = [] } = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { nodes: threads },
          reviews: { nodes: reviews },
          comments: { nodes: issueComments },
        },
      },
    },
  };
}

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries, { repeatLastOnOverflow: true, defaultStdout: "null\n" });
  return env;
}

function noChangePayload(status, attempts) {
  return {
    ok: true,
    status,
    repo: "owner/repo",
    pr: 17,
    attempts,
    newComments: [],
    newReviews: [],
    newIssueComments: [],
  };
}


test("buildAttemptBudget rounds up non-divisible timeout windows", () => {
  assert.equal(buildAttemptBudget(0, 60_000), 1);
  assert.equal(buildAttemptBudget(250, 100), 3);
  assert.equal(buildAttemptBudget(200, 100), 2);
});

test("buildPollDelayMs schedules polls on the requested watch timeline", () => {
  assert.equal(buildPollDelayMs(1_000, 250, 100, 1, 1_000), 100);
  assert.equal(buildPollDelayMs(1_000, 250, 100, 3, 1_200), 50);
  assert.equal(buildPollDelayMs(1_000, 250, 100, 3, 1_260), 0);
});

test("watch-copilot-review returns idle for a zero-timeout no-change check", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-idle-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(baseline)}\n` },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "0", "--poll-interval-ms", "5000"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), noChangePayload("idle", 1));
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review returns timeout after bounded polling with no fresh Copilot activity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-timeout-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(baseline)}\n` },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "2", "--poll-interval-ms", "1"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), noChangePayload("timeout", 2));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review rounds up attempt budget so non-divisible timeout still covers full window", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-timeout-round-up-"));
  const baseline = createActivityPayload();
  const stillQuiet = createActivityPayload();
  const changedLate = createActivityPayload({
    reviews: [createReview("r-3", "copilot-pull-request-reviewer[bot]", "Late Copilot summary.", "Bot")],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(stillQuiet)}\n` },
      { stdout: `${JSON.stringify(stillQuiet)}\n` },
      { stdout: `${JSON.stringify(changedLate)}\n` },
    ]);

    const result = await runNode(
      ["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "25", "--poll-interval-ms", "10"],
      { env },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      ok: true,
      status: "changed",
      repo: "owner/repo",
      pr: 17,
      attempts: 3,
      newComments: [],
      newReviews: [
        {
          id: "r-3",
          authorLogin: "copilot-pull-request-reviewer[bot]",
          body: "Late Copilot summary.",
        },
      ],
      newIssueComments: [],
    });
    const expectedTotalGhCalls = 4; // 1 baseline capture + 3 polling checks
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), expectedTotalGhCalls);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review returns changed for fresh Copilot review-thread comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-thread-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });
  const changed = createActivityPayload({
    threads: [
      createThread("c-1", "reviewer", "Please add a test."),
      createThread("c-2", "copilot-pull-request-reviewer[bot]", "Automated Copilot review feedback.", "Bot"),
    ],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(changed)}\n` },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5", "--poll-interval-ms", "1"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "changed",
      repo: "owner/repo",
      pr: 17,
      attempts: 1,
      newComments: [
        {
          id: "c-2",
          threadId: "t-c-2",
          authorLogin: "copilot-pull-request-reviewer[bot]",
          body: "Automated Copilot review feedback.",
        },
      ],
      newReviews: [],
      newIssueComments: [],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review returns changed for fresh Copilot review summaries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-review-"));
  const baseline = createActivityPayload();
  const changed = createActivityPayload({
    reviews: [createReview("r-1", "copilot-pull-request-reviewer[bot]", "Automated Copilot summary.", "Bot")],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(changed)}\n` },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5", "--poll-interval-ms", "1"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "changed",
      repo: "owner/repo",
      pr: 17,
      attempts: 1,
      newComments: [],
      newReviews: [
        {
          id: "r-1",
          authorLogin: "copilot-pull-request-reviewer[bot]",
          body: "Automated Copilot summary.",
        },
      ],
      newIssueComments: [],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review returns changed for fresh Copilot issue comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-issue-comment-"));
  const baseline = createActivityPayload();
  const changed = createActivityPayload({
    issueComments: [createIssueComment("i-1", "Copilot", "Fresh Copilot issue comment.", "Bot")],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(changed)}\n` },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5", "--poll-interval-ms", "1"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "changed",
      repo: "owner/repo",
      pr: 17,
      attempts: 1,
      newComments: [],
      newReviews: [],
      newIssueComments: [
        {
          id: "i-1",
          authorLogin: "Copilot",
          body: "Fresh Copilot issue comment.",
        },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review ignores fresh non-Copilot activity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-ignore-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });
  const changed = createActivityPayload({
    threads: [
      createThread("c-1", "reviewer", "Please add a test."),
      createThread("c-2", "maintainer", "I will handle this comment."),
    ],
    reviews: [createReview("r-1", "maintainer", "Human review summary.")],
    issueComments: [createIssueComment("i-1", "maintainer", "Human issue comment.")],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(changed)}\n` },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "1", "--poll-interval-ms", "1"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), noChangePayload("timeout", 1));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review ignores lookalike non-Copilot logins", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-lookalike-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });
  const changed = createActivityPayload({
    threads: [
      createThread("c-1", "reviewer", "Please add a test."),
      createThread("c-2", "my-copilot-helper", "This should not count as Copilot."),
    ],
    reviews: [createReview("r-1", "my-copilot-helper", "Still not Copilot.")],
    issueComments: [createIssueComment("i-1", "my-copilot-helper", "Still not Copilot.")],
  });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(changed)}\n` },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "1", "--poll-interval-ms", "1"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), noChangePayload("timeout", 1));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watch-copilot-review rejects malformed arguments and invalid poll settings deterministically", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.equal(missingPr.stdout, "");
  const missingPrErr = JSON.parse(missingPr.stderr);
  assert.equal(missingPrErr.ok, false);
  assert.equal(missingPrErr.error, "Watching Copilot review requires both --repo <owner/name> and --pr <number>");
  assert.equal(typeof missingPrErr.usage, "string");
  assert(missingPrErr.usage.length > 0);

  const invalidTimeout = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "-1"]);
  assert.equal(invalidTimeout.code, 1);
  assert.equal(invalidTimeout.stdout, "");
  const invalidTimeoutErr = JSON.parse(invalidTimeout.stderr);
  assert.equal(invalidTimeoutErr.ok, false);
  assert.equal(invalidTimeoutErr.error, "--timeout-ms must be a non-negative integer");
  assert.equal(typeof invalidTimeoutErr.usage, "string");
  assert(invalidTimeoutErr.usage.length > 0);

  const invalidInterval = await runNode(["--repo", "owner/repo", "--pr", "17", "--poll-interval-ms", "0"]);
  assert.equal(invalidInterval.code, 1);
  assert.equal(invalidInterval.stdout, "");
  const invalidIntervalErr = JSON.parse(invalidInterval.stderr);
  assert.equal(invalidIntervalErr.ok, false);
  assert.equal(invalidIntervalErr.error, "--poll-interval-ms must be a positive integer");
  assert.equal(typeof invalidIntervalErr.usage, "string");
  assert(invalidIntervalErr.usage.length > 0);

  const invalidRepo = await runNode(["--repo", " owner / repo ", "--pr", "17"]);
  assert.equal(invalidRepo.code, 1);
  assert.equal(invalidRepo.stdout, "");
  const invalidRepoErr = JSON.parse(invalidRepo.stderr);
  assert.equal(invalidRepoErr.ok, false);
  assert.equal(invalidRepoErr.error, "--repo must match <owner/name>");
  assert.equal(typeof invalidRepoErr.usage, "string");
  assert(invalidRepoErr.usage.length > 0);
});

test("watch-copilot-review --help prints usage and exits 0", async () => {
  const helpLong = await runNode(["--help"]);
  assert.equal(helpLong.code, 0);
  assert.equal(helpLong.stderr, "");
  assert(helpLong.stdout.includes("watch-copilot-review.mjs"), `expected script name in help, got: ${helpLong.stdout}`);
  assert(helpLong.stdout.includes("--repo"), `expected --repo in help`);
  assert(helpLong.stdout.includes("--pr"), `expected --pr in help`);
  assert(helpLong.stdout.includes("--poll-interval-ms"), `expected --poll-interval-ms in help`);
  assert(helpLong.stdout.includes("--timeout-ms"), `expected --timeout-ms in help`);

  const helpShort = await runNode(["-h"]);
  assert.equal(helpShort.code, 0);
  assert.equal(helpShort.stderr, "");
  assert.equal(helpShort.stdout, helpLong.stdout);
});

test("watch-copilot-review uses production-safe defaults (1-minute poll, 30-minute timeout)", () => {
  const options = parseWatchCliArgs(["--repo", "owner/repo", "--pr", "17"]);
  assert.equal(options.pollIntervalMs, 60_000);
  assert.equal(options.timeoutMs, 1_800_000);
});

test("watch-copilot-review trims surrounding whitespace from --repo", () => {
  const options = parseWatchCliArgs(["--repo", " owner/repo ", "--pr", "17"]);
  assert.equal(options.repo, "owner/repo");
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/github/watch-copilot-review.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve) => {
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

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

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
      'const entry = entries[Math.min(current, entries.length - 1)] ?? { stdout: "null\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
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

test("watch-copilot-review returns idle for a zero-timeout no-change check", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-watch-copilot-idle-"));
  const baseline = createActivityPayload({ threads: [createThread("c-1", "reviewer", "Please add a test.")] });

  try {
    const env = await writeGhStub(tempDir, [
      { stdout: `${JSON.stringify(baseline)}\n` },
      { stdout: `${JSON.stringify(baseline)}\n` },
    ]);

    const startedAt = Date.now();
    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "0"], { env });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), noChangePayload("idle", 1));
    assert(elapsedMs < 1_000, `expected immediate recheck, got ${elapsedMs}ms`);
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

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5"], { env });

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

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5"], { env });

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

    const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "5"], { env });

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
  assert.deepEqual(JSON.parse(missingPr.stderr), {
    ok: false,
    error: "Watching Copilot review requires both --repo <owner/name> and --pr <number>",
  });

  const invalidTimeout = await runNode(["--repo", "owner/repo", "--pr", "17", "--timeout-ms", "-1"]);
  assert.equal(invalidTimeout.code, 1);
  assert.equal(invalidTimeout.stdout, "");
  assert.deepEqual(JSON.parse(invalidTimeout.stderr), {
    ok: false,
    error: "--timeout-ms must be a non-negative integer",
  });

  const invalidInterval = await runNode(["--repo", "owner/repo", "--pr", "17", "--poll-interval-ms", "0"]);
  assert.equal(invalidInterval.code, 1);
  assert.equal(invalidInterval.stdout, "");
  assert.deepEqual(JSON.parse(invalidInterval.stderr), {
    ok: false,
    error: "--poll-interval-ms must be a positive integer",
  });
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/loop/detect-initial-copilot-pr-state.mjs");

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
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            nodes: hasOpenLinkedPr ? [
              {
                __typename: "ConnectedEvent",
                createdAt: "2026-05-21T09:49:32Z",
                subject: {
                  __typename: "PullRequest",
                  number: prNumber,
                  state: "OPEN",
                  url: prUrl,
                  repository: {
                    nameWithOwner: "owner/repo",
                  },
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
  headRefName = "copilot/example-branch",
  state = "OPEN",
  isDraft = true,
  repo = "owner/repo",
  authorLogin = "Copilot",
  authorType = "Bot",
  changedFiles = 0,
  commitCount = 1,
  messageHeadline = "Initial plan",
} = {}) {
  const nodes = commitCount > 0
    ? [{ commit: { messageHeadline } }]
    : [];

  return `${JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number,
          url,
          headRefName,
          state,
          isDraft,
          changedFiles,
          repository: { nameWithOwner: repo },
          author: { login: authorLogin, __typename: authorType },
          commits: {
            totalCount: commitCount,
            nodes,
          },
        },
      },
    },
  })}\n`;
}

function workflowRunsPayload(runs = []) {
  return `${JSON.stringify(runs)}\n`;
}

test("detect-initial-copilot-pr-state returns no_linked_pr when no linked PR exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-none-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload({ hasOpenLinkedPr: false }),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      issue: 59,
      state: "no_linked_pr",
      prNumber: null,
      prUrl: null,
      headBranch: null,
      isDraft: null,
      changedFiles: null,
      commitCount: null,
      soleCommitHeadline: null,
      sessionActivity: null,
      sessionRunId: null,
      sessionRunName: null,
      sessionRunStatus: null,
      sessionRunConclusion: null,
      sessionRunCreatedAt: null,
      sessionConfidence: null,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns waiting_for_initial_copilot_implementation for bootstrap-only Copilot draft", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-bootstrap-"));

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
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload(),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "waiting_for_initial_copilot_implementation");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns waiting_for_initial_copilot_implementation for bootstrap-only copilot-swe-agent draft", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-bootstrap-swe-agent-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ authorLogin: "copilot-swe-agent" }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload(),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "waiting_for_initial_copilot_implementation");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns linked_pr_ready_for_followup for substantive linked draft PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-substantive-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ changedFiles: 2 }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload([
          {
            databaseId: 91,
            name: "Copilot coding for issue mfittko/pi-dev-loops#59",
            status: "completed",
            conclusion: "success",
            createdAt: "2026-05-21T12:00:00Z",
          },
        ]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "linked_pr_ready_for_followup");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns linked_pr_ready_for_followup when the linked PR has more than one commit", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-multi-commit-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ commitCount: 2, changedFiles: 0, messageHeadline: "Initial plan" }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload([
          {
            databaseId: 91,
            name: "Copilot coding for issue mfittko/pi-dev-loops#59",
            status: "completed",
            conclusion: "success",
            createdAt: "2026-05-21T12:00:00Z",
          },
        ]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "linked_pr_ready_for_followup");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns linked_pr_ready_for_followup for a ready-for-review PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-ready-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ isDraft: false, changedFiles: 0, commitCount: 1, messageHeadline: "Initial plan" }),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "linked_pr_ready_for_followup");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns linked_pr_ready_for_followup for non-Copilot draft PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-non-copilot-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ authorLogin: "octocat", authorType: "User" }),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).state, "linked_pr_ready_for_followup");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state exits bootstrap wait state when implementation commits land", async () => {
  const firstDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-transition-a-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-transition-b-"));

  try {
    const firstEnv = await writeGhStub(firstDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ commitCount: 1, changedFiles: 0, messageHeadline: "Initial plan" }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload(),
      },
    ]);
    const secondEnv = await writeGhStub(secondDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ commitCount: 2, changedFiles: 1, messageHeadline: "Implement feature" }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload([
          {
            databaseId: 91,
            name: "Copilot coding for issue mfittko/pi-dev-loops#59",
            status: "completed",
            conclusion: "success",
            createdAt: "2026-05-21T12:00:00Z",
          },
        ]),
      },
    ]);

    const firstResult = await runNode(["--repo", "owner/repo", "--issue", "59"], { env: firstEnv });
    const secondResult = await runNode(["--repo", "owner/repo", "--issue", "59"], { env: secondEnv });

    assert.equal(firstResult.code, 0);
    assert.equal(JSON.parse(firstResult.stdout).state, "waiting_for_initial_copilot_implementation");

    assert.equal(secondResult.code, 0);
    assert.equal(JSON.parse(secondResult.stdout).state, "linked_pr_ready_for_followup");
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state falls back to substantive PR heuristics when session activity is idle", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-idle-substantive-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ changedFiles: 3, commitCount: 2 }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload(),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.state, "linked_pr_ready_for_followup");
    assert.equal(payload.sessionActivity, "idle");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state returns copilot_session_active while Copilot run is in progress", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-active-session-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: pullRequestFactsPayload({ changedFiles: 3, commitCount: 2 }),
      },
      {
        assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/example-branch"],
        stdout: workflowRunsPayload([
          {
            databaseId: 123,
            name: "Addressing comment on PR mfittko/pi-dev-loops#79",
            status: "in_progress",
            conclusion: "",
            createdAt: "2026-05-21T12:00:00Z",
          },
        ]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.state, "copilot_session_active");
    assert.equal(payload.sessionActivity, "active");
    assert.equal(payload.sessionRunId, 123);
    assert.equal(payload.sessionRunStatus, "in_progress");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-initial-copilot-pr-state rejects malformed arguments deterministically", async () => {
  const missingIssue = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingIssue.code, 1);
  assert.equal(missingIssue.stdout, "");
  const missingIssueErr = JSON.parse(missingIssue.stderr);
  assert.equal(missingIssueErr.ok, false);
  assert.equal(missingIssueErr.error, "detect-initial-copilot-pr-state requires both --repo <owner/name> and --issue <number>");
  assert.equal(typeof missingIssueErr.usage, "string");
  assert(missingIssueErr.usage.length > 0);

  const badIssue = await runNode(["--repo", "owner/repo", "--issue", "0"]);
  assert.equal(badIssue.code, 1);
  assert.equal(badIssue.stdout, "");
  const badIssueErr = JSON.parse(badIssue.stderr);
  assert.equal(badIssueErr.ok, false);
  assert.equal(badIssueErr.error, "--issue must be a positive integer");
  assert.equal(typeof badIssueErr.usage, "string");
  assert(badIssueErr.usage.length > 0);
});

test("detect-initial-copilot-pr-state fails closed when required PR facts are missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-initial-pr-missing-facts-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "-F", "issue=59", "owner=owner", "name=repo"],
        stdout: linkedPrPayload(),
      },
      {
        assertArgs: ["api", "graphql", "-F", "pr=79", "owner=owner", "name=repo"],
        stdout: `${JSON.stringify({ data: { repository: { pullRequest: { number: 79 } } } })}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "59"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Missing required PR facts/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

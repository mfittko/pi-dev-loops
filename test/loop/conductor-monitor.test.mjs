import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper } from "../_helpers.mjs";

const scriptPath = path.resolve("scripts/loop/conductor-monitor.mjs");
const mixedThreadsFixturePath = path.resolve("packages/core/test/fixtures/github/review-threads/mixed-threads.json");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries);
  return env;
}

function emptyThreadsPayload() {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
          },
        },
      },
    },
  });
}

test("conductor-monitor reports queue_complete when no open PRs exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-monitor-empty-"));

  try {
    const env = await writeGhStub(tempDir, [{
      assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
      stdout: "[]\n",
    }]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.repo, "owner/repo");
    assert.equal(payload.prCount, 0);
    assert.equal(payload.queueStatus, "queue_complete");
    assert.equal(payload.needsAttentionCount, 0);
    assert.deepEqual(payload.prs, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conductor-monitor fails closed when gh pr list returns non-array JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-monitor-invalid-list-"));

  try {
    const env = await writeGhStub(tempDir, [{
      assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
      stdout: "{}\n",
    }]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /expected an array/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conductor-monitor reports monitoring when open PRs are still in healthy wait states", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-monitor-waiting-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
        stdout: `${JSON.stringify([
          {
            number: 17,
            title: "Add monitor status report",
            url: "https://github.com/owner/repo/pull/17",
            isDraft: false,
            headRefName: "copilot/issue-383",
            author: { login: "copilot-swe-agent" },
          },
        ])}\n`,
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: `${JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [],
          statusCheckRollup: [],
        })}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"copilot-pull-request-reviewer[bot]"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: `${emptyThreadsPayload()}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.queueStatus, "monitoring");
    assert.equal(payload.needsAttentionCount, 0);
    assert.equal(payload.summary.waiting, 1);
    assert.equal(payload.summary.needsAttention, 0);
    assert.equal(payload.prs[0].number, 17);
    assert.equal(payload.prs[0].state, "waiting_for_copilot_review");
    assert.equal(payload.prs[0].loopDisposition, "pending");
    assert.equal(payload.prs[0].needsAttention, false);
    assert.equal(payload.prs[0].snapshot.copilotReviewRequestStatus, "requested");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conductor-monitor flags unresolved-feedback PRs as needing attention while preserving pending waits", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-monitor-attention-"));
  const mixedThreadsFixture = await readFile(mixedThreadsFixturePath, "utf8");

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
        stdout: `${JSON.stringify([
          {
            number: 17,
            title: "Add conductor monitor wrapper",
            url: "https://github.com/owner/repo/pull/17",
            isDraft: false,
            headRefName: "copilot/issue-383-wrapper",
            author: { login: "copilot-swe-agent" },
          },
          {
            number: 18,
            title: "Document monitor pattern",
            url: "https://github.com/owner/repo/pull/18",
            isDraft: false,
            headRefName: "copilot/issue-383-docs",
            author: { login: "copilot-swe-agent" },
          },
        ])}\n`,
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: `${JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          reviews: [{ id: "r-1", author: { login: "copilot-pull-request-reviewer[bot]" } }],
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
        })}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: mixedThreadsFixture,
      },
      {
        assertArgs: ["pr", "view", "18", "--repo", "owner/repo"],
        stdout: `${JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 18,
          reviews: [],
          statusCheckRollup: [],
        })}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/18/requested_reviewers"],
        stdout: '{"users":[{"login":"copilot-pull-request-reviewer[bot]"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql"],
        stdout: `${emptyThreadsPayload()}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.queueStatus, "attention_needed");
    assert.equal(payload.needsAttentionCount, 1);
    assert.equal(payload.summary.waiting, 1);
    assert.equal(payload.summary.needsAttention, 1);
    assert.equal(payload.summary.blocked, 0);

    const actionable = payload.prs.find((pr) => pr.number === 17);
    const waiting = payload.prs.find((pr) => pr.number === 18);

    assert.equal(actionable.state, "unresolved_feedback_present");
    assert.equal(actionable.loopDisposition, "unresolved_feedback");
    assert.equal(actionable.needsAttention, true);
    assert.equal(actionable.snapshot.unresolvedThreadCount, 2);
    assert.equal(actionable.snapshot.actionableThreadCount, 1);

    assert.equal(waiting.state, "waiting_for_copilot_review");
    assert.equal(waiting.loopDisposition, "pending");
    assert.equal(waiting.needsAttention, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

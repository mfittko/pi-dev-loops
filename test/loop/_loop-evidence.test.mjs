import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCopilotEvidence, loadReviewerEvidence } from "../../scripts/loop/_loop-evidence.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempDir(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-loop-evidence-test-"));
  try {
    return await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const MINIMAL_COPILOT_SNAPSHOT = {
  prExists: true,
  prState: "OPEN",
  isDraft: false,
  prNumber: 42,
  prHeadSha: "abc123",
  hasPendingCopilotReview: false,
  hasExistingCopilotReview: false,
  resolvedThreadCount: 0,
  unresolvedThreadCount: 0,
  resolvedThreadIds: [],
  unresolvedThreadIds: [],
};

const MINIMAL_REVIEWER_SNAPSHOT = {
  prExists: true,
  prState: "OPEN",
  isDraft: false,
  prNumber: 42,
  reviewerScope: "all_reviewers",
  reviewerLogin: null,
};

// ---------------------------------------------------------------------------
// loadCopilotEvidence: input-file mode
// ---------------------------------------------------------------------------

test("loadCopilotEvidence: reads snapshot from copilotInputPath and returns interpretation", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "copilot.json");
    await writeJson(inputPath, MINIMAL_COPILOT_SNAPSHOT);

    const result = await loadCopilotEvidence({ repo: "owner/repo", pr: 42, copilotInputPath: inputPath });

    assert.ok(result.snapshot, "snapshot should be present");
    assert.ok(result.interpretation, "interpretation should be present");
    assert.equal(result.snapshot.prExists, true);
    assert.ok(typeof result.interpretation.state === "string", "interpretation.state should be a string");
  });
});

test("loadCopilotEvidence: throws when copilotInputPath does not exist", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "missing.json");

    await assert.rejects(
      () => loadCopilotEvidence({ repo: "owner/repo", pr: 42, copilotInputPath: inputPath }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.code === "ENOENT", `Expected ENOENT, got ${err.code}`);
        return true;
      },
    );
  });
});

test("loadCopilotEvidence: snapshot normalizes and interpretation reflects prExists=false", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "copilot.json");
    await writeJson(inputPath, { prExists: false });

    const result = await loadCopilotEvidence({ repo: "owner/repo", pr: 42, copilotInputPath: inputPath });

    assert.equal(result.snapshot.prExists, false);
    assert.equal(result.interpretation.state, "no_pr");
  });
});

// ---------------------------------------------------------------------------
// loadReviewerEvidence: input-file mode
// ---------------------------------------------------------------------------

test("loadReviewerEvidence: reads snapshot from reviewerInputPath and returns interpretation", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "reviewer.json");
    await writeJson(inputPath, MINIMAL_REVIEWER_SNAPSHOT);

    const result = await loadReviewerEvidence({ repo: "owner/repo", pr: 42, reviewerInputPath: inputPath });

    assert.ok(result.snapshot, "snapshot should be present");
    assert.ok(result.interpretation, "interpretation should be present");
    assert.equal(result.snapshot.prExists, true);
    assert.ok(typeof result.interpretation.state === "string", "interpretation.state should be a string");
  });
});

test("loadReviewerEvidence: throws when reviewerInputPath does not exist", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "missing.json");

    await assert.rejects(
      () => loadReviewerEvidence({ repo: "owner/repo", pr: 42, reviewerInputPath: inputPath }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.code === "ENOENT", `Expected ENOENT, got ${err.code}`);
        return true;
      },
    );
  });
});

test("loadReviewerEvidence: snapshot normalizes and interpretation reflects prExists=false", async () => {
  await withTempDir(async (tempDir) => {
    const inputPath = path.join(tempDir, "reviewer.json");
    await writeJson(inputPath, { prExists: false });

    const result = await loadReviewerEvidence({ repo: "owner/repo", pr: 42, reviewerInputPath: inputPath });

    assert.equal(result.snapshot.prExists, false);
    // When prExists=false the reviewer state machine returns waiting_for_review_request
    assert.equal(result.interpretation.state, "waiting_for_review_request");
  });
});

// ---------------------------------------------------------------------------
// loadCopilotEvidence / loadReviewerEvidence: live-detection mode
// ---------------------------------------------------------------------------

/**
 * Write a minimal gh stub that returns a valid copilot PR snapshot.
 */
async function writeGhStubForCopilot(tempDir) {
  const ghPath = path.join(tempDir, "gh");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (v) => process.stdout.write(JSON.stringify(v));
if (args[0] === "pr" && args[1] === "view") {
  out({
    isDraft: false,
    state: "OPEN",
    number: 42,
    headRefOid: "abc123",
    reviews: [],
    statusCheckRollup: [],
  });
  process.exit(0);
}
if (args[0] === "api") {
  // review threads GraphQL
  if (args.some((a) => a.includes("pullRequest"))) {
    out({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    process.exit(0);
  }
}
out([]);
process.exit(0);
`;
  await writeFile(ghPath, script, { mode: 0o755 });
  return ghPath;
}

/**
 * Write a minimal gh stub that returns a valid reviewer PR snapshot.
 */
async function writeGhStubForReviewer(tempDir) {
  const ghPath = path.join(tempDir, "gh");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (v) => process.stdout.write(JSON.stringify(v));
if (args[0] === "pr" && args[1] === "view") {
  out({
    isDraft: false,
    state: "OPEN",
    number: 42,
    headRefOid: "abc123",
    reviews: [],
    statusCheckRollup: [],
  });
  process.exit(0);
}
out([]);
process.exit(0);
`;
  await writeFile(ghPath, script, { mode: 0o755 });
  return ghPath;
}

test("loadCopilotEvidence: calls live detection when no copilotInputPath", async () => {
  await withTempDir(async (tempDir) => {
    await writeGhStubForCopilot(tempDir);
    const env = { ...process.env, PATH: `${tempDir}:${process.env.PATH}` };

    const result = await loadCopilotEvidence({ repo: "owner/repo", pr: 42 }, { env, ghCommand: "gh" });

    assert.ok(result.snapshot, "snapshot should be present");
    assert.ok(result.interpretation, "interpretation should be present");
    assert.ok(typeof result.interpretation.state === "string", "interpretation.state should be a string");
  });
});

test("loadReviewerEvidence: calls live detection when no reviewerInputPath", async () => {
  await withTempDir(async (tempDir) => {
    await writeGhStubForReviewer(tempDir);
    const env = { ...process.env, PATH: `${tempDir}:${process.env.PATH}` };

    const result = await loadReviewerEvidence({ repo: "owner/repo", pr: 42 }, { env, ghCommand: "gh" });

    assert.ok(result.snapshot, "snapshot should be present");
    assert.ok(result.interpretation, "interpretation should be present");
    assert.ok(typeof result.interpretation.state === "string", "interpretation.state should be a string");
  });
});

test("loadCopilotEvidence: throws when live detection fails (gh not found)", async () => {
  await withTempDir(async (tempDir) => {
    // No gh stub in tempDir so detection fails
    const env = { ...process.env, PATH: tempDir };

    await assert.rejects(
      () => loadCopilotEvidence({ repo: "owner/repo", pr: 42 }, { env, ghCommand: "gh" }),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});

test("loadReviewerEvidence: throws when live detection fails (gh not found)", async () => {
  await withTempDir(async (tempDir) => {
    const env = { ...process.env, PATH: tempDir };

    await assert.rejects(
      () => loadReviewerEvidence({ repo: "owner/repo", pr: 42 }, { env, ghCommand: "gh" }),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});

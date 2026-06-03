import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper } from "../_helpers.mjs";

import { buildCreateDraftPrArgs } from "../../scripts/github/create-draft-pr.mjs";

const scriptPath = path.resolve("scripts/github/create-draft-pr.mjs");
const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries, options = {}) {
  return writeGhStubHelper(tempDir, entries, {
    repeatLastOnOverflow: true,
    logCalls: true,
    ...options,
  });
}

async function readGhCalls(logPath) {
  const lines = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

test("buildCreateDraftPrArgs injects --draft when absent", () => {
  assert.deepEqual(
    buildCreateDraftPrArgs(["--repo", "owner/repo", "--assignee", "@me"]),
    {
      help: false,
      ghArgs: ["pr", "create", "--repo", "owner/repo", "--assignee", "@me", "--draft"],
    },
  );
});

test("buildCreateDraftPrArgs avoids adding a duplicate --draft", () => {
  assert.deepEqual(
    buildCreateDraftPrArgs(["--draft", "--repo", "owner/repo", "--assignee", "@me"]),
    {
      help: false,
      ghArgs: ["pr", "create", "--draft", "--repo", "owner/repo", "--assignee", "@me"],
    },
  );
});

test("buildCreateDraftPrArgs rejects --ready before gh is invoked", () => {
  assert.throws(
    () => buildCreateDraftPrArgs(["--repo", "owner/repo", "--ready"]),
    /rejects --ready/i,
  );
});

test("buildCreateDraftPrArgs appends --draft after a false-valued draft token", () => {
  assert.deepEqual(
    buildCreateDraftPrArgs(["--repo", "owner/repo", "--draft=false"]),
    {
      help: false,
      ghArgs: ["pr", "create", "--repo", "owner/repo", "--draft=false", "--draft"],
    },
  );
});

test("buildCreateDraftPrArgs treats --draft=true as already supplied", () => {
  assert.deepEqual(
    buildCreateDraftPrArgs(["--repo", "owner/repo", "--draft=true"]),
    {
      help: false,
      ghArgs: ["pr", "create", "--repo", "owner/repo", "--draft=true"],
    },
  );
});

test("create-draft-pr --help documents draft-only behavior and --ready rejection", async () => {
  const result = await runNode(["--help"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Thin wrapper around `gh pr create`/i);
  assert.match(result.stdout, /injects exactly one `--draft` when absent/i);
  assert.match(result.stdout, /rejects `--ready` before invoking `gh`/i);
  assert.match(result.stdout, /preserves the underlying `gh pr create` stdout, stderr, and exit code/i);
});

test("create-draft-pr forwards args in order and preserves gh stdout on success", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-success-"));

  try {
    const { env, ghLogPath } = await writeGhStub(tempDir, [
      {
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--assignee", "@me",
      "--base", "main",
      "--head", "issue-349-create-draft-pr",
      "--title", "Add draft wrapper",
      "--body-file", "tmp/pr-body.md",
      "positional-token",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "https://github.com/owner/repo/pull/17\n");
    assert.deepEqual(await readGhCalls(ghLogPath), [[
      "pr", "create",
      "--repo", "owner/repo",
      "--assignee", "@me",
      "--base", "main",
      "--head", "issue-349-create-draft-pr",
      "--title", "Add draft wrapper",
      "--body-file", "tmp/pr-body.md",
      "positional-token",
      "--draft",
    ]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("create-draft-pr preserves an existing --draft without adding another copy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-existing-draft-"));

  try {
    const { env, ghLogPath } = await writeGhStub(tempDir, [
      {
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
    ]);

    const result = await runNode([
      "--draft",
      "--repo", "owner/repo",
      "--assignee", "@me",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "https://github.com/owner/repo/pull/17\n");
    assert.deepEqual(await readGhCalls(ghLogPath), [[
      "pr", "create", "--draft", "--repo", "owner/repo", "--assignee", "@me",
    ]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("create-draft-pr appends --draft after --draft=false so draft-first still wins", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-false-draft-"));

  try {
    const { env, ghLogPath } = await writeGhStub(tempDir, [
      {
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--draft=false"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "https://github.com/owner/repo/pull/17\n");
    assert.deepEqual(await readGhCalls(ghLogPath), [[
      "pr", "create", "--repo", "owner/repo", "--draft=false", "--draft",
    ]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("create-draft-pr treats --draft=true as already supplied and avoids a duplicate", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-true-draft-"));

  try {
    const { env, ghLogPath } = await writeGhStub(tempDir, [
      {
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--draft=true"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "https://github.com/owner/repo/pull/17\n");
    assert.deepEqual(await readGhCalls(ghLogPath), [[
      "pr", "create", "--repo", "owner/repo", "--draft=true",
    ]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("create-draft-pr rejects --ready without invoking gh", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-ready-reject-"));

  try {
    const { env, counterPath, ghLogPath } = await writeGhStub(tempDir, []);
    const result = await runNode(["--repo", "owner/repo", "--ready"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const stderrPayload = JSON.parse(result.stderr);
    assert.match(stderrPayload.error, /rejects --ready/i);
    assert.match(stderrPayload.usage, /Usage: create-draft-pr\.mjs/i);
    assert.equal((await readFile(counterPath, "utf8")).trim(), "0");
    assert.deepEqual(await readGhCalls(ghLogPath), []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("create-draft-pr preserves gh stdout, stderr, and exit code on failure", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-create-draft-pr-gh-failure-"));

  try {
    const { env, ghLogPath } = await writeGhStub(tempDir, [
      {
        stdout: "partial gh stdout\n",
        stderr: "gh create failed\n",
        exitCode: 3,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--assignee", "@me"], { env });

    assert.equal(result.code, 3);
    assert.equal(result.stdout, "partial gh stdout\n");
    assert.equal(result.stderr, "gh create failed\n");
    assert.deepEqual(await readGhCalls(ghLogPath), [[
      "pr", "create", "--repo", "owner/repo", "--assignee", "@me", "--draft",
    ]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

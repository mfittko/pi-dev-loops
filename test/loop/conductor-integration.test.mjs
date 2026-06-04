import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runConductor } from "../../scripts/loop/conductor.mjs";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper } from "../_helpers.mjs";

const scriptPath = path.resolve("scripts/loop/conductor.mjs");
const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

// ---------------------------------------------------------------------------
// Unit: runConductor with real gh unavailable (graceful degradation)
// ---------------------------------------------------------------------------

test("runConductor degrades gracefully with cycle-only", async () => {
  const result = await runConductor(
    { repo: "test/repo", cycleOnly: true, monitorOnly: false, autoResume: false },
    {
      env: process.env,
      ghCommand: "gh",
      repoRoot: process.cwd(),
    },
  );

  assert.equal(result.monitor, null);
  // cycle will fail because no real gh, but structure should be present
  assert.ok(result.cycle !== null);
  assert.ok("ok" in result.cycle || "error" in (result.cycle ?? {}));
});

test("runConductor degrades gracefully with monitor-only", async () => {
  const result = await runConductor(
    { repo: "test/repo", cycleOnly: false, monitorOnly: true, autoResume: false },
    {
      env: process.env,
      ghCommand: "gh",
      repoRoot: process.cwd(),
    },
  );

  assert.equal(result.cycle, null);
  assert.ok(result.monitor !== null);
});

// ---------------------------------------------------------------------------
// CLI: gh stub integration (cycle-only to avoid parallel gh consumption)
// ---------------------------------------------------------------------------

test("conductor --cycle-only CLI reports empty queue when no open PRs exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-cycle-only-"));

  try {
    const { env } = await writeGhStubHelper(tempDir, [{
      assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
      stdout: "[]\n",
    }]);

    const { code, stdout, stderr } = await runNode(["--repo", "owner/repo", "--cycle-only"], { env });

    assert.equal(code, 0);
    assert.equal(stderr, "");

    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.monitor, null);
    assert.equal(payload.cycle.prCount, 0);
    assert.deepEqual(payload.cycle.actions, []);
    assert.equal(payload.summary.totalPrs, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conductor --monitor-only CLI reports queue_complete when no open PRs exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-monitor-only-"));

  try {
    const { env } = await writeGhStubHelper(tempDir, [{
      assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
      stdout: "[]\n",
    }]);

    const { code, stdout, stderr } = await runNode(["--repo", "owner/repo", "--monitor-only"], { env });

    assert.equal(code, 0);
    assert.equal(stderr, "");

    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.cycle, null);
    assert.equal(payload.monitor.queueStatus, "queue_complete");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conductor CLI with both cycle and monitor uses repeat-last for sequential gh calls", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-conductor-both-"));

  try {
    // repeatLastOnOverflow so both cycle and monitor can consume the same stub
    const { env } = await writeGhStubHelper(tempDir, [{
      assertArgs: ["pr", "list", "--repo", "owner/repo", "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefName,author"],
      stdout: "[]\n",
    }], { repeatLastOnOverflow: true });

    const { code, stdout, stderr } = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(code, 0);
    assert.equal(stderr, "");

    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    // Both cycle and monitor should report 0 PRs
    assert.equal(payload.cycle.prCount, 0);
    assert.equal(payload.cycle.actions.length, 0);
    assert.equal(payload.monitor.queueStatus, "queue_complete");
    assert.equal(payload.monitor.prCount, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

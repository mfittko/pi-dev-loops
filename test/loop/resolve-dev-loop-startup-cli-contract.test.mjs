import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = path.join(repoRoot, "scripts", "loop", "resolve-dev-loop-startup.mjs");

async function withInputFile(input, fn) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resolve-dev-loop-cli-contract-"));
  const inputPath = path.join(tmpDir, "startup-input.json");
  await writeFile(inputPath, JSON.stringify(input));
  try {
    return await fn(inputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

test("resolve-dev-loop-startup help documents accepted flags and JSON contracts", () => {
  const result = spawnSync(process.execPath, [cliPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Usage:\n  resolve-dev-loop-startup\.mjs --input <path>/);
  assert.match(result.stdout, /--input <path>\s+Path to a JSON file/);
  assert.match(result.stdout, /Output \(stdout, JSON\):/);
  assert.match(result.stdout, /"selectedStrategy": "\.\.\."/);
  assert.match(result.stdout, /Error output \(stderr, JSON\):/);
  assert.match(result.stdout, /Exit codes:\n  0  Success\n  1  Argument error, runtime failure, or async-start contract rejection/);
});

test("resolve-dev-loop-startup success stdout keeps documented JSON shape", async () => {
  await withInputFile({
    currentState: {
      target: { kind: "issue", issue: 429 },
      ownership: "copilot",
      nextActor: "user",
      status: "active",
      authorization: "authorized",
    },
    artifactState: "not_applicable",
    issueLinkageResolution: "resolved_no_open_pr",
    issueReadiness: "ready",
    issueAssignmentState: "unassigned",
    loopState: "active",
    retrospectiveCheckpointState: "complete",
  }, async (inputPath) => {
    const result = spawnSync(process.execPath, [cliPath, "--input", inputPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");

    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed), [
      "ok",
      "bundleKind",
      "selectedStrategy",
      "requiredReads",
      "nextAction",
      "canonicalStateSummary",
      "bundle",
    ]);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.bundleKind, "resolved");
    assert.equal(parsed.selectedStrategy, "issue_intake");
    assert.deepEqual(parsed.requiredReads, [
      "skills/docs/public-dev-loop-contract.md",
      "skills/docs/retrospective-checkpoint-contract.md",
      "skills/copilot-pr-followup/SKILL.md",
      "skills/docs/copilot-loop-operations.md",
      "skills/docs/issue-intake-procedure.md",
    ]);
    assert.deepEqual(Object.keys(parsed.canonicalStateSummary), [
      "target",
      "ownership",
      "nextActor",
      "status",
      "authorization",
      "artifactState",
      "issueLinkageResolution",
      "loopState",
      "routeKind",
      "selectedGate",
      "executionMode",
      "waitSemantics",
      "requiresAsyncDispatch",
    ]);
    assert.equal(parsed.canonicalStateSummary.requiresAsyncDispatch, true);
    assert.equal(parsed.bundle.contractTrace.decision.selectedGate, "issue_intake");
  });
});

test("resolve-dev-loop-startup malformed args keep documented stderr JSON shape", () => {
  const result = spawnSync(process.execPath, [cliPath, "--bogus"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const parsed = JSON.parse(result.stderr);
  assert.deepEqual(Object.keys(parsed), ["ok", "error", "usage"]);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "Unknown argument: --bogus");
  assert.match(parsed.usage, /Usage:\n  resolve-dev-loop-startup\.mjs --input <path>/);
});

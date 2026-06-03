import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import {
  buildResolveDevLoopStartupResult,
  parseResolveDevLoopStartupCliArgs,
  summarizeCanonicalState,
} from "../../scripts/loop/resolve-dev-loop-startup.mjs";

const scriptPath = path.resolve("scripts/loop/resolve-dev-loop-startup.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeTempJson(tempDir, name, value) {
  const filePath = path.join(tempDir, name);
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
  return filePath;
}

test("parseResolveDevLoopStartupCliArgs rejects missing --input", () => {
  assert.throws(() => parseResolveDevLoopStartupCliArgs([]), /--input .* is required/i);
});

test("parseResolveDevLoopStartupCliArgs parses --input and --help", () => {
  assert.deepEqual(parseResolveDevLoopStartupCliArgs(["--input", "state.json"]), {
    help: false,
    inputPath: "state.json",
  });
  assert.deepEqual(parseResolveDevLoopStartupCliArgs(["--help"]), {
    help: true,
    inputPath: undefined,
  });
});

test("buildResolveDevLoopStartupResult maps local implementation to the local route pack", () => {
  const result = buildResolveDevLoopStartupResult({
    currentState: {
      target: { kind: "local_branch", branch: "feature/local-route" },
      ownership: "local",
      nextActor: "local",
      status: "active",
      authorization: "needs_confirmation",
    },
    artifactState: "not_applicable",
    loopState: "active",
  });

  assert.equal(result.bundleKind, "resolved");
  assert.equal(result.selectedStrategy, "local_implementation");
  assert.deepEqual(result.requiredReads, [
    "skills/docs/public-dev-loop-contract.md",
    "skills/local-implementation/SKILL.md",
  ]);
  assert.equal(result.canonicalStateSummary.target.kind, "local_branch");
  assert.equal(result.canonicalStateSummary.routeKind, "route");
});

test("buildResolveDevLoopStartupResult maps linked Copilot follow-up to the PR follow-up route pack", () => {
  const result = buildResolveDevLoopStartupResult({
    currentState: {
      target: { kind: "issue", issue: 89, linkedPr: 92 },
      ownership: "copilot",
      nextActor: "copilot",
      status: "active",
      authorization: "needs_confirmation",
    },
    artifactState: "open",
    issueLinkageResolution: "resolved_linked_pr",
    loopState: "unresolved_feedback_present",
  }, { env: { PI_ASYNC_START_BYPASS: "1" } });

  assert.equal(result.bundleKind, "resolved");
  assert.equal(result.selectedStrategy, "copilot_pr_followup");
  assert.deepEqual(result.requiredReads, [
    "skills/docs/public-dev-loop-contract.md",
    "skills/docs/retrospective-checkpoint-contract.md",
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
  ]);
  assert.equal(result.canonicalStateSummary.target.kind, "pr");
  assert.equal(result.canonicalStateSummary.target.pr, 92);
});

test("buildResolveDevLoopStartupResult returns reconcile reads when authoritative issue linkage is missing", () => {
  const result = buildResolveDevLoopStartupResult({
    currentState: {
      target: { kind: "issue", issue: 93 },
      ownership: "copilot",
      nextActor: "user",
      status: "active",
      authorization: "needs_confirmation",
    },
    artifactState: "not_applicable",
    loopState: "active",
  });

  assert.equal(result.bundleKind, "needs_reconcile");
  assert.equal(result.selectedStrategy, "none");
  assert.deepEqual(result.requiredReads, ["skills/docs/public-dev-loop-contract.md"]);
  assert.match(result.nextAction, /reconcile/i);
  assert.equal(result.canonicalStateSummary.loopState, "unknown");
});

test("summarizeCanonicalState keeps the public status summary fields stable", () => {
  const summary = summarizeCanonicalState({
    canonicalState: {
      target: { kind: "pr", issue: 12, pr: 34 },
      ownership: "copilot",
      nextActor: "user",
      status: "active",
      authorization: "needs_confirmation",
    },
    artifactState: "open",
    issueLinkageResolution: "not_applicable",
    loopState: "waiting_for_human_pr_approval",
    routeKind: "route",
    selectedGate: "final_approval",
    executionMode: "bounded_handoff",
    waitSemantics: "default",
  });

  assert.deepEqual(summary, {
    target: { kind: "pr", issue: 12, pr: 34 },
    ownership: "copilot",
    nextActor: "user",
    status: "active",
    authorization: "needs_confirmation",
    artifactState: "open",
    issueLinkageResolution: "not_applicable",
    loopState: "waiting_for_human_pr_approval",
    routeKind: "route",
    selectedGate: "final_approval",
    executionMode: "bounded_handoff",
    waitSemantics: "default",
    requiresAsyncDispatch: false,
  });
});

test("resolve-dev-loop-startup CLI emits stable JSON for a final-approval route", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "resolve-dev-loop-startup-"));
  try {
    const inputPath = await writeTempJson(tempDir, "startup.json", {
      currentState: {
        target: { kind: "pr", issue: 89, pr: 92 },
        ownership: "copilot",
        nextActor: "user",
        status: "approval_ready",
        authorization: "needs_confirmation",
      },
      artifactState: "open",
      issueLinkageResolution: "not_applicable",
      gateReviewEvidence: {
        currentHeadSha: "abc1234",
        preApprovalGate: {
          visible: true,
          headSha: "abc1234",
          verdict: "clean",
        },
      },
      loopState: "waiting_for_human_pr_approval",
    });

    const result = await runNode(["--input", inputPath]);
    assert.equal(result.code, 0, `expected exit 0, got: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.bundleKind, "resolved");
    assert.equal(parsed.selectedStrategy, "final_approval");
    assert.deepEqual(parsed.requiredReads, [
      "skills/docs/public-dev-loop-contract.md",
      "skills/docs/retrospective-checkpoint-contract.md",
      "skills/copilot-pr-followup/SKILL.md",
      "skills/docs/copilot-loop-operations.md",
      "skills/final-approval/SKILL.md",
    ]);
    assert.equal(parsed.canonicalStateSummary.target.kind, "pr");
    assert.equal(parsed.canonicalStateSummary.selectedGate, "final_approval");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildResolveDevLoopStartupResult auto-injects retrospectiveCheckpointState from file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "resolve-dev-loop-startup-"));
  try {
    // Create a .pi/dev-loop-retrospective-checkpoint.json in temp dir
    const piDir = path.join(tempDir, ".pi");
    await mkdir(piDir, { recursive: true });
    await writeFile(
      path.join(piDir, "dev-loop-retrospective-checkpoint.json"),
      JSON.stringify({ state: "complete" }),
      "utf8",
    );

    // Run via CLI with CWD set to temp dir
    const inputPath = await writeTempJson(tempDir, "startup.json", {
      currentState: {
        target: { kind: "local_branch", branch: "feature/local-route" },
        ownership: "local",
        nextActor: "local",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "not_applicable",
      loopState: "active",
    });

    const result = await runNode(["--input", inputPath], { cwd: tempDir });

    assert.equal(result.code, 0, `expected exit 0, got stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.selectedStrategy, "local_implementation");
    // The --input JSON didn't include retrospectiveCheckpointState, but the
    // resolver auto-read it from the checkpoint file — route still passes
    // because state is "complete".
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildResolveDevLoopStartupResult passes through when no checkpoint file exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "resolve-dev-loop-startup-"));
  try {
    const inputPath = await writeTempJson(tempDir, "startup.json", {
      currentState: {
        target: { kind: "local_branch", branch: "feature/local-route" },
        ownership: "local",
        nextActor: "local",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "not_applicable",
      loopState: "active",
    });

    const result = await runNode(["--input", inputPath], { cwd: tempDir });

    assert.equal(result.code, 0, `expected exit 0, got stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.selectedStrategy, "local_implementation");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildResolveDevLoopStartupResult rejects async-required strategy without PI_SUBAGENT_RUN_ID", () => {
  const result = buildResolveDevLoopStartupResult(
    {
      currentState: {
        target: { kind: "issue", issue: 89, linkedPr: 92 },
        ownership: "copilot",
        nextActor: "copilot",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "open",
      issueLinkageResolution: "resolved_linked_pr",
      loopState: "unresolved_feedback_present",
    },
    { env: {} },
  );

  assert.equal(result.ok, false);
  assert.equal(result.asyncStartContract, "rejected");
  assert.ok(result.error.includes("Pi-managed async context"));
});

test("buildResolveDevLoopStartupResult allows async-required strategy with PI_SUBAGENT_RUN_ID", () => {
  const result = buildResolveDevLoopStartupResult(
    {
      currentState: {
        target: { kind: "issue", issue: 89, linkedPr: 92 },
        ownership: "copilot",
        nextActor: "copilot",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "open",
      issueLinkageResolution: "resolved_linked_pr",
      loopState: "unresolved_feedback_present",
    },
    { env: { PI_SUBAGENT_RUN_ID: "test-run-123" } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.selectedStrategy, "copilot_pr_followup");
});

test("buildResolveDevLoopStartupResult allows async-required strategy with PI_ASYNC_START_BYPASS=1", () => {
  const result = buildResolveDevLoopStartupResult(
    {
      currentState: {
        target: { kind: "issue", issue: 89, linkedPr: 92 },
        ownership: "copilot",
        nextActor: "copilot",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "open",
      issueLinkageResolution: "resolved_linked_pr",
      loopState: "unresolved_feedback_present",
    },
    { env: { PI_ASYNC_START_BYPASS: "1" } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.selectedStrategy, "copilot_pr_followup");
});

test("buildResolveDevLoopStartupResult does not enforce async-start on local_implementation", () => {
  const result = buildResolveDevLoopStartupResult(
    {
      currentState: {
        target: { kind: "local_branch", branch: "feature/local-route" },
        ownership: "local",
        nextActor: "local",
        status: "active",
        authorization: "needs_confirmation",
      },
      artifactState: "not_applicable",
      loopState: "active",
    },
    { env: {} },
  );

  assert.equal(result.ok, true);
  assert.equal(result.selectedStrategy, "local_implementation");
});

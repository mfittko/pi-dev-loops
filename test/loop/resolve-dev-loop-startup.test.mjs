import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildResolveDevLoopStartupResult,
  parseResolveDevLoopStartupCliArgs,
  summarizeCanonicalState,
} from "../../scripts/loop/resolve-dev-loop-startup.mjs";

const scriptPath = path.resolve("scripts/loop/resolve-dev-loop-startup.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
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
  });

  assert.equal(result.bundleKind, "resolved");
  assert.equal(result.selectedStrategy, "copilot_pr_followup");
  assert.equal(result.requiredReads.at(-1), "skills/copilot-pr-followup/SKILL.md");
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
      "skills/final-approval/SKILL.md",
      "skills/copilot-pr-followup/SKILL.md",
    ]);
    assert.equal(parsed.canonicalStateSummary.target.kind, "pr");
    assert.equal(parsed.canonicalStateSummary.selectedGate, "final_approval");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

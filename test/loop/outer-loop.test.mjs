import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { decideOuterAction } from "../../scripts/loop/outer-loop.mjs";

const scriptPath = path.resolve("scripts/loop/outer-loop.mjs");

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

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * Write a fake `git` stub that responds to specific commands.
 * porcelainOutput: what `git status --porcelain` should return (empty string = clean)
 * headRef: what `git rev-parse --abbrev-ref HEAD` should return (e.g. "main" or "HEAD")
 */
async function writeGitStub(tempDir, { porcelainOutput = "", headRef = "main" } = {}) {
  const gitPath = path.join(tempDir, "git");
  await writeFile(
    gitPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2).join(' ');",
      `if (args.includes('status') && args.includes('porcelain')) {`,
      `  process.stdout.write(${JSON.stringify(porcelainOutput ? porcelainOutput + "\n" : "")});`,
      `  process.exit(0);`,
      `}`,
      `if (args.includes('rev-parse') && args.includes('abbrev-ref')) {`,
      `  process.stdout.write(${JSON.stringify(headRef + "\n")});`,
      `  process.exit(0);`,
      `}`,
      `process.exit(0);`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(gitPath, 0o755);

  return {
    ...process.env,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
  };
}

// ---------------------------------------------------------------------------
// Unit tests for decideOuterAction (pure function, no I/O)
// ---------------------------------------------------------------------------

test("decideOuterAction: copilot done → done", () => {
  const result = decideOuterAction({
    copilotState: "done",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "done");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: copilot no_pr → stop / pr_not_ready", () => {
  const result = decideOuterAction({
    copilotState: "no_pr",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "pr_not_ready");
});

test("decideOuterAction: copilot pr_draft → stop / pr_not_ready", () => {
  const result = decideOuterAction({
    copilotState: "pr_draft",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "pr_not_ready");
});

test("decideOuterAction: copilot waiting_for_copilot_review → continue_wait", () => {
  const result = decideOuterAction({
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "continue_wait");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: reviewer waiting_for_author_followup → continue_wait", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "waiting_for_author_followup",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "continue_wait");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: reviewer waiting_for_re_request → continue_wait", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "waiting_for_re_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "continue_wait");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: copilot waiting_for_ci → continue_wait", () => {
  const result = decideOuterAction({
    copilotState: "waiting_for_ci",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "continue_wait");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: reviewer review_requested → reenter_reviewer_loop", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "review_requested",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_reviewer_loop");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: reviewer review_invalidated → reenter_reviewer_loop", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "review_invalidated",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_reviewer_loop");
});

test("decideOuterAction: copilot unresolved_feedback_present → reenter_copilot_loop", () => {
  const result = decideOuterAction({
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_copilot_loop");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: copilot ready_to_rerequest_review → reenter_copilot_loop", () => {
  const result = decideOuterAction({
    copilotState: "ready_to_rerequest_review",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_copilot_loop");
});

test("decideOuterAction: copilot blocked_needs_user_decision → stop / copilot_blocked", () => {
  const result = decideOuterAction({
    copilotState: "blocked_needs_user_decision",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "copilot_blocked");
});

test("decideOuterAction: reviewer blocked_needs_user_decision → stop / reviewer_blocked", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "blocked_needs_user_decision",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "reviewer_blocked");
});

test("decideOuterAction: copilot review_request_unavailable → stop / review_unavailable", () => {
  const result = decideOuterAction({
    copilotState: "review_request_unavailable",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "review_unavailable");
});

test("decideOuterAction: dirty checkout + unresolved_feedback → unsafe_local_edit_requires_isolation", () => {
  const result = decideOuterAction({
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
    gitStatus: { isDirty: true, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "unsafe_local_edit_requires_isolation");
});

test("decideOuterAction: detached HEAD + unresolved_feedback → unsafe_local_edit_requires_isolation", () => {
  const result = decideOuterAction({
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: false, isDetached: true },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "unsafe_local_edit_requires_isolation");
});

test("decideOuterAction: dirty checkout + reviewer review_requested → unsafe_local_edit_requires_isolation", () => {
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "review_requested",
    gitStatus: { isDirty: true, isDetached: false },
  });
  assert.equal(result.outerAction, "stop");
  assert.equal(result.reason, "unsafe_local_edit_requires_isolation");
});

test("decideOuterAction: dirty checkout + reviewer waiting_for_user_submit → reenter_reviewer_loop (no local exec needed)", () => {
  // waiting_for_user_submit does not need local execution, so dirty checkout is safe
  const result = decideOuterAction({
    copilotState: "pr_ready_no_feedback",
    reviewerState: "waiting_for_user_submit",
    gitStatus: { isDirty: true, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_reviewer_loop");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: dirty checkout + copilot already_fixed_needs_reply_resolve → reenter_copilot_loop (no local edit needed)", () => {
  // already_fixed_needs_reply_resolve only needs GitHub API calls, not code edits
  const result = decideOuterAction({
    copilotState: "already_fixed_needs_reply_resolve",
    reviewerState: "waiting_for_review_request",
    gitStatus: { isDirty: true, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_copilot_loop");
  assert.equal(result.reason, undefined);
});

test("decideOuterAction: reviewer active wins over copilot wait state", () => {
  // Even if copilot is waiting, reviewer needs action → reenter_reviewer_loop
  const result = decideOuterAction({
    copilotState: "waiting_for_copilot_review",
    reviewerState: "review_requested",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_reviewer_loop");
});

test("decideOuterAction: copilot active wins over reviewer wait state", () => {
  // Reviewer is waiting_for_author_followup, but copilot needs fix work
  const result = decideOuterAction({
    copilotState: "unresolved_feedback_present",
    reviewerState: "waiting_for_author_followup",
    gitStatus: { isDirty: false, isDetached: false },
  });
  assert.equal(result.outerAction, "reenter_copilot_loop");
});

// ---------------------------------------------------------------------------
// CLI integration tests
// ---------------------------------------------------------------------------

test("outer-loop --help prints usage and exits 0", async () => {
  const helpLong = await runNode(["--help"]);
  assert.equal(helpLong.code, 0);
  assert.equal(helpLong.stderr, "");
  assert(helpLong.stdout.includes("outer-loop.mjs"), `expected script name in help, got: ${helpLong.stdout}`);
  assert(helpLong.stdout.includes("--repo"), "expected --repo in help");
  assert(helpLong.stdout.includes("--pr"), "expected --pr in help");
  assert(helpLong.stdout.includes("continue_wait"), "expected continue_wait in help");
  assert(helpLong.stdout.includes("reenter_copilot_loop"), "expected reenter_copilot_loop in help");
  assert(helpLong.stdout.includes("reenter_reviewer_loop"), "expected reenter_reviewer_loop in help");

  const helpShort = await runNode(["-h"]);
  assert.equal(helpShort.code, 0);
  assert.equal(helpShort.stdout, helpLong.stdout);
});

test("outer-loop rejects malformed arguments with usage guidance", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.equal(missingPr.stdout, "");
  const err = JSON.parse(missingPr.stderr);
  assert.equal(err.ok, false);
  assert.equal(err.error, "outer-loop requires both --repo <owner/name> and --pr <number>");
  assert.equal(typeof err.usage, "string");
  assert(err.usage.length > 0);

  const noArgs = await runNode([]);
  assert.equal(noArgs.code, 1);
  const noArgsErr = JSON.parse(noArgs.stderr);
  assert.equal(noArgsErr.ok, false);
  assert.equal(typeof noArgsErr.usage, "string");

  const unknown = await runNode(["--repo", "owner/repo", "--pr", "17", "--unexpected"]);
  assert.equal(unknown.code, 1);
  const unknownErr = JSON.parse(unknown.stderr);
  assert.equal(unknownErr.ok, false);
  assert.equal(unknownErr.error, "Unknown argument: --unexpected");
});

// ---------------------------------------------------------------------------
// CLI: copilot wait timeout → re-detect → continue_wait
// ---------------------------------------------------------------------------

test("outer-loop: waiting_for_copilot_review → continue_wait", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-copilot-wait-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stderr, "");

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.copilotState, "waiting_for_copilot_review");
    assert.equal(output.reason, undefined);
    assert.ok(output.checkpoint, "expected checkpoint in output");
    assert.equal(output.checkpoint.outerAction, "continue_wait");
    assert.equal(output.checkpoint.pr, 47);
    assert.equal(output.checkpoint.repo, "owner/repo");
    assert.equal(output.checkpoint.waitCycles, 1);
    assert.ok(typeof output.checkpoint.timestamp === "string");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: reviewer waiting_for_author_followup → continue_wait
// ---------------------------------------------------------------------------

test("outer-loop: reviewer waiting_for_author_followup → continue_wait", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-reviewer-followup-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    // Copilot is at pr_ready_no_feedback (no review yet, no unresolved threads)
    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    // Reviewer submitted review on head commit (waiting for author followup)
    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.reviewerState, "waiting_for_author_followup");
    assert.equal(output.checkpoint.waitCycles, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: reviewer waiting_for_re_request → continue_wait (same remediation family)
// ---------------------------------------------------------------------------

test("outer-loop: reviewer waiting_for_re_request → continue_wait", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-reviewer-rerequest-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    // Author pushed a new commit since review submission → waiting_for_re_request
    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "def456",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
      reviewRequested: false,
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.reviewerState, "waiting_for_re_request");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: author/Copilot follow-up received → reviewer re-entry
// ---------------------------------------------------------------------------

test("outer-loop: waiting_for_re_request → review_requested after re-detect → reenter_reviewer_loop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-reviewer-reentry-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    // Reviewer was re-requested after author pushed → review_requested
    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "def456",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
      reviewRequested: true,
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "reenter_reviewer_loop");
    assert.equal(output.reviewerState, "review_requested");
    assert.equal(output.checkpoint.waitCycles, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: dirty/detached checkout + mutation-needed → unsafe_local_edit_requires_isolation
// ---------------------------------------------------------------------------

test("outer-loop: dirty checkout + unresolved_feedback → stop / unsafe_local_edit_requires_isolation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-dirty-copilot-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: true,
      unresolvedThreadCount: 2,
      actionableThreadCount: 2,
      ciStatus: "success",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
    });

    // Dirty checkout (modified files)
    const env = await writeGitStub(tempDir, {
      porcelainOutput: " M src/foo.ts\n M src/bar.ts",
      headRef: "main",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "stop");
    assert.equal(output.reason, "unsafe_local_edit_requires_isolation");
    assert.equal(output.copilotState, "unresolved_feedback_present");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("outer-loop: detached HEAD + reviewer review_requested → stop / unsafe_local_edit_requires_isolation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-detached-reviewer-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
      reviewRequested: true,
    });

    // Detached HEAD
    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "HEAD" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "stop");
    assert.equal(output.reason, "unsafe_local_edit_requires_isolation");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: false-positive prevention — wait wakeup with no state change → still continue_wait
// ---------------------------------------------------------------------------

test("outer-loop: wait cycles accumulate correctly across multiple re-detect runs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-wait-cycles-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const baseArgs = [
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ];

    // First run: waitCycles should be 1
    const run1 = await runNode(baseArgs, { env });
    assert.equal(run1.code, 0);
    const out1 = JSON.parse(run1.stdout);
    assert.equal(out1.outerAction, "continue_wait");
    assert.equal(out1.checkpoint.waitCycles, 1);

    // Second run (same state, state still unchanged): waitCycles should be 2
    const run2 = await runNode(baseArgs, { env });
    assert.equal(run2.code, 0);
    const out2 = JSON.parse(run2.stdout);
    assert.equal(out2.outerAction, "continue_wait");
    assert.equal(out2.checkpoint.waitCycles, 2);

    // Third run (still same): waitCycles should be 3
    const run3 = await runNode(baseArgs, { env });
    assert.equal(run3.code, 0);
    const out3 = JSON.parse(run3.stdout);
    assert.equal(out3.outerAction, "continue_wait");
    assert.equal(out3.checkpoint.waitCycles, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("outer-loop: wait cycles reset to 0 when outer action changes from continue_wait to reenter_copilot_loop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-wait-reset-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    // First run: copilot waiting → waitCycles = 1
    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });
    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
    });

    const run1 = await runNode([
      "--repo", "owner/repo", "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });
    assert.equal(JSON.parse(run1.stdout).checkpoint.waitCycles, 1);

    // Second run: copilot has review, unresolved threads → reenter_copilot_loop; waitCycles resets to 0
    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: true,
      unresolvedThreadCount: 1,
      actionableThreadCount: 1,
      ciStatus: "success",
    });

    const run2 = await runNode([
      "--repo", "owner/repo", "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });
    assert.equal(run2.code, 0);
    const out2 = JSON.parse(run2.stdout);
    assert.equal(out2.outerAction, "reenter_copilot_loop");
    assert.equal(out2.checkpoint.waitCycles, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: terminal blocked / final gate precedence
// ---------------------------------------------------------------------------

test("outer-loop: PR merged → done (terminal state, takes precedence)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-merged-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prMerged: true,
      prClosed: false,
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prMerged: true,
      prHeadSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "done");
    assert.equal(output.copilotState, "done");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("outer-loop: copilot blocked_needs_user_decision → stop / copilot_blocked (beats any wait state)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-copilot-blocked-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");

    // CI failure maps to blocked_needs_user_decision in copilot state
    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "none",
      copilotReviewPresent: true,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "failure",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", tempDir,
    ], { env });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.outerAction, "stop");
    assert.equal(output.reason, "copilot_blocked");
    assert.equal(output.copilotState, "blocked_needs_user_decision");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI: checkpoint is persisted to disk
// ---------------------------------------------------------------------------

test("outer-loop: checkpoint file is created at default location under --checkpoint-dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-outer-checkpoint-"));

  try {
    const copilotSnapshotPath = path.join(tempDir, "copilot-snapshot.json");
    const reviewerSnapshotPath = path.join(tempDir, "reviewer-snapshot.json");
    const checkpointDir = path.join(tempDir, "checkpoint");

    await writeJson(copilotSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
    });

    await writeJson(reviewerSnapshotPath, {
      prExists: true,
      prNumber: 47,
      prHeadSha: "abc123",
    });

    const env = await writeGitStub(tempDir, { porcelainOutput: "", headRef: "main" });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "47",
      "--copilot-input", copilotSnapshotPath,
      "--reviewer-input", reviewerSnapshotPath,
      "--checkpoint-dir", checkpointDir,
    ], { env });

    assert.equal(result.code, 0);

    const { readFile: rf } = await import("node:fs/promises");
    const checkpointText = await rf(path.join(checkpointDir, "outer-loop-state.json"), "utf8");
    const checkpoint = JSON.parse(checkpointText);

    assert.equal(checkpoint.pr, 47);
    assert.equal(checkpoint.repo, "owner/repo");
    assert.equal(checkpoint.outerAction, "continue_wait");
    assert.equal(checkpoint.copilotState, "waiting_for_copilot_review");
    assert.equal(checkpoint.waitCycles, 1);
    assert.ok(typeof checkpoint.timestamp === "string");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

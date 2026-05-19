import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseSubmitCliArgs,
  parseStatusCliArgs,
  runSubmit,
  runStatus,
} from "../../scripts/loop/steer-loop.mjs";

import { STEERING_KIND, STEERING_RESULT } from "../../packages/core/src/loop/steering.mjs";

const scriptPath = path.resolve("scripts/loop/steer-loop.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runNode(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

function makeStdout() {
  let written = "";
  const stream = {
    write(chunk) {
      written += String(chunk);
    },
  };
  const read = () => JSON.parse(written);
  return { stream, read };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-steer-loop-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// parseSubmitCliArgs
// ---------------------------------------------------------------------------

test("parseSubmitCliArgs parses all required flags", () => {
  const opts = parseSubmitCliArgs([
    "--run-id", "run-1",
    "--kind", "hard_constraint",
    "--directive", "No new deps",
    "--seq", "1",
  ]);
  assert.equal(opts.runId, "run-1");
  assert.equal(opts.kind, "hard_constraint");
  assert.equal(opts.directive, "No new deps");
  assert.equal(opts.seq, 1);
  assert.equal(opts.applyMode, "immediate");
  assert.equal(opts.loopState, "ready_to_rerequest_review");
});

test("parseSubmitCliArgs parses optional flags", () => {
  const opts = parseSubmitCliArgs([
    "--run-id", "run-1",
    "--kind", "preference",
    "--directive", "Prefer TS",
    "--seq", "2",
    "--loop-state", "waiting_for_ci",
    "--apply-mode", "next_safe_point",
    "--event-id", "evt-custom",
    "--state-file", "/tmp/state.json",
  ]);
  assert.equal(opts.loopState, "waiting_for_ci");
  assert.equal(opts.applyMode, "next_safe_point");
  assert.equal(opts.eventId, "evt-custom");
  assert.equal(opts.stateFile, "/tmp/state.json");
});


test("parseSubmitCliArgs allows directive values that begin with double dashes", () => {
  const opts = parseSubmitCliArgs([
    "--run-id", "run-1",
    "--kind", "hard_constraint",
    "--directive", "--foo must not appear in code",
    "--seq", "2",
  ]);
  assert.equal(opts.directive, "--foo must not appear in code");
});

test("parseSubmitCliArgs throws on missing --run-id", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--kind", "preference", "--directive", "x", "--seq", "1"]),
    /--run-id is required/,
  );
});

test("parseSubmitCliArgs throws on missing --kind", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--directive", "x", "--seq", "1"]),
    /--kind is required/,
  );
});

test("parseSubmitCliArgs throws on invalid --kind", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "bogus", "--directive", "x", "--seq", "1"]),
    /--kind must be one of/,
  );
});


test("parseSubmitCliArgs throws on unsafe --run-id", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "../bad", "--kind", "preference", "--directive", "x", "--seq", "1"]),
    /--run-id must contain only/,
  );
});

test("parseSubmitCliArgs throws on missing --directive", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "preference", "--seq", "1"]),
    /--directive is required/,
  );
});

test("parseSubmitCliArgs throws on missing --seq", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "preference", "--directive", "x"]),
    /--seq is required/,
  );
});

test("parseSubmitCliArgs throws on non-positive --seq", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "preference", "--directive", "x", "--seq", "0"]),
    /positive integer/,
  );
});

test("parseSubmitCliArgs throws on unknown argument", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--unknown-flag"]),
    /Unknown argument/,
  );
});

test("parseSubmitCliArgs throws on invalid --apply-mode", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "preference", "--directive", "x", "--seq", "1", "--apply-mode", "bogus"]),
    /--apply-mode must be one of/,
  );
});


test("parseSubmitCliArgs throws on invalid --loop-state", () => {
  assert.throws(
    () => parseSubmitCliArgs(["--run-id", "r", "--kind", "preference", "--directive", "x", "--seq", "1", "--loop-state", "waiting_for_review"]),
    /--loop-state must be one of/,
  );
});

test("parseSubmitCliArgs sets help flag on --help", () => {
  const opts = parseSubmitCliArgs(["--help"]);
  assert.equal(opts.help, true);
});

// ---------------------------------------------------------------------------
// parseStatusCliArgs
// ---------------------------------------------------------------------------

test("parseStatusCliArgs parses --run-id", () => {
  const opts = parseStatusCliArgs(["--run-id", "run-xyz"]);
  assert.equal(opts.runId, "run-xyz");
});

test("parseStatusCliArgs throws on missing --run-id", () => {
  assert.throws(() => parseStatusCliArgs([]), /--run-id is required/);
});

test("parseStatusCliArgs accepts --state-file", () => {
  const opts = parseStatusCliArgs(["--run-id", "r", "--state-file", "/tmp/s.json"]);
  assert.equal(opts.stateFile, "/tmp/s.json");
});


test("parseStatusCliArgs throws on unsafe --run-id", () => {
  assert.throws(() => parseStatusCliArgs(["--run-id", "../../bad"]), /--run-id must contain only/);
});

test("parseStatusCliArgs throws on unknown argument", () => {
  assert.throws(() => parseStatusCliArgs(["--unknown"]), /Unknown argument/);
});

// ---------------------------------------------------------------------------
// runSubmit — immediate application
// ---------------------------------------------------------------------------

test("runSubmit applies steering immediately at a safe loop state", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-1",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "ready_to_rerequest_review",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.ok, true);
    assert.equal(output.result.result, STEERING_RESULT.APPLIED_NOW);
    assert.equal(output.steeringState.effectiveStack.length, 1);
    assert.equal(output.steeringState.events.length, 1);

    // Verify persistence
    const savedRaw = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(savedRaw.effectiveStack.length, 1);
    assert.equal(savedRaw.nextSeq, 2);
  });
});

test("runSubmit applies preference at waiting_for_copilot_review", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-2",
      "--kind", "preference",
      "--directive", "Prefer TypeScript",
      "--seq", "1",
      "--loop-state", "waiting_for_copilot_review",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.APPLIED_NOW);
  });
});

test("runSubmit applies stop_at_next_safe_gate at a safe point", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-3",
      "--kind", "stop_at_next_safe_gate",
      "--directive", "Stop before next review cycle",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.APPLIED_NOW);
    assert.equal(output.steeringState.effectiveStack[0].kind, STEERING_KIND.STOP_AT_NEXT_SAFE_GATE);
  });
});

test("runSubmit operator mode returns a queued acknowledgement envelope from inspected state", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");
    const copilotPath = path.join(dir, "copilot.json");
    const reviewerPath = path.join(dir, "reviewer.json");
    const { stream, read } = makeStdout();

    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      prDraft: true,
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true,
      prNumber: 55,
      prHeadSha: "abc123",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    await runSubmit([
      "--repo", "owner/repo",
      "--pr", "55",
      "--kind", "stop_at_next_safe_gate",
      "--directive", "Stop before the next safe gate",
      "--seq", "1",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
      "--state-file", stateFile,
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.ok, true);
    assert.equal(output.acknowledgement.runId, "pr-55");
    assert.equal(output.acknowledgement.disposition, "queued_for_safe_point");
    assert.equal(output.acknowledgement.resultCode, STEERING_RESULT.QUEUED_FOR_SAFE_POINT);
    assert.equal(output.acknowledgement.inspectedState, "pr_draft");
    assert.equal(output.acknowledgement.safePointCategory, "next_point");
    assert.equal(output.acknowledgement.effectiveNow, false);
    assert.match(output.acknowledgement.readbackPath.inspection, /inspect-run --repo owner\/repo --pr 55/);
    assert.match(output.acknowledgement.readbackPath.steeringStatus, /steer-loop\.mjs status --run-id "pr-55"/);
    assert.equal(output.steeringState.queuedEvents.length, 1);
  });
});

test("runSubmit operator mode rejects non-stop directives", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");
    const copilotPath = path.join(dir, "copilot.json");
    const reviewerPath = path.join(dir, "reviewer.json");
    const { stream, read } = makeStdout();

    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true,
      prNumber: 55,
      prHeadSha: "abc123",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    await runSubmit([
      "--repo", "owner/repo",
      "--pr", "55",
      "--kind", "preference",
      "--directive", "Prefer TypeScript",
      "--seq", "1",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
      "--state-file", stateFile,
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.ok, true);
    assert.equal(output.acknowledgement.disposition, "rejected");
    assert.equal(output.acknowledgement.resultCode, STEERING_RESULT.REJECTED_INVALID_OR_CONFLICTING);
    assert.match(output.acknowledgement.reason, /only stop_at_next_safe_gate/i);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — queued for safe point
// ---------------------------------------------------------------------------

test("runSubmit queues steering when loop is in unresolved_feedback_present", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-4",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "unresolved_feedback_present",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.QUEUED_FOR_SAFE_POINT);
    assert.equal(output.steeringState.queuedEvents.length, 1);
    assert.equal(output.steeringState.effectiveStack.length, 0);
  });
});

test("runSubmit queues steering when applyMode is next_safe_point even at safe point", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-5",
      "--kind", "clarification",
      "--directive", "Clarify scope",
      "--seq", "1",
      "--loop-state", "ready_to_rerequest_review",
      "--apply-mode", "next_safe_point",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.QUEUED_FOR_SAFE_POINT);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — unsafe rejection
// ---------------------------------------------------------------------------

test("runSubmit rejects steering when loop is done", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-6",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "done",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.REJECTED_UNSAFE_NOW);
  });
});

test("runSubmit routes blocked_needs_user_decision to needs_human_decision", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "run-7",
      "--kind", "preference",
      "--directive", "Prefer X",
      "--seq", "1",
      "--loop-state", "blocked_needs_user_decision",
      "--state-file", path.join(dir, "state.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.result.result, STEERING_RESULT.NEEDS_HUMAN_DECISION);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — conflicting/invalid steering
// ---------------------------------------------------------------------------

test("runSubmit rejects duplicate hard_constraint directives", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Submit first event
    const { stream: s1, read: r1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-8",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "ready_to_rerequest_review",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });
    assert.equal(r1().result.result, STEERING_RESULT.APPLIED_NOW);

    // Submit duplicate
    const { stream: s2, read: r2 } = makeStdout();
    await runSubmit([
      "--run-id", "run-8",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "2",
      "--loop-state", "ready_to_rerequest_review",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.result.result, STEERING_RESULT.REJECTED_INVALID_OR_CONFLICTING);
    assert.match(output.result.reason, /[Dd]uplicate/);
  });
});

test("runSubmit rejects out-of-order seq", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Submit seq=5 first
    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-9",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "5",
      "--loop-state", "waiting_for_copilot_review",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    // Now try seq=3 (out of order)
    const { stream: s2, read: r2 } = makeStdout();
    await runSubmit([
      "--run-id", "run-9",
      "--kind", "clarification",
      "--directive", "Some clarification",
      "--seq", "3",
      "--loop-state", "waiting_for_copilot_review",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.result.result, STEERING_RESULT.REJECTED_INVALID_OR_CONFLICTING);
    assert.match(output.result.reason, /out of order/);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — durable state persistence and reload
// ---------------------------------------------------------------------------

test("runSubmit persists state that survives reload across calls", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Submit seq=1
    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-10",
      "--kind", "hard_constraint",
      "--directive", "Constraint A",
      "--seq", "1",
      "--loop-state", "ready_to_rerequest_review",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    // Submit seq=2 — state loaded from disk
    const { stream: s2, read: r2 } = makeStdout();
    await runSubmit([
      "--run-id", "run-10",
      "--kind", "hard_constraint",
      "--directive", "Constraint B",
      "--seq", "2",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.result.result, STEERING_RESULT.APPLIED_NOW);
    assert.equal(output.steeringState.effectiveStack.length, 2);
    assert.equal(output.steeringState.nextSeq, 3);

    // Verify both are persisted
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(saved.events.length, 2);
    assert.equal(saved.effectiveStack.length, 2);
  });
});


test("runSubmit creates the default steering directory before acquiring the lock", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runSubmit([
      "--run-id", "default-path-run",
      "--kind", "hard_constraint",
      "--directive", "Constraint A",
      "--seq", "1",
      "--loop-state", "ready_to_rerequest_review",
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.ok, true);

    const defaultStatePath = path.join(dir, ".pi", "steering", "default-path-run.json");
    const saved = JSON.parse(await readFile(defaultStatePath, "utf8"));
    assert.equal(saved.events.length, 1);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — run-id / state-file mismatch
// ---------------------------------------------------------------------------

test("runSubmit rejects when --state-file contains a different run-id than --run-id", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Seed the file with run-A
    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-A",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    // Attempt to submit as run-B against the same file
    await assert.rejects(
      () => runSubmit([
        "--run-id", "run-B",
        "--kind", "preference",
        "--directive", "Prefer Go",
        "--seq", "1",
        "--loop-state", "waiting_for_ci",
        "--state-file", stateFile,
      ], { stdout: { write() {} }, cwd: dir }),
      /run-id mismatch/,
    );
  });
});

// ---------------------------------------------------------------------------
// runStatus
// ---------------------------------------------------------------------------

test("runStatus returns empty status when no state file exists", async () => {
  await withTempDir(async (dir) => {
    const { stream, read } = makeStdout();

    await runStatus([
      "--run-id", "run-status-1",
      "--state-file", path.join(dir, "nonexistent.json"),
    ], { stdout: stream, cwd: dir });

    const output = read();
    assert.equal(output.ok, true);
    assert.equal(output.status.runId, "run-status-1");
    assert.equal(output.status.eventCount, 0);
    assert.equal(output.status.effectiveStackCount, 0);
    assert.equal(output.status.queuedCount, 0);
    assert.equal(output.status.latestResult, null);
  });
});

test("runStatus shows current steering status after submissions", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Submit an event
    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-status-2",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "waiting_for_copilot_review",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    // Check status
    const { stream: s2, read: r2 } = makeStdout();
    await runStatus([
      "--run-id", "run-status-2",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.ok, true);
    assert.equal(output.status.eventCount, 1);
    assert.equal(output.status.effectiveStackCount, 1);
    assert.equal(output.status.queuedCount, 0);
    assert.equal(output.status.latestResult.result, STEERING_RESULT.APPLIED_NOW);
    assert.equal(output.status.effectiveConstraints.hardConstraints[0], "No new deps");
  });
});

test("runStatus shows queued events before they are promoted", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-status-3",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "1",
      "--loop-state", "unresolved_feedback_present",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    const { stream: s2, read: r2 } = makeStdout();
    await runStatus([
      "--run-id", "run-status-3",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.status.queuedCount, 1);
    assert.equal(output.status.effectiveStackCount, 0);
    assert.equal(output.status.latestResult.result, STEERING_RESULT.QUEUED_FOR_SAFE_POINT);
  });
});

test("runStatus shows stop_at_next_safe_gate in effective constraints", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-status-4",
      "--kind", "stop_at_next_safe_gate",
      "--directive", "Stop before next review pass",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    const { stream: s2, read: r2 } = makeStdout();
    await runStatus([
      "--run-id", "run-status-4",
      "--state-file", stateFile,
    ], { stdout: s2, cwd: dir });

    const output = r2();
    assert.equal(output.status.effectiveConstraints.stopAtNextSafeGate, true);
  });
});

test("runStatus rejects when --state-file contains a different run-id than --run-id", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "state.json");

    // Seed the file with run-status-A
    const { stream: s1 } = makeStdout();
    await runSubmit([
      "--run-id", "run-status-A",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ], { stdout: s1, cwd: dir });

    // Attempt to inspect as run-status-B against the same file
    await assert.rejects(
      () => runStatus([
        "--run-id", "run-status-B",
        "--state-file", stateFile,
      ], { stdout: { write() {} }, cwd: dir }),
      /run-id mismatch/,
    );
  });
});

// ---------------------------------------------------------------------------
// CLI binary — argument errors
// ---------------------------------------------------------------------------

test("steer-loop.mjs exits non-zero on missing subcommand arguments (submit)", async () => {
  const result = await runNode(["submit", "--run-id", "r"]);
  assert.equal(result.code, 1);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert.ok(typeof err.error === "string" && err.error.length > 0);
  assert.ok(typeof err.usage === "string" && err.usage.length > 0);
});

test("steer-loop.mjs exits non-zero on unknown subcommand", async () => {
  const result = await runNode(["bogus-subcommand"]);
  assert.equal(result.code, 1);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
});

test("steer-loop.mjs prints top-level usage for --help", async () => {
  const result = await runNode(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /subcommand/);
});

test("steer-loop.mjs submit --help prints usage", async () => {
  const result = await runNode(["submit", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--kind/);
});

test("steer-loop.mjs status --help prints usage", async () => {
  const result = await runNode(["status", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--run-id/);
});

// ---------------------------------------------------------------------------
// CLI binary — run-id / state-file mismatch
// ---------------------------------------------------------------------------

test("steer-loop.mjs submit exits non-zero on run-id/state-file mismatch", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "mismatch-state.json");

    // Seed with run-X
    const seed = await runNode([
      "submit",
      "--run-id", "run-X",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ]);
    assert.equal(seed.code, 0);

    // Submit as run-Y against the same file
    const mismatch = await runNode([
      "submit",
      "--run-id", "run-Y",
      "--kind", "preference",
      "--directive", "Prefer Go",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ]);
    assert.equal(mismatch.code, 1);
    const err = JSON.parse(mismatch.stderr);
    assert.equal(err.ok, false);
    assert.match(err.error, /run-id mismatch/);
  });
});

test("steer-loop.mjs status exits non-zero on run-id/state-file mismatch", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "mismatch-state.json");

    // Seed with run-X
    const seed = await runNode([
      "submit",
      "--run-id", "run-X",
      "--kind", "preference",
      "--directive", "Prefer TS",
      "--seq", "1",
      "--loop-state", "waiting_for_ci",
      "--state-file", stateFile,
    ]);
    assert.equal(seed.code, 0);

    // Status as run-Y against the same file
    const mismatch = await runNode([
      "status",
      "--run-id", "run-Y",
      "--state-file", stateFile,
    ]);
    assert.equal(mismatch.code, 1);
    const err = JSON.parse(mismatch.stderr);
    assert.equal(err.ok, false);
    assert.match(err.error, /run-id mismatch/);
  });
});

// ---------------------------------------------------------------------------
// CLI binary — end-to-end submit and status
// ---------------------------------------------------------------------------

test("steer-loop.mjs submit + status end-to-end via CLI", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "e2e-state.json");

    const submit = await runNode([
      "submit",
      "--run-id", "e2e-run",
      "--kind", "hard_constraint",
      "--directive", "No new deps",
      "--seq", "1",
      "--loop-state", "pr_ready_no_feedback",
      "--state-file", stateFile,
    ]);

    assert.equal(submit.code, 0);
    const submitOut = JSON.parse(submit.stdout);
    assert.equal(submitOut.ok, true);
    assert.equal(submitOut.result.result, STEERING_RESULT.APPLIED_NOW);

    const status = await runNode([
      "status",
      "--run-id", "e2e-run",
      "--state-file", stateFile,
    ]);

    assert.equal(status.code, 0);
    const statusOut = JSON.parse(status.stdout);
    assert.equal(statusOut.ok, true);
    assert.equal(statusOut.status.eventCount, 1);
    assert.equal(statusOut.status.effectiveStackCount, 1);
    assert.deepEqual(statusOut.status.effectiveConstraints.hardConstraints, ["No new deps"]);
  });
});

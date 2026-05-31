import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/loop/detect-reviewer-loop-state.mjs");

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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeGhStub(tempDir, entries) {
  const ghSequenceFilePath = path.join(tempDir, "gh-sequence.json");
  const ghCallCounterFilePath = path.join(tempDir, "gh-counter.txt");
  const ghStubScriptPath = path.join(tempDir, "gh");

  await writeFile(ghSequenceFilePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await writeFile(ghCallCounterFilePath, "0\n", "utf8");
  await writeFile(
    ghStubScriptPath,
    [
      "#!/usr/bin/env node",
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const sequencePath = process.env.GH_SEQUENCE_PATH;",
      "const counterPath = process.env.GH_COUNTER_PATH;",
      'const entries = JSON.parse(readFileSync(sequencePath, "utf8"));',
      'const current = Number(readFileSync(counterPath, "utf8").trim() || "0");',
      "if (current >= entries.length) {",
      '  process.stderr.write("unexpected gh call beyond scripted sequence\\n");',
      "  process.exit(97);",
      "}",
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      "writeFileSync(counterPath, String(current + 1));",
      "const actual = process.argv.slice(2);",
      "if (entry.assertArgs) {",
      "  for (const expected of entry.assertArgs) {",
      "    if (!actual.includes(expected)) {",
      "      process.stderr.write(`missing expected gh arg: ${expected}\\n`);",
      "      process.exit(98);",
      "    }",
      "  }",
      "}",
      "if (entry.stderr) process.stderr.write(entry.stderr);",
      "if (entry.stdout) process.stdout.write(entry.stdout);",
      "process.exit(entry.exitCode ?? 0);",
    ].join("\n"),
    "utf8",
  );
  await chmod(ghStubScriptPath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      GH_SEQUENCE_PATH: ghSequenceFilePath,
      GH_COUNTER_PATH: ghCallCounterFilePath,
    },
  };
}

test("detect-reviewer-loop-state --input returns correct states for planning/running/merge snapshots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-state-detect-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      reviewRequested: true,
      localPlanningStatus: "determining",
    });

    const planning = await runNode(["--input", snapshotPath]);
    assert.equal(planning.code, 0);
    assert.equal(JSON.parse(planning.stdout).state, "determine_review_plan");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      reviewRequested: true,
      localReviewRunsStatus: "running",
    });
    const running = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(running.stdout).state, "reviews_running");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      reviewRequested: true,
      localReviewRunsStatus: "completed",
    });
    const merge = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(merge.stdout).state, "merge_results");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state --input distinguishes draft lifecycle and invalidation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-draft-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      draftReviewPrepared: true,
    });
    const ready = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(ready.stdout).state, "draft_review_ready");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prHeadSha: "abc",
      draftReviewPosted: true,
      draftReviewCommitSha: "abc",
      draftReviewNotificationStatus: "notified",
    });
    const waitingSubmit = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(waitingSubmit.stdout).state, "waiting_for_user_submit");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prHeadSha: "def",
      draftReviewPosted: true,
      draftReviewCommitSha: "abc",
    });
    const invalid = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(invalid.stdout).state, "review_invalidated");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state --input treats submitted review as handoff and re-request as new pass", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-rerequest-"));

  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prHeadSha: "abc",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc",
    });
    const followup = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(followup.stdout).state, "submitted_review");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prHeadSha: "def",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc",
      reviewRequested: false,
    });
    const waitingRerequest = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(waitingRerequest.stdout).state, "submitted_review");

    await writeJson(snapshotPath, {
      prExists: true,
      prNumber: 17,
      prHeadSha: "def",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc",
      reviewRequested: true,
    });
    const requested = await runNode(["--input", snapshotPath]);
    assert.equal(JSON.parse(requested.stdout).state, "review_requested");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state auto-detect returns review_requested when reviewer is requested", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-requested-"));

  try {
    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({
          isDraft: false,
          state: "OPEN",
          number: 17,
          headRefOid: "abc123",
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"pi-reviewer"}],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/reviews"],
        stdout: "[]\n",
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--reviewer-login",
      "pi-reviewer",
    ], { env });

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "review_requested");
    assert.equal(output.snapshot.reviewRequested, true);
    assert.equal(output.snapshot.reviewerScope, "single_reviewer");
    assert.equal(output.snapshot.reviewerLogin, "pi-reviewer");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state auto-detect returns waiting_for_user_submit for current-head draft review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-draft-"));

  try {
    const localStatePath = path.join(tempDir, "local-state.json");
    await writeJson(localStatePath, { draftReviewNotificationStatus: "notified" });

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: 17, headRefOid: "abc123" }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/reviews"],
        stdout: JSON.stringify([
          {
            id: 100,
            state: "PENDING",
            user: { login: "pi-reviewer" },
            commit_id: "abc123",
            html_url: "https://github.test/review/100",
          },
        ]) + "\n",
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--reviewer-login",
      "pi-reviewer",
      "--local-state",
      localStatePath,
    ], { env });

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "waiting_for_user_submit");
    assert.equal(output.snapshot.draftReviewPosted, true);
    assert.equal(output.snapshot.draftReviewUrl, "https://github.test/review/100");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("detect-reviewer-loop-state auto-detect treats missing local state as empty metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-missing-local-"));

  try {
    const missingLocalStatePath = path.join(tempDir, "missing-state.json");

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: 17, headRefOid: "abc123" }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/reviews"],
        stdout: "[]\n",
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--local-state",
      missingLocalStatePath,
    ], { env });

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "waiting_for_review_request");
    assert.equal(output.snapshot.prExists, true);
    assert.equal(output.snapshot.reviewerScope, "all_reviewers");
    assert.equal(output.snapshot.reviewerLogin, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("detect-reviewer-loop-state auto-detect keeps fresh pending review ahead of historical submitted review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-rereview-draft-"));

  try {
    const localStatePath = path.join(tempDir, "local-state.json");
    await writeJson(localStatePath, { draftReviewNotificationStatus: "notified" });

    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: 17, headRefOid: "newsha" }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/reviews"],
        stdout: JSON.stringify([
          {
            id: 200,
            state: "COMMENTED",
            user: { login: "pi-reviewer" },
            commit_id: "oldsha",
            html_url: "https://github.test/review/200",
          },
          {
            id: 201,
            state: "PENDING",
            user: { login: "pi-reviewer" },
            commit_id: "newsha",
            html_url: "https://github.test/review/201",
          },
        ]) + "\n",
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--reviewer-login",
      "pi-reviewer",
      "--local-state",
      localStatePath,
    ], { env });

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "waiting_for_user_submit");
    assert.equal(output.snapshot.submittedReviewPresent, true);
    assert.equal(output.snapshot.submittedReviewCommitSha, "oldsha");
    assert.equal(output.snapshot.submittedReviewState, "COMMENTED");
    assert.equal(output.snapshot.draftReviewCommitSha, "newsha");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state auto-detect marks stale draft as review_invalidated", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-invalidated-"));

  try {
    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: 17, headRefOid: "newsha" }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/reviews"],
        stdout: JSON.stringify([
          { id: 101, state: "PENDING", user: { login: "pi-reviewer" }, commit_id: "oldsha", html_url: "u" },
        ]) + "\n",
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo", "--pr", "17", "--reviewer-login", "pi-reviewer",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).state, "review_invalidated");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state auto-detect fails when gh stub call budget is exceeded", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reviewer-auto-budget-"));

  try {
    const { env } = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo"],
        stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: 17, headRefOid: "abc" }) + "\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "gh command failed: unexpected gh call beyond scripted sequence",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-reviewer-loop-state rejects malformed arguments deterministically", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.deepEqual(JSON.parse(missingPr.stderr), {
    ok: false,
    error: "Auto-detect mode requires both --repo <owner/name> and --pr <number>",
  });

  const zeroPr = await runNode(["--repo", "owner/repo", "--pr", "0"]);
  assert.equal(zeroPr.code, 1);
  assert.deepEqual(JSON.parse(zeroPr.stderr), {
    ok: false,
    error: "--pr must be a positive integer",
  });

  const mixed = await runNode(["--input", "/tmp/snapshot.json", "--repo", "owner/repo", "--pr", "17"]);
  assert.equal(mixed.code, 1);
  assert.deepEqual(JSON.parse(mixed.stderr), {
    ok: false,
    error: "Choose exactly one input source: --input <path> or --repo/--pr auto-detect",
  });

  const badBool = await runNode(["--repo", "owner/repo", "--pr", "17", "--review-requested", "maybe"]);
  assert.equal(badBool.code, 1);
  assert.deepEqual(JSON.parse(badBool.stderr), {
    ok: false,
    error: "--review-requested must be true or false",
  });

  const blankReviewerLogin = await runNode(["--repo", "owner/repo", "--pr", "17", "--reviewer-login", "   "]);
  assert.equal(blankReviewerLogin.code, 1);
  assert.deepEqual(JSON.parse(blankReviewerLogin.stderr), {
    ok: false,
    error: "--reviewer-login must not be empty",
  });

  const unknown = await runNode(["--repo", "owner/repo", "--pr", "17", "--wat"]);
  assert.equal(unknown.code, 1);
  assert.deepEqual(JSON.parse(unknown.stderr), {
    ok: false,
    error: "Unknown argument: --wat",
  });
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/github/stage-reviewer-draft.mjs");

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
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeGhStub(tempDir, entries) {
  const sequencePath = path.join(tempDir, "gh-sequence.json");
  const counterPath = path.join(tempDir, "gh-counter.txt");
  const ghPath = path.join(tempDir, "gh");
  const ghLogPath = path.join(tempDir, "gh-log.jsonl");

  await writeFile(sequencePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await writeFile(counterPath, "0\n", "utf8");
  await writeFile(ghLogPath, "", "utf8");
  await writeFile(
    ghPath,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
      "const sequencePath = process.env.GH_SEQUENCE_PATH;",
      "const counterPath = process.env.GH_COUNTER_PATH;",
      "const ghLogPath = process.env.GH_LOG_PATH;",
      'const entries = JSON.parse(readFileSync(sequencePath, "utf8"));',
      'const current = Number(readFileSync(counterPath, "utf8").trim() || "0");',
      "if (current >= entries.length) {",
      '  process.stderr.write("unexpected gh call beyond scripted sequence\\n");',
      "  process.exit(97);",
      "}",
      "const actual = process.argv.slice(2);",
      'appendFileSync(ghLogPath, `${JSON.stringify(actual)}\\n`);',
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'let stdin = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (chunk) => { stdin += chunk; });',
      'process.stdin.on("end", () => {',
      '  if (entry.assertArgs) {',
      '    for (const expected of entry.assertArgs) {',
      '      if (!actual.includes(expected)) {',
      '        process.stderr.write(`missing expected gh arg: ${expected}\\n`);',
      '        process.exit(98);',
      '      }',
      '    }',
      '  }',
      '  if (entry.assertStdinIncludes) {',
      '    for (const expected of entry.assertStdinIncludes) {',
      '      if (!stdin.includes(expected)) {',
      '        process.stderr.write(`missing expected stdin text: ${expected}\\n`);',
      '        process.exit(96);',
      '      }',
      '    }',
      '  }',
      '  if (entry.assertStdinExcludes) {',
      '    for (const forbidden of entry.assertStdinExcludes) {',
      '      if (stdin.includes(forbidden)) {',
      '        process.stderr.write(`unexpected stdin text: ${forbidden}\\n`);',
      '        process.exit(95);',
      '      }',
      '    }',
      '  }',
      '  if (entry.stderr) process.stderr.write(entry.stderr);',
      '  if (entry.stdout) process.stdout.write(entry.stdout);',
      '  process.exit(entry.exitCode ?? 0);',
      '});',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(ghPath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      GH_SEQUENCE_PATH: sequencePath,
      GH_COUNTER_PATH: counterPath,
      GH_LOG_PATH: ghLogPath,
    },
    ghLogPath,
  };
}

test("stage-reviewer-draft posts a deterministic pending review and writes local state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-draft-"));

  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    const localStatePath = path.join(tempDir, "local-state.json");

    await writeJson(reviewFile, {
      headSha: "abc123",
      verdict: "REQUEST_CHANGES",
      totalFindings: 2,
      runsMerged: 2,
      inlineComments: [
        { path: "src/app.ts", line: 10, message: "Handle null" },
      ],
      summaryFindings: [
        { message: "Consider the stale draft-review cleanup path", severity: "low" },
      ],
    });

    const gh = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "-X", "POST", "repos/owner/repo/pulls/17/reviews", "--input", "-"],
        assertStdinIncludes: [
          '"commit_id":"abc123"',
          '"path":"src/app.ts"',
          '"line":10',
          '"body":"Handle null"',
          'Reviewer-loop draft verdict: REQUEST_CHANGES',
          'Summary findings:\\n- [low] Consider the stale draft-review cleanup path',
        ],
        assertStdinExcludes: ['"event"'],
        stdout: '{"id":444,"html_url":"https://github.com/owner/repo/pull/17#pullrequestreview-444","state":"PENDING","commit_id":"abc123"}\n',
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
      "--local-state-output",
      localStatePath,
    ], { env: gh.env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      pr: 17,
      reviewId: 444,
      reviewUrl: "https://github.com/owner/repo/pull/17#pullrequestreview-444",
      reviewState: "PENDING",
      commitSha: "abc123",
      localStatePath,
    });

    assert.deepEqual(JSON.parse(await readFile(localStatePath, "utf8")), {
      draftReviewPrepared: true,
      draftReviewPosted: true,
      draftReviewId: 444,
      draftReviewUrl: "https://github.com/owner/repo/pull/17#pullrequestreview-444",
      draftReviewCommitSha: "abc123",
      draftReviewNotificationStatus: "none",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stage-reviewer-draft merges into an existing local state file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-state-merge-"));

  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    const localStatePath = path.join(tempDir, "local-state.json");

    await writeJson(reviewFile, {
      headSha: "abc123",
      verdict: "COMMENT",
      totalFindings: 1,
      runsMerged: 1,
      inlineComments: [],
      summaryFindings: [{ message: "Add reviewer replay docs", severity: "note" }],
    });
    await writeJson(localStatePath, { localPlanningStatus: "complete" });

    const gh = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "-X", "POST", "repos/owner/repo/pulls/17/reviews", "--input", "-"],
        stdout: '{"id":445,"html_url":"https://github.com/owner/repo/pull/17#pullrequestreview-445","state":"PENDING","commit_id":"abc123"}\n',
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
      "--local-state-output",
      localStatePath,
    ], { env: gh.env });

    assert.equal(result.code, 0);

    assert.deepEqual(JSON.parse(await readFile(localStatePath, "utf8")), {
      localPlanningStatus: "complete",
      draftReviewPrepared: true,
      draftReviewPosted: true,
      draftReviewId: 445,
      draftReviewUrl: "https://github.com/owner/repo/pull/17#pullrequestreview-445",
      draftReviewCommitSha: "abc123",
      draftReviewNotificationStatus: "none",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("stage-reviewer-draft reports localStatePath as null when no output path is requested", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-null-local-state-"));

  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    await writeJson(reviewFile, {
      headSha: "abc123",
      verdict: "COMMENT",
      inlineComments: [],
      summaryFindings: [],
    });

    const gh = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "-X", "POST", "repos/owner/repo/pulls/17/reviews", "--input", "-"],
        stdout: '{"id":446,"html_url":"https://github.com/owner/repo/pull/17#pullrequestreview-446","state":"PENDING","commit_id":"abc123"}\n',
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
    ], { env: gh.env });

    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).localStatePath, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stage-reviewer-draft rejects malformed arguments and missing headSha deterministically", async () => {
  const missing = await runNode(["--repo", "owner/repo"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, "");
  assert.deepEqual(JSON.parse(missing.stderr), {
    ok: false,
    error: "Staging a reviewer draft requires --repo <owner/name>, --pr <number>, and --review-file <path>",
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-bad-review-"));
  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    await writeJson(reviewFile, {
      verdict: "COMMENT",
      inlineComments: [],
      summaryFindings: [],
    });

    const bad = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
    ]);
    assert.equal(bad.code, 1);
    assert.equal(bad.stdout, "");
    assert.deepEqual(JSON.parse(bad.stderr), {
      ok: false,
      error: "Merged review payload must include headSha so the pending review is pinned to a commit",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stage-reviewer-draft reports gh failures deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-gh-fail-"));

  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    await writeJson(reviewFile, {
      headSha: "abc123",
      verdict: "COMMENT",
      inlineComments: [],
      summaryFindings: [],
    });

    const gh = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "-X", "POST", "repos/owner/repo/pulls/17/reviews", "--input", "-"],
        stderr: "boom\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
    ], { env: gh.env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "gh command failed: boom",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("stage-reviewer-draft rejects malformed success payloads from gh deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-stage-reviewer-bad-success-"));

  try {
    const reviewFile = path.join(tempDir, "merged-review.json");
    await writeJson(reviewFile, {
      headSha: "abc123",
      verdict: "COMMENT",
      inlineComments: [],
      summaryFindings: [],
    });

    const gh = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "-X", "POST", "repos/owner/repo/pulls/17/reviews", "--input", "-"],
        stdout: '{"id":447,"html_url":"https://github.com/owner/repo/pull/17#pullrequestreview-447","state":"COMMENTED","commit_id":"abc123"}\n',
      },
    ]);

    const result = await runNode([
      "--repo",
      "owner/repo",
      "--pr",
      "17",
      "--review-file",
      reviewFile,
    ], { env: gh.env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "Draft review payload from gh did not include id, url, PENDING state, and commit_id",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseGateReviewCommentBody,
  summarizeGateReviewComments,
} from "../../scripts/_core-helpers.mjs";
import {
  parseDetectGateReviewEvidenceCliArgs,
} from "../../scripts/github/detect-gate-review-evidence.mjs";

const scriptPath = path.resolve("scripts/github/detect-gate-review-evidence.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve) => {
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

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeGhStub(tempDir, entries) {
  const sequencePath = path.join(tempDir, "gh-sequence.json");
  const counterPath = path.join(tempDir, "gh-counter.txt");
  const ghPath = path.join(tempDir, "gh");

  await writeFile(sequencePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await writeFile(counterPath, "0\n", "utf8");
  await writeFile(
    ghPath,
    [
      "#!/usr/bin/env node",
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const sequencePath = process.env.GH_SEQUENCE_PATH;",
      "const counterPath = process.env.GH_COUNTER_PATH;",
      'const entries = JSON.parse(readFileSync(sequencePath, "utf8"));',
      'const current = Number(readFileSync(counterPath, "utf8").trim() || "0");',
      'const entry = entries[Math.min(current, entries.length - 1)] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
      '      process.stderr.write(`missing expected gh arg: ${expected}\\n`);',
      '      process.exit(98);',
      '    }',
      '  }',
      '}',
      'if (entry.stderr) process.stderr.write(entry.stderr);',
      'if (entry.stdout) process.stdout.write(entry.stdout);',
      'process.exit(entry.exitCode ?? 0);',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(ghPath, 0o755);

  return {
    ...process.env,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    GH_SEQUENCE_PATH: sequencePath,
    GH_COUNTER_PATH: counterPath,
  };
}

test("parseGateReviewCommentBody parses the deterministic visible gate comment format", () => {
  const parsed = parseGateReviewCommentBody([
    "Gate review: `draft_gate`",
    "Head SHA: `abc1234`",
    "Verdict: clean",
    "Findings: no issues found",
    "Next action: mark ready for review",
  ].join("\n"));

  assert.deepEqual(parsed, {
    gate: "draft_gate",
    headSha: "abc1234",
    verdict: "clean",
    findingsSummary: "no issues found",
    nextAction: "mark ready for review",
  });
});

test("parseGateReviewCommentBody rejects comments missing required contract fields", () => {
  assert.equal(parseGateReviewCommentBody([
    "Gate review: draft_gate",
    "Head SHA: abc1234",
    "Verdict: clean",
    "Findings: no issues found",
  ].join("\n")), null);
});

test("summarizeGateReviewComments keeps the newest valid comment for each gate", () => {
  const summary = summarizeGateReviewComments([
    {
      id: 10,
      body: [
        "Gate review: draft_gate",
        "Head SHA: old1234",
        "Verdict: findings_present",
        "Findings: fix tests",
        "Next action: stay draft and fix",
      ].join("\n"),
      updated_at: "2026-05-29T20:00:00Z",
    },
    {
      id: 11,
      body: [
        "Gate review: draft_gate",
        "Head SHA: abc1234",
        "Verdict: clean",
        "Findings: no issues found",
        "Next action: mark ready for review",
      ].join("\n"),
      updated_at: "2026-05-29T21:00:00Z",
    },
    {
      id: 12,
      body: [
        "Gate review: pre_approval_gate",
        "Head SHA: abc1234",
        "Verdict: clean",
        "Findings: no issues found",
        "Next action: await final human approval",
      ].join("\n"),
      updated_at: "2026-05-29T22:00:00Z",
    },
  ]);

  assert.equal(summary.draft_gate?.commentId, 11);
  assert.equal(summary.draft_gate?.headSha, "abc1234");
  assert.equal(summary.pre_approval_gate?.commentId, 12);
  assert.equal(summary.pre_approval_gate?.nextAction, "await final human approval");
});

test("parseDetectGateReviewEvidenceCliArgs rejects malformed arguments deterministically", () => {
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs([]),
    /requires both --repo <owner\/name> and --pr <number>/i,
  );
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs(["--repo", "owner/repo", "--pr", "0"]),
    /positive integer/i,
  );
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs(["--repo", "bad slug", "--pr", "17"]),
    /match <owner\/name>/i,
  );
});

test("detect-gate-review-evidence summarizes the newest valid live gate comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 41,
            body: [
              "Gate review: draft_gate",
              "Head SHA: old5678",
              "Verdict: findings_present",
              "Findings: missing tests",
              "Next action: stay draft and fix",
            ].join("\n"),
            updated_at: "2026-05-29T20:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-41",
          },
          {
            id: 42,
            body: [
              "Gate review: draft_gate",
              "Head SHA: abc1234",
              "Verdict: clean",
              "Findings: no issues found",
              "Next action: mark ready for review",
            ].join("\n"),
            updated_at: "2026-05-29T21:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-42",
          },
          {
            id: 43,
            body: [
              "Gate review: pre_approval_gate",
              "Head SHA: abc1234",
              "Verdict: clean",
              "Findings: no issues found",
              "Next action: await final human approval",
            ].join("\n"),
            updated_at: "2026-05-29T22:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-43",
          },
          {
            id: 44,
            body: "not a gate comment",
            updated_at: "2026-05-29T23:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      pr: 17,
      currentHeadSha: "abc1234",
      draftGate: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "mark ready for review",
        commentId: 42,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-42",
        updatedAt: "2026-05-29T21:00:00Z",
      },
      preApprovalGate: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "await final human approval",
        commentId: 43,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-43",
        updatedAt: "2026-05-29T22:00:00Z",
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-gate-review-evidence flattens paginated issue-comment payloads before summarizing gates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-pages-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          [
            {
              id: 51,
              body: "noise",
              updated_at: "2026-05-29T20:00:00Z",
            },
          ],
          [
            {
              id: 52,
              body: [
                "Gate review: draft_gate",
                "Head SHA: abc1234",
                "Verdict: clean",
                "Findings: no issues found",
                "Next action: mark ready for review",
              ].join("\n"),
              updated_at: "2026-05-29T21:00:00Z",
              html_url: "https://github.com/owner/repo/pull/17#issuecomment-52",
            },
          ],
        ])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).draftGate.commentId, 52);
    assert.equal(JSON.parse(result.stdout).draftGate.visible, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-gate-review-evidence reports gh failures deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-fail-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stderr: "boom\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /gh command failed: boom/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

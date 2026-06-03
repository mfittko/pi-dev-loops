import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import {
  auditCopilotComments,
  buildCopilotAuditSummary,
  classifyCopilotComment,
  parseAuditCopilotCommentsCliArgs,
  renderMarkdownReport,
  runGhJsonWithRetry,
} from "../../scripts/github/audit-copilot-comments.mjs";

const scriptPath = path.resolve("scripts/github/audit-copilot-comments.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries, options = {}) {
  const { env } = await writeGhStubHelper(tempDir, entries, options);
  return env;
}

function sampleReviewComment({
  id,
  prNumber,
  path: filePath,
  body,
  userLogin = "Copilot",
  line = 1,
}) {
  return {
    id,
    pull_request_url: `https://api.github.com/repos/owner/repo/pulls/${prNumber}`,
    html_url: `https://github.com/owner/repo/pull/${prNumber}#discussion_r${id}`,
    path: filePath,
    body,
    line,
    user: {
      login: userLogin,
    },
    created_at: "2026-06-02T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
  };
}

const samplePrs = [
  { number: 11, title: "Fix docs links", html_url: "https://github.com/owner/repo/pull/11", state: "closed", merged_at: "2026-06-01T10:00:00Z" },
  { number: 12, title: "Tighten tests", html_url: "https://github.com/owner/repo/pull/12", state: "open", merged_at: null },
  { number: 13, title: "Gate fixes", html_url: "https://github.com/owner/repo/pull/13", state: "open", merged_at: null },
];

test("parseAuditCopilotCommentsCliArgs parses repo and default output dir", () => {
  const options = parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo"]);

  assert.equal(options.repo, "owner/repo");
  assert.equal(options.outputDir, "tmp/investigation");
  assert.equal(options.help, false);
  assert.equal(options.sleepMs, 0);
  assert.equal(options.resume, false);
  assert.equal(options.checkpointFile, undefined);
});

test("parseAuditCopilotCommentsCliArgs parses new flags", () => {
  const options = parseAuditCopilotCommentsCliArgs([
    "--repo", "owner/repo",
    "--sleep-ms", "500",
    "--checkpoint-file", "tmp/ckpt.json",
    "--resume",
  ]);

  assert.equal(options.repo, "owner/repo");
  assert.equal(options.sleepMs, 500);
  assert.equal(options.checkpointFile, "tmp/ckpt.json");
  assert.equal(options.resume, true);
});

test("parseAuditCopilotCommentsCliArgs rejects bad --sleep-ms", () => {
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--sleep-ms", "abc"]),
    /non-negative integer/i,
  );
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--sleep-ms", "-1"]),
    /non-negative integer/i,
  );
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--sleep-ms", "1.5"]),
    /non-negative integer/i,
  );
});

test("parseAuditCopilotCommentsCliArgs rejects empty --checkpoint-file", () => {
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--checkpoint-file", "   "]),
    /non-empty path/i,
  );
});

test("parseAuditCopilotCommentsCliArgs rejects --resume without --checkpoint-file", () => {
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--resume"]),
    /--resume requires --checkpoint-file/i,
  );
});

test("parseAuditCopilotCommentsCliArgs rejects malformed arguments deterministically", () => {
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs([]),
    /requires --repo <owner\/name>/i,
  );
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "bad slug"]),
    /owner\/name/i,
  );
  assert.throws(
    () => parseAuditCopilotCommentsCliArgs(["--repo", "owner/repo", "--output-dir", "   "]),
    /non-empty path/i,
  );
});


test("audit-copilot-comments help text describes the full summary output", async () => {
  const result = await runNode(["--help"]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Output \(stdout, JSON summary; abbreviated example\)/);
  assert.match(result.stdout, /"categories"/);
  assert.match(result.stdout, /abbreviated/i);
  assert.match(result.stdout, /same full\s+summary object/i);
  assert.match(result.stdout, /<output-dir>\/copilot-comment-summary\.json/);
  assert.match(result.stdout, /--sleep-ms/);
  assert.match(result.stdout, /--checkpoint-file/);
  assert.match(result.stdout, /--resume/);
});

test("classifyCopilotComment assigns representative categories", () => {
  assert.equal(
    classifyCopilotComment(sampleReviewComment({
      id: 1,
      prNumber: 11,
      path: "README.md",
      body: "This relative path points to a missing file and should be fixed.",
    })).primaryCategoryId,
    "broken_paths",
  );

  assert.equal(
    classifyCopilotComment(sampleReviewComment({
      id: 2,
      prNumber: 12,
      path: "test/example.test.mjs",
      body: "This only covers the happy path; please add a malformed-argument test for the negative-case.",
    })).primaryCategoryId,
    "incomplete_coverage",
  );

  assert.equal(
    classifyCopilotComment(sampleReviewComment({
      id: 3,
      prNumber: 13,
      path: "scripts/loop.mjs",
      body: "The ready state lacks visible gate evidence for the reviewed head SHA.",
    })).primaryCategoryId,
    "gate_evidence",
  );

  assert.equal(
    classifyCopilotComment(sampleReviewComment({
      id: 4,
      prNumber: 13,
      path: "docs/plan.md",
      body: "The header uses inconsistent casing and wording compared with the canonical status token.",
    })).primaryCategoryId,
    "config_conflicts",
  );
});

test("buildCopilotAuditSummary counts categories and ranks recommendations", () => {
  const summary = buildCopilotAuditSummary({
    repo: "owner/repo",
    prs: samplePrs,
    comments: [
      sampleReviewComment({
        id: 101,
        prNumber: 11,
        path: "README.md",
        body: "This relative path points to a missing file and will 404 in docs.",
      }),
      sampleReviewComment({
        id: 102,
        prNumber: 12,
        path: "test/audit.test.mjs",
        body: "This only covers the happy path; add a malformed-argument test for the negative-case.",
      }),
      sampleReviewComment({
        id: 103,
        prNumber: 12,
        path: "test/audit.test.mjs",
        body: "The assertions match very long exact sentences, which makes the test brittle to minor copy edits.",
      }),
      sampleReviewComment({
        id: 104,
        prNumber: 13,
        path: "docs/workflow.md",
        body: "The ready state lacks visible gate evidence for the reviewed head SHA.",
      }),
      sampleReviewComment({
        id: 105,
        prNumber: 13,
        path: "scripts/example.mjs",
        body: "The variable is read from disk but never used after parsing.",
      }),
      sampleReviewComment({
        id: 106,
        prNumber: 13,
        path: "scripts/example.mjs",
        body: "This comment is from a human and should not be included.",
        userLogin: "mfittko",
      }),
    ],
  });

  assert.equal(summary.totals.copilotComments, 5);
  assert.equal(summary.totals.prsWithCopilotComments, 3);
  assert.equal(summary.categories.find((entry) => entry.id === "incomplete_coverage")?.count, 1);
  assert.equal(summary.categories.find((entry) => entry.id === "gate_evidence")?.count, 1);
  assert.equal(summary.recommendations[0].key, "coverage-angle");
  assert.equal(summary.files.markdownReportPath, path.join("tmp/investigation", "copilot-comment-categories.md"));

  const markdown = renderMarkdownReport(summary);
  assert.match(markdown, /Top categories/);
  assert.match(markdown, /Priority order for missing lenses/i);
  assert.match(markdown, /Categories Copilot should still own/i);
});

test("audit-copilot-comments surfaces malformed gh JSON with command context", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-copilot-comments-json-error-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls/comments?per_page=100"],
        stdout: "not-json\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 1);
    const stderr = JSON.parse(result.stderr);
    assert.equal(stderr.ok, false);
    assert.match(stderr.error, /Invalid JSON from gh api --paginate --slurp repos\/owner\/repo\/pulls\/comments\?per_page=100/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("auditCopilotComments includes the configured gh command in parse errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-copilot-comments-custom-gh-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls/comments?per_page=100"],
        stdout: "not-json\n",
      },
    ], { commandName: "pi-gh" });

    await assert.rejects(
      auditCopilotComments({ repo: "owner/repo", outputDir: path.join(tempDir, "out") }, { env, ghCommand: "pi-gh" }),
      /Invalid JSON from pi-gh api --paginate --slurp repos\/owner\/repo\/pulls\/comments\?per_page=100/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("audit-copilot-comments CLI writes JSON summary and markdown report", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-copilot-comments-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls/comments?per_page=100"],
        stdout: `${JSON.stringify([[
          sampleReviewComment({
            id: 201,
            prNumber: 11,
            path: "README.md",
            body: "This relative path points to a missing file.",
          }),
          sampleReviewComment({
            id: 202,
            prNumber: 12,
            path: "docs/workflow.md",
            body: "The ready state lacks visible gate evidence for the reviewed head SHA.",
          }),
          sampleReviewComment({
            id: 203,
            prNumber: 12,
            path: "test/example.test.mjs",
            body: "This only covers the happy path; add a malformed-argument test.",
          }),
        ]])}\n`,
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls?state=all&per_page=100"],
        stdout: `${JSON.stringify([samplePrs])}\n`,
      },
    ]);

    const outputDir = path.join(tempDir, "out");
    const result = await runNode(["--repo", "owner/repo", "--output-dir", outputDir], { env });

    assert.equal(result.code, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);

    assert.equal(stdout.ok, true);
    assert.equal(stdout.totals.copilotComments, 3);
    assert.equal(stdout.files.outputDir, outputDir);

    await access(stdout.files.jsonSummaryPath);
    await access(stdout.files.markdownReportPath);
    const summaryStat = await stat(stdout.files.jsonSummaryPath);
    const reportText = await readFile(stdout.files.markdownReportPath, "utf8");
    const summaryText = await readFile(stdout.files.jsonSummaryPath, "utf8");

    assert.ok(summaryStat.size > 0);
    assert.match(reportText, /Broken relative paths/);
    assert.match(reportText, /Gate evidence/);
    assert.match(reportText, /Priority order for missing lenses/i);
    assert.match(summaryText, /"copilotComments": 3/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ── New resilience tests ────────────────────────────────────────────

test("runGhJsonWithRetry retries on 403", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-retry-403-"));

  try {
    // Sequence: 403 stderr + non-zero exit → then success
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 403: rate limit exceeded\n",
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: `${JSON.stringify([])}\n`,
      },
    ]);

    const result = await runGhJsonWithRetry(
      ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
      { env, ghCommand: "gh", retryMax: 2, retryBaseMs: 1 },
    );

    assert.deepEqual(result, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runGhJsonWithRetry retries on 429", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-retry-429-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 429: secondary rate limit\n",
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: `${JSON.stringify([])}\n`,
      },
    ]);

    const result = await runGhJsonWithRetry(
      ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
      { env, ghCommand: "gh", retryMax: 2, retryBaseMs: 1 },
    );

    assert.deepEqual(result, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runGhJsonWithRetry throws after max retries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-retry-max-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 403\n",
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 403\n",
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 403\n",
      },
    ]);

    await assert.rejects(
      runGhJsonWithRetry(
        ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        { env, ghCommand: "gh", retryMax: 2, retryBaseMs: 1 },
      ),
      /gh command failed: HTTP 403/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runGhJsonWithRetry fails immediately on 401", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-retry-401-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        stdout: "",
        exitCode: 1,
        stderr: "HTTP 401: Bad credentials\n",
      },
    ]);

    await assert.rejects(
      runGhJsonWithRetry(
        ["api", "--paginate", "--slurp", "repos/test/repo/pulls/comments?per_page=100"],
        { env, ghCommand: "gh", retryMax: 2, retryBaseMs: 10 },
      ),
      /HTTP 401/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ── Checkpoint tests ────────────────────────────────────────────────

test("audit-copilot-comments saves and resumes from checkpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-checkpoint-"));

  try {
    const checkpointPath = path.join(tempDir, "ckpt.json");

    // First run: completes full fetch, saves checkpoint
    const env1 = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls/comments?per_page=100"],
        stdout: `${JSON.stringify([[
          sampleReviewComment({ id: 401, prNumber: 11, path: "a.md", body: "This relative path points to a missing file." }),
        ]])}\n`,
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls?state=all&per_page=100"],
        stdout: `${JSON.stringify([samplePrs])}\n`,
      },
    ]);

    const outputDir1 = path.join(tempDir, "out1");
    const result1 = await runNode(["--repo", "owner/repo", "--output-dir", outputDir1, "--checkpoint-file", checkpointPath], { env: env1 });
    assert.equal(result1.code, 0);
    const summary1 = JSON.parse(result1.stdout);
    assert.equal(summary1.totals.copilotComments, 1);

    // Verify checkpoint file exists and is valid
    const ckptRaw = await readFile(checkpointPath, "utf8");
    const ckpt = JSON.parse(ckptRaw);
    assert.equal(ckpt.stage, "after-prs");
    assert.ok(Array.isArray(ckpt.comments));
    assert.ok(Array.isArray(ckpt.prs));

    // Resume: should skip fetches entirely
    const env2 = await writeGhStub(tempDir, []); // empty — no calls expected
    const outputDir2 = path.join(tempDir, "out2");
    const result2 = await runNode(["--repo", "owner/repo", "--output-dir", outputDir2, "--checkpoint-file", checkpointPath, "--resume"], { env: env2 });
    assert.equal(result2.code, 0);
    const summary2 = JSON.parse(result2.stdout);
    assert.equal(summary2.totals.copilotComments, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-copilot-comments resume from after-comments stage re-fetches only PRs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-checkpoint-comments-"));

  try {
    const checkpointPath = path.join(tempDir, "ckpt.json");

    // Provide a checkpoint at after-comments stage with flat normalized comments
    // (the same format as returned by fetchAllReviewComments after normalizePaginatedArrayPayload)
    await writeFile(checkpointPath, JSON.stringify({
      stage: "after-comments",
      repo: "owner/repo",
      comments: [
        sampleReviewComment({ id: 501, prNumber: 11, path: "a.md", body: "This relative path points to a missing file." }),
      ],
    }));

    // Resume: gh stub only needs PR fetch (one call)
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls?state=all&per_page=100"],
        stdout: `${JSON.stringify([samplePrs])}\n`,
      },
    ]);

    const outputDir = path.join(tempDir, "out");
    const result = await runNode(["--repo", "owner/repo", "--output-dir", outputDir, "--checkpoint-file", checkpointPath, "--resume"], { env });
    assert.equal(result.code, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.totals.copilotComments, 1);

    // Verify checkpoint was updated to after-prs
    const ckptRaw = await readFile(checkpointPath, "utf8");
    const ckpt = JSON.parse(ckptRaw);
    assert.equal(ckpt.stage, "after-prs");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-copilot-comments resume with corrupt checkpoint falls back to fresh fetch", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-checkpoint-corrupt-"));

  try {
    const checkpointPath = path.join(tempDir, "ckpt.json");

    // Write garbage
    await writeFile(checkpointPath, "not json at all");

    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls/comments?per_page=100"],
        stdout: `${JSON.stringify([[
          sampleReviewComment({ id: 601, prNumber: 11, path: "a.md", body: "missing file" }),
        ]])}\n`,
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls?state=all&per_page=100"],
        stdout: `${JSON.stringify([samplePrs])}\n`,
      },
    ]);

    const outputDir = path.join(tempDir, "out");
    const result = await runNode(["--repo", "owner/repo", "--output-dir", outputDir, "--checkpoint-file", checkpointPath, "--resume"], { env });
    assert.equal(result.code, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.totals.copilotComments, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

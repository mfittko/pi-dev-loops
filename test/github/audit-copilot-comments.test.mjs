import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  buildCopilotAuditSummary,
  classifyCopilotComment,
  parseAuditCopilotCommentsCliArgs,
  renderMarkdownReport,
} from "../../scripts/github/audit-copilot-comments.mjs";

const scriptPath = path.resolve("scripts/github/audit-copilot-comments.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.execPath ?? process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", rejectOnce);
    child.on("close", (code) => {
      resolveOnce({ code, stdout, stderr });
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
      'if (current >= entries.length) {',
      '  process.stderr.write(`unexpected extra gh call #${current + 1}: ${process.argv.slice(2).join(" ")}\\n`);',
      '  process.exit(97);',
      '}',
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
      '      process.stderr.write(`missing expected gh arg: ${expected}\\nactual: ${actual.join(" ")}\\n`);',
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
  assert.match(result.stdout, /Output \(stdout, JSON summary\)/);
  assert.match(result.stdout, /"categories"/);
  assert.match(result.stdout, /same full summary object/i);
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

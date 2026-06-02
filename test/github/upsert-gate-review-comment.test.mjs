import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseUpsertGateReviewCommentCliArgs,
  summarizeGateReviewText,
} from "../../scripts/github/upsert-gate-review-comment.mjs";

const scriptPath = path.resolve("scripts/github/upsert-gate-review-comment.mjs");

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
      'if (entry.assertArgContains) {',
      '  for (const expected of entry.assertArgContains) {',
      '    if (!actual.some((value) => value.includes(expected))) {',
      '      process.stderr.write(`missing expected gh arg fragment: ${expected}\\n`);',
      '      process.exit(97);',
      '    }',
      '  }',
      '}',
      'if (entry.assertArgNotContains) {',
      '  for (const unexpected of entry.assertArgNotContains) {',
      '    if (actual.some((value) => value.includes(unexpected))) {',
      '      process.stderr.write(`unexpected gh arg fragment: ${unexpected}\\n`);',
      '      process.exit(96);',
      '    }',
      '  }',
      '}',
      'if (entry.stderr) {',
      '  process.stderr.write(entry.stderr);',
      '}',
      'if (entry.stdout) {',
      '  process.stdout.write(entry.stdout);',
      '}',
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

test("parseUpsertGateReviewCommentCliArgs rejects malformed arguments deterministically", () => {
  assert.throws(
    () => parseUpsertGateReviewCommentCliArgs([]),
    /requires --repo, --pr, --gate, --head-sha, --verdict, --findings-summary, and --next-action/i,
  );

  const parsed = parseUpsertGateReviewCommentCliArgs([
    "--repo", "owner/repo",
    "--pr", "17",
    "--gate", "draft_gate",
    "--head-sha", "ABC1234",
    "--verdict", "clean",
    "--findings-summary", "no issues found",
    "--next-action", "mark ready for review",
  ]);
  assert.equal(parsed.headSha, "abc1234");

  assert.throws(
    () => parseUpsertGateReviewCommentCliArgs([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "not-a-sha",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ]),
    /7-64 character hexadecimal SHA/i,
  );
});

test("summarizeGateReviewText compacts verbose validation success logs deterministically", () => {
  assert.equal(
    summarizeGateReviewText([
      "Validation: verbose local logs follow",
      "> npm test",
      "ℹ tests 46",
      "ℹ pass 46",
      "ℹ fail 0",
      "GitHub CI test passed on the current head.",
      "stdout: this raw passing output should not appear in the visible gate comment body.",
    ].join("\n")),
    "commands: npm test; tests: 46, pass: 46, fail: 0; ci: GitHub CI test passed on the current head.",
  );
});

test("summarizeGateReviewText keeps failing validation to a concise excerpt", () => {
  assert.equal(
    summarizeGateReviewText([
      "> npm test",
      "ℹ tests 46",
      "ℹ pass 45",
      "ℹ fail 1",
      "✖ test/github/upsert-gate-review-comment.test.mjs",
      "AssertionError: Expected values to be strictly equal: 1 !== 2",
      "at TestContext.<anonymous> (/tmp/workspace/mfittko/pi-dev-loops/test/github/upsert-gate-review-comment.test.mjs:42:10)",
    ].join("\n")),
    "commands: npm test; tests: 46, pass: 45, fail: 1; failure excerpt: test/github/upsert-gate-review-comment.test.mjs",
  );
});


test("summarizeGateReviewText preserves long single-line narratives instead of inventing a log summary", () => {
  const narrative = "Passed reviewer note: keep the operator-facing summary readable even when Error and passed appear in the same explanatory sentence, because this is narrative text rather than a multiline validation log. ".repeat(3).trim();
  const summarized = summarizeGateReviewText(narrative, 140);

  assert.match(summarized, /^Passed reviewer note:/);
  assert.match(summarized, /Error and passed appear/);
  assert.doesNotMatch(summarized, /^validation: passed$/);
  assert.match(summarized, /…\[truncated \d+ chars\]$/);
});


test("summarizeGateReviewText preserves multiline narrative text when no structured validation signals are present", () => {
  const narrative = [
    "Validation recap:",
    "The operator passed through the flow carefully.",
    "Nothing here is a command log or CI line.",
  ].join("\n");

  assert.equal(
    summarizeGateReviewText(narrative),
    "Validation recap: The operator passed through the flow carefully. Nothing here is a command log or CI line.",
  );
});

test("summarizeGateReviewText captures Error-prefixed failure lines", () => {
  assert.equal(
    summarizeGateReviewText([
      "> npm test",
      "Error: Expected gate summary to stay bounded",
      "detail: additional stack output that should not become the visible excerpt",
    ].join("\n")),
    "commands: npm test; failure excerpt: Error: Expected gate summary to stay bounded",
  );
});


test("summarizeGateReviewText does not treat markdown headings as shell commands", () => {
  const narrative = [
    "# Summary",
    "Validation recap passed through manual review.",
    "## Notes",
    "This is prose, not a shell transcript.",
  ].join("\n");

  assert.equal(
    summarizeGateReviewText(narrative),
    "# Summary Validation recap passed through manual review. ## Notes This is prose, not a shell transcript.",
  );
});

test("upsert-gate-review-comment creates a new comment when no same-head marker exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-create-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Reviewed head SHA:** `abc1234`", "**Next action:** mark ready for review"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment fails closed when pre-approval gate entry is still illegal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-illegal-preapproval-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":266,"state":"OPEN","isDraft":false,"headRefOid":"def56789abcdef","reviews":[],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def56789abcdef"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 11,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `c94679e`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/266#issuecomment-11",
          updated_at: "2026-05-31T20:00:00Z",
        }]])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "266",
      "--gate", "pre_approval_gate",
      "--head-sha", "def56789",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "await final human approval",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter pre_approval_gate/i);
    assert.match(payload.error, /request Copilot review before any/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment truncates verbose findings summary before comment creation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-verbose-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":false,"headRefOid":"abc1234","reviews":[{"author":{"login":"copilot-pull-request-reviewer"},"state":"COMMENTED","submittedAt":"2026-05-31T20:00:00Z","commit":{"oid":"abc1234"}}],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 91,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/17#issuecomment-91",
          updated_at: "2026-05-31T20:10:00Z",
        }]])}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: [
          "body=### Gate review: `pre_approval_gate`",
          "**Findings summary:** commands: npm test; tests: 46, pass: 46, fail: 0; ci: GitHub CI test passed on the current head.",
        ],
        assertArgNotContains: ["stdout: this raw passing output should not appear"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);
    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "pre_approval_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", [
        "Validation: verbose local logs follow",
        "> npm test",
        "ℹ tests 46",
        "ℹ pass 46",
        "ℹ fail 0",
        "GitHub CI test passed on the current head.",
        "stdout: this raw passing output should not appear in the visible gate comment body.",
      ].join("\n"),
      "--next-action", "await final human approval",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "pre_approval_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment suppresses duplicate repost when the current same-head comment already matches", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-noop-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "noop",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
    // 5 gh calls: pr facts + requested_reviewers + review threads + headRefOid + issue comments
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), 5);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment noop still warns when a stale comment exists on a different head", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-noop-warn-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `def5678`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** older review",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, "noop");
    assert.equal(parsed.headSha, "abc1234");
    assert.match(parsed.warning, /different head SHA/i);
    assert.match(parsed.warning, /def5678/);
    assert.match(parsed.warning, /comment 202/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment updates an incomplete same-head marker in place", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-update-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/101", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Findings summary:** no issues found"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment updates the current same-head marker even when another head has a newer marker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-current-head-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `def5678`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** later head marker",
            "",
            "**Next action:** rerun gate",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/101", "-f"],
        assertArgContains: ["**Reviewed head SHA:** `abc1234`", "**Findings summary:** fixed the marker for the current head"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "ABC1234",
      "--verdict", "clean",
      "--findings-summary", "fixed the marker for the current head",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      warning: "A gate comment for \`draft_gate\` already exists on a different head SHA \`def5678\` (comment 202). The old comment is stale for the current head.",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment prefers the latest same-head marker when it differs from the older strict summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-latest-marker-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** already complete",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/202", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Reviewed head SHA:** `abc1234`", "**Findings summary:** corrected the newer malformed marker"],
        stdout: '{"id":202,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-202"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "corrected the newer malformed marker",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 202,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-202",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment expands an abbreviated current-head SHA before matching same-head markers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-short-head-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abcdef1234567890abcdef1234567890abcdef12","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abcdef1234567890abcdef1234567890abcdef12"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abcdef1234567890abcdef1234567890abcdef12`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "ABCDEF1",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "noop",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abcdef1234567890abcdef1234567890abcdef12",
      currentHeadSha: "abcdef1234567890abcdef1234567890abcdef12",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), 5);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment fails closed when the requested head SHA is stale", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-stale-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"def5678","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def5678"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match the current PR head SHA/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment warns when a gate comment exists on a different head SHA", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-warn-stale-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"def5678","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def5678"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 99,
            body: [
              "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** previous review",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-99",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stdout: '{"id":102,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-102"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "def5678",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.gate, "draft_gate");
    assert.equal(parsed.headSha, "def5678");
    assert.match(parsed.warning, /different head SHA/i);
    assert.match(parsed.warning, /abc1234/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-gate-review-comment fails closed when draft_gate is forbidden on a non-draft PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-draft-forbidden-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":266,"state":"OPEN","isDraft":false,"headRefOid":"def56789abcdef","reviews":[],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def56789abcdef"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 11,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `c94679e`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/266#issuecomment-11",
          updated_at: "2026-05-31T20:00:00Z",
        }]])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "266",
      "--gate", "draft_gate",
      "--head-sha", "def56789",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter draft_gate/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


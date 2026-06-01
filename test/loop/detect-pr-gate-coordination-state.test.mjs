import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/loop/detect-pr-gate-coordination-state.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.execPath ?? process.execPath, [scriptPath, ...args], {
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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
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
      '',
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

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

test("detect-pr-gate-coordination-state allows post-draft flow for non-draft PRs with clean draft_gate on a different head (one-time boundary)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-state-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 266,
          state: "OPEN",
          isDraft: false,
          headRefOid: "def56789abcdef",
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
          reviews: [],
        }),
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: jsonLine({ users: [], teams: [] }),
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: jsonLine({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                },
              },
            },
          },
        }),
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: jsonLine({ headRefOid: "def56789abcdef" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: jsonLine([[
          {
            id: 11,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: c94679e",
              "Verdict: clean",
              "Findings summary: no issues found",
              "Next action: mark ready for review",
            ].join("\n"),
            html_url: "https://example.test/comment/11",
            updated_at: "2026-05-31T20:00:00Z",
          },
        ]]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "266"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      pr: 266,
      currentHeadSha: "def56789abcdef",
      lifecycleState: "pr_ready_no_feedback",
      loopDisposition: "action_required",
      gateBoundary: "post_draft_external_review",
      draftGate: {
        visible: true,
        currentHead: false,
        headSha: "c94679e",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "mark ready for review",
        contractComplete: false,
        currentHeadClean: false,
        draftGateSatisfied: true,
      },
      preApprovalGate: {
        visible: false,
        currentHead: false,
        headSha: null,
        verdict: null,
        findingsSummary: null,
        nextAction: null,
        contractComplete: false,
        currentHeadClean: false,
        draftGateSatisfied: false,
      },
      allowedNextActions: ["request_copilot_review"],
      forbiddenActions: [
        "run_draft_gate",
        "mark_ready_for_review",
        "run_pre_approval_gate",
        "declare_merge_ready",
      ],
      nextAction: "request_copilot_review",
      reason: "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("detect-pr-gate-coordination-state fails closed when the PR head changes mid-read", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-head-drift-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 266,
          state: "OPEN",
          isDraft: false,
          headRefOid: "aaaaaaa1234567",
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
          reviews: [],
        }),
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: jsonLine({ users: [], teams: [] }),
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: jsonLine({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }),
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: jsonLine({ headRefOid: "bbbbbbb7654321" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: '[]\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "266"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /PR head changed while loading gate coordination facts/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

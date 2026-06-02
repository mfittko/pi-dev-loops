import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { detectPrGateCoordinationState, parseGitStatusConflictFiles } from "../../scripts/loop/detect-pr-gate-coordination-state.mjs";

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

async function writeGitStub(tempDir, { stdout = "", stderr = "", exitCode = 0, assertArgs = [] } = {}) {
  const gitPath = path.join(tempDir, "git");
  const stdoutPath = path.join(tempDir, "git-stdout.txt");

  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(
    gitPath,
    [
      "#!/usr/bin/env node",
      'import { readFileSync } from "node:fs";',
      'const actual = process.argv.slice(2);',
      'const assertArgs = JSON.parse(process.env.GIT_ASSERT_ARGS || "[]");',
      'for (const expected of assertArgs) {',
      '  if (!actual.includes(expected)) {',
      '    process.stderr.write(`missing expected git arg: ${expected}\nactual: ${actual.join(" ")}\n`);',
      '    process.exit(98);',
      '  }',
      '}',
      'if (process.env.GIT_STDERR) process.stderr.write(process.env.GIT_STDERR);',
      'if (process.env.GIT_STDOUT_PATH) process.stdout.write(readFileSync(process.env.GIT_STDOUT_PATH, "utf8"));',
      'process.exit(Number(process.env.GIT_EXIT_CODE || "0"));',
      '',
    ].join("\n"),
    "utf8",
  );
  await chmod(gitPath, 0o755);

  return {
    GIT_ASSERT_ARGS: JSON.stringify(assertArgs),
    GIT_STDOUT_PATH: stdoutPath,
    GIT_STDERR: stderr,
    GIT_EXIT_CODE: String(exitCode),
  };
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

test("parseGitStatusConflictFiles parses NUL-delimited porcelain output with deterministic paths", () => {
  const parsed = parseGitStatusConflictFiles([
    "UU config.test.mjs",
    "AA extension/README with spaces.md",
    "UU  spaced-at-both-ends.txt ",
    " M ignored.txt",
    "R  old-name.md",
    "new-name.md",
    "",
  ].join("\0"));

  assert.deepEqual(parsed, ["config.test.mjs", "extension/README with spaces.md", " spaced-at-both-ends.txt "]);
});

test("detect-pr-gate-coordination-state allows post-draft flow for non-draft PRs with clean draft_gate on a different head (one-time boundary)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-state-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
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
      mergeStateStatus: null,
      conflictFiles: [],
      lifecycleState: "pr_ready_no_feedback",
      loopDisposition: "action_required",
      gateBoundary: "post_draft_external_review",
      draftGate: {
        visible: true,
        markerVisible: false,
        anyVisible: true,
        currentHead: false,
        headSha: "c94679e",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "mark ready for review",
        contractComplete: false,
        currentHeadClean: false,
        cleanEvidenceExists: true,
      },
      preApprovalGate: {
        visible: false,
        markerVisible: false,
        anyVisible: false,
        currentHead: false,
        headSha: null,
        verdict: null,
        findingsSummary: null,
        nextAction: null,
        contractComplete: false,
        currentHeadClean: false,
        cleanEvidenceExists: false,
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
      draftGateAlreadySatisfied: true,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectPrGateCoordinationState tolerates missing local git binary and falls back to GitHub-only facts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-missing-git-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 266,
          state: "OPEN",
          isDraft: false,
          headRefOid: "fedcba987654",
          mergeStateStatus: "CLEAN",
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
        stdout: jsonLine({ headRefOid: "fedcba987654" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: jsonLine([[]]),
      },
    ]);

    const result = await detectPrGateCoordinationState(
      { repo: "owner/repo", pr: 266 },
      { env, gitCommand: "definitely-missing-git" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.mergeStateStatus, "CLEAN");
    assert.deepEqual(result.conflictFiles, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-pr-gate-coordination-state preserves non-conflict mergeStateStatus values in helper output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-merge-state-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 266,
          state: "OPEN",
          isDraft: false,
          headRefOid: "fedcba987654",
          mergeStateStatus: "CLEAN",
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
        stdout: jsonLine({ headRefOid: "fedcba987654" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: jsonLine([[
          {
            id: 21,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: fedcba9",
              "Verdict: clean",
              "Findings summary: no issues found",
              "Next action: request Copilot review",
            ].join("\n"),
            html_url: "https://example.test/comment/21",
            updated_at: "2026-05-31T20:00:00Z",
          },
        ]]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "266"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.gateBoundary, "post_draft_external_review");
    assert.equal(parsed.nextAction, "request_copilot_review");
    assert.equal(parsed.mergeStateStatus, "CLEAN");
    assert.deepEqual(parsed.conflictFiles, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-pr-gate-coordination-state surfaces conflict_resolution for conflicted PRs and reports conflict files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-conflict-"));

  try {
    const ghEnv = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "370", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 370,
          state: "OPEN",
          isDraft: false,
          headRefOid: "deadbeef1234",
          mergeStateStatus: "DIRTY",
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
          reviews: [],
        }),
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/370/requested_reviewers"],
        stdout: jsonLine({ users: [], teams: [] }),
      },
      {
        assertArgs: ["api", "graphql", "pr=370"],
        stdout: jsonLine({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }),
      },
      {
        assertArgs: ["pr", "view", "370", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: jsonLine({ headRefOid: "deadbeef1234" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/370/comments?per_page=100"],
        stdout: "[]\n",
      },
    ]);
    const gitEnv = await writeGitStub(tempDir, {
      assertArgs: ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=no"],
      stdout: "UU config.test.mjs\0AA extension/README.md\0",
    });

    const result = await runNode(["--repo", "owner/repo", "--pr", "370"], {
      env: { ...ghEnv, ...gitEnv },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.gateBoundary, "conflict_resolution");
    assert.equal(parsed.nextAction, "resolve_merge_conflicts");
    assert.equal(parsed.mergeStateStatus, "DIRTY");
    assert.deepEqual(parsed.conflictFiles, ["config.test.mjs", "extension/README.md"]);
    assert.deepEqual(parsed.allowedNextActions, ["resolve_merge_conflicts"]);
    assert(parsed.forbiddenActions.includes("run_pre_approval_gate"));
    assert(parsed.forbiddenActions.includes("await_final_human_approval"));
    assert(parsed.forbiddenActions.includes("declare_merge_ready"));
    assert.match(parsed.reason, /config\.test\.mjs/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-pr-gate-coordination-state with --review-mode local_first skips Copilot review", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-local-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "267", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: jsonLine({
          number: 267,
          state: "OPEN",
          isDraft: false,
          headRefOid: "ccc1234567890",
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
          reviews: [],
        }),
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/267/requested_reviewers"],
        stdout: jsonLine({ users: [], teams: [] }),
      },
      {
        assertArgs: ["api", "graphql", "pr=267"],
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
        assertArgs: ["pr", "view", "267", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: jsonLine({ headRefOid: "ccc1234567890" }),
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/267/comments?per_page=100"],
        stdout: jsonLine([[
          {
            id: 12,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: ccc1234",
              "Verdict: clean",
              "Findings summary: no issues found",
              "Next action: mark ready for review",
            ].join("\n"),
            html_url: "https://example.test/comment/12",
            updated_at: "2026-05-31T20:00:00Z",
          },
        ]]),
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "267", "--review-mode", "local_first"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.gateBoundary, "pre_approval_gate_window");
    assert.equal(parsed.nextAction, "run_pre_approval_gate");
    assert(parsed.forbiddenActions.includes("request_copilot_review"));
    assert(parsed.allowedNextActions.includes("run_pre_approval_gate"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-pr-gate-coordination-state fails closed when the PR head changes mid-read", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-pr-gate-head-drift-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
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
        stdout: "[]\n",
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

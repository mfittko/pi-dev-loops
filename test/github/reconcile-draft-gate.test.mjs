import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseReconcileDraftGateCliArgs,
} from "../../scripts/github/reconcile-draft-gate.mjs";

const scriptPath = path.resolve("scripts/github/reconcile-draft-gate.mjs");

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

async function readGhCallCount(tempDir) {
  return Number((await readFile(path.join(tempDir, "gh-counter.txt"), "utf8")).trim() || "0");
}

function draftGateComment({ verdict = "clean", headSha = "abc1234", findingsSummary = "no issues found", nextAction = "mark ready for review" } = {}) {
  return [
    "### Gate review: `draft_gate`",
    "",
    `**Reviewed head SHA:** \`${headSha}\``,
    `**Verdict:** ${verdict}`,
    "",
    `**Findings summary:** ${findingsSummary}`,
    "",
    `**Next action:** ${nextAction}`,
  ].join("\n");
}

// ─── CLI argument parsing ────────────────────────────────────────────

test("parseReconcileDraftGateCliArgs accepts required --repo and --pr arguments", () => {
  const r = parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17"]);
  assert.equal(r.repo, "owner/repo");
  assert.equal(r.pr, 17);
  assert.equal(r.skipChecks, false);
});

test("parseReconcileDraftGateCliArgs accepts --skip-checks flag", () => {
  const r = parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17", "--skip-checks"]);
  assert.equal(r.skipChecks, true);
});

test("parseReconcileDraftGateCliArgs rejects missing --repo", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--pr", "17"]), /requires --repo and --pr/);
});

test("parseReconcileDraftGateCliArgs rejects missing --pr", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "owner/repo"]), /requires --repo and --pr/);
});

test("parseReconcileDraftGateCliArgs rejects invalid repo slug", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "bad", "--pr", "17"]));
});

test("parseReconcileDraftGateCliArgs rejects unknown arguments", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17", "--bogus"]), /Unknown argument/);
});

test("reconcile-draft-gate fails closed when visible draft_gate evidence already exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-visible-evidence-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 101,
          html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
          updated_at: "2026-06-02T10:00:00Z",
          body: draftGateComment({
            verdict: "findings_present",
            findingsSummary: "fix the visible draft-gate findings first",
            nextAction: "stay draft and address findings",
          }),
        }]])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /already has a visible draft_gate comment/i);
    assert.equal(await readGhCallCount(tempDir), 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate blocks while CI is still pending", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-pending-ci-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"pending","state":"PENDING","name":"verify","workflow":"CI"}]\n',
        exitCode: 8,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const error = JSON.parse(result.stderr).error;
    assert.match(error, /CI is not green/i);
    assert.match(error, /pending/i);
    assert.equal(await readGhCallCount(tempDir), 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate treats failing gh pr checks JSON output as blocked even on exit code 1", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-failing-ci-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"fail","state":"FAILURE","name":"verify","workflow":"CI"}]\n',
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const error = JSON.parse(result.stderr).error;
    assert.match(error, /CI is not green/i);
    assert.match(error, /verify=fail/i);
    assert.equal(await readGhCallCount(tempDir), 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate surfaces gh pr checks stderr when exit code 1 has no JSON payload", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-failing-ci-no-json-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stderr: 'auth failed\n',
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /Failed to check PR #17 CI status: auth failed/i);
    assert.equal(await readGhCallCount(tempDir), 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate blocks when no CI checks are reported", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-no-ci-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[]\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /no CI\/check runs were reported/i);
    assert.equal(await readGhCallCount(tempDir), 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate skips the draft conversion mutation when the PR is already draft", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-already-draft-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"pass","state":"SUCCESS","name":"verify","workflow":"CI"}]\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["owner=owner", "name=repo", "number=17", "pullRequest(number: $number)"],
        stdout: '{"data":{"repository":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":true}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc123456789","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "--field", "owner=owner", "--field", "name=repo", "--field", "pr=17"],
        assertArgContains: ["reviewThreads(first: 100)"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`"],
        assertArgNotContains: ["convertPullRequestToDraft"],
        stdout: '{"id":201,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-201"}\n',
      },
      {
        assertArgs: ["pr", "ready", "17", "--repo", "owner/repo"],
        stdout: "",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "reconciled",
      repo: "owner/repo",
      pr: 17,
      headSha: "abc123456789",
      currentHeadSha: "abc123456789",
      commentId: 201,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-201",
    });
    assert.equal(await readGhCallCount(tempDir), 11);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate does not mark ready when upsert throws and the PR was already draft", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-already-draft-upsert-failure-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"pass","state":"SUCCESS","name":"verify","workflow":"CI"}]\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["owner=owner", "name=repo", "number=17", "pullRequest(number: $number)"],
        stdout: '{"data":{"repository":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":true}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc123456789","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "--field", "owner=owner", "--field", "name=repo", "--field", "pr=17"],
        assertArgContains: ["reviewThreads(first: 100)"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stderr: 'boom\n',
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /gh command failed: boom/i);
    assert.equal(await readGhCallCount(tempDir), 10);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate marks the PR ready again if gate-comment upsert throws after converting to draft", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-upsert-failure-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"pass","state":"SUCCESS","name":"verify","workflow":"CI"}]\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["owner=owner", "name=repo", "number=17", "pullRequest(number: $number)"],
        stdout: '{"data":{"repository":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":false}}}}\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["pullRequestId=PR_kwDOScHU78000017", "convertPullRequestToDraft"],
        stdout: '{"data":{"convertPullRequestToDraft":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":true}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc123456789","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "--field", "owner=owner", "--field", "name=repo", "--field", "pr=17"],
        assertArgContains: ["reviewThreads(first: 100)"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stderr: 'boom\n',
        exitCode: 1,
      },
      {
        assertArgs: ["pr", "ready", "17", "--repo", "owner/repo"],
        stdout: "",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /gh command failed: boom/i);
    assert.equal(await readGhCallCount(tempDir), 12);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reconcile-draft-gate converts to draft, posts clean evidence, and marks ready when CI is green", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-reconcile-draft-gate-success-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["pr", "checks", "17", "--repo", "owner/repo", "--json", "bucket,state,name,workflow"],
        stdout: '[{"bucket":"pass","state":"SUCCESS","name":"verify","workflow":"CI"},{"bucket":"skipping","state":"SKIPPED","name":"viewer-smoke","workflow":"CI"}]\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["owner=owner", "name=repo", "number=17", "pullRequest(number: $number)"],
        stdout: '{"data":{"repository":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":false}}}}\n',
      },
      {
        assertArgs: ["api", "graphql", "-f", "-F"],
        assertArgContains: ["pullRequestId=PR_kwDOScHU78000017", "convertPullRequestToDraft"],
        stdout: '{"data":{"convertPullRequestToDraft":{"pullRequest":{"id":"PR_kwDOScHU78000017","isDraft":true}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc123456789","reviews":[],"statusCheckRollup":[]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "--field", "owner=owner", "--field", "name=repo", "--field", "pr=17"],
        assertArgContains: ["reviewThreads(first: 100)"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc123456789"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: [
          "body=### Gate review: `draft_gate`",
          "**Reviewed head SHA:** `abc123456789`",
          "**Findings summary:** Reconciled non-draft PR — draft gate auto-reconciled (CI green).",
          "**Next action:** Mark ready for review (auto-reconciled).",
        ],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
      {
        assertArgs: ["pr", "ready", "17", "--repo", "owner/repo"],
        stdout: "",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "reconciled",
      repo: "owner/repo",
      pr: 17,
      headSha: "abc123456789",
      currentHeadSha: "abc123456789",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
    });
    assert.equal(await readGhCallCount(tempDir), 12);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

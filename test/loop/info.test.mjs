import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNode as runNodeHelper, writeJson as writeJsonHelper, writeGhStub as writeGhStubHelper } from "../_helpers.mjs";

const infoScriptPath = path.resolve("scripts/loop/info.mjs");
const startupScriptPath = path.resolve("scripts/loop/resolve-dev-loop-startup.mjs");
const handoffScriptPath = path.resolve("scripts/loop/copilot-pr-handoff.mjs");
const linkageScriptPath = path.resolve("scripts/github/detect-linked-issue-pr.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(infoScriptPath, args, options);

// ── Argument parsing ────────────────────────────────────────────────

test("info.mjs --help shows usage", async () => {
  const { code, stdout, stderr } = await runNode(["--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Usage:"));
  assert.ok(stdout.includes("--issue"));
  assert.ok(stdout.includes("--pr"));
  assert.equal(stderr, "");
});

test("info.mjs requires --issue or --pr", async () => {
  const { code, stdout, stderr } = await runNode([]);
  assert.notEqual(code, 0);
  assert.ok(stderr.includes("--issue") || stderr.includes("--pr") || stderr.includes("required"));
  assert.equal(stdout, "");
});

test("info.mjs rejects --issue and --pr together", async () => {
  const { code, stdout, stderr } = await runNode(["--issue", "1", "--pr", "2"]);
  assert.notEqual(code, 0);
  assert.ok(stderr.includes("mutually exclusive") || stderr.includes("exactly one"));
});

test("info.mjs rejects negative --issue", async () => {
  const { code, stderr } = await runNode(["--issue", "-5"]);
  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0);
});

test("info.mjs rejects non-numeric --issue", async () => {
  const { code, stderr } = await runNode(["--issue", "abc"]);
  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0);
});

test("info.mjs rejects negative --pr", async () => {
  const { code, stderr } = await runNode(["--pr", "-5"]);
  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0);
});

test("info.mjs rejects unknown args", async () => {
  const { code, stderr } = await runNode(["--issue", "1", "--bogus"]);
  assert.notEqual(code, 0);
  assert.ok(stderr.includes("Unknown argument"));
});

// ── --json flag ──────────────────────────────────────────────────────

test("info.mjs --json with --help still shows usage text", async () => {
  const { code, stdout } = await runNode(["--json", "--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Usage:"));
});

// ── Integration: issue mode (with gh stubs) ──────────────────────────

test("info.mjs --issue produces human-readable output with gh stubs", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "info-test-issue-"));
  try {
    const repoSlug = "test-owner/test-repo";
    const issueNumber = 42;
    const issueBody = "## Summary\nTest issue\n\n## Acceptance Criteria\n- It works";

    // gh stub
    const ghPath = path.join(tmpDir, "gh");
    const ghScript = [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      `const repo = "${repoSlug}";`,
      // gh issue view
      `if (args[0] === "issue" && args[1] === "view") {`,
      `  const issueNum = parseInt(args[2]);`,
      `  if (issueNum === ${issueNumber}) {`,
      `    process.stdout.write(JSON.stringify({`,
      `      number: ${issueNumber},`,
      `      title: "Test issue title",`,
      `      body: ${JSON.stringify(issueBody)},`,
      `      state: "OPEN",`,
      `      labels: [],`,
      `      assignees: [],`,
      `      milestone: null,`,
      `      url: "https://github.com/${repoSlug}/issues/${issueNumber}"`,
      `    }) + "\\n");`,
      `    process.exit(0);`,
      `  }`,
      `  process.exit(1);`,
      `}`,
      // gh pr view (for linked PR - shouldn't happen for no-linkage case)
      `process.exit(1);`,
    ].join("\n");

    await writeFile(ghPath, ghScript);
    await import("fs").then(fs => fs.promises.chmod(ghPath, 0o755));

    // linked-PR stub: no linked PR
    const linkageStubDir = path.join(tmpDir, "stubs");
    await mkdir(linkageStubDir, { recursive: true });
    const fakeLinkagePath = path.join(linkageStubDir, "detect-linked-issue-pr.mjs");
    await writeFile(fakeLinkagePath, [
      "#!/usr/bin/env node",
      "process.stdout.write(JSON.stringify({",
      `  ok: true, repo: "${repoSlug}", issue: ${issueNumber},`,
      "  hasOpenLinkedPr: false, prNumber: null, prUrl: null,",
      "  hasPriorClosedUnmergedPr: false, priorClosedUnmergedPrNumber: null, priorClosedUnmergedPrUrl: null",
      "}) + '\\n');",
    ].join("\n"));

    // startup resolver stub: just emits valid JSON
    const fakeStartupPath = path.join(linkageStubDir, "resolve-dev-loop-startup.mjs");
    await writeFile(fakeStartupPath, [
      "#!/usr/bin/env node",
      "process.stdout.write(JSON.stringify({",
      `  ok: true, bundleKind: "resolved", selectedStrategy: "issue_intake",`,
      `  requiredReads: [], nextAction: "Normalize the issue",`,
      `  canonicalStateSummary: {`,
      `    target: { kind: "issue", issue: ${issueNumber} },`,
      `    ownership: "local", nextActor: "local", status: "active", authorization: "authorized",`,
      `    loopState: "issue_intake_start", routeKind: "route", selectedGate: "issue_intake"`,
      `  },`,
      `  bundle: { loopState: "issue_intake_start", selectedStrategy: "issue_intake", routeKind: "route", nextAction: "Normalize the issue" }`,
      "}) + '\\n');",
    ].join("\n"));

    const { code, stdout, stderr } = await runNode(["--issue", String(issueNumber), "--repo", repoSlug], {
      env: { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` },
      cwd: tmpDir,
    });

    assert.equal(code, 0, `Expected exit 0, got ${code}. stderr: ${stderr}`);
    assert.ok(stdout.includes(`Issue #${issueNumber}`), `Expected "Issue #${issueNumber}" in:\n${stdout}`);
    assert.ok(stdout.includes("Test issue title"), `Expected "Test issue title" in:\n${stdout}`);
    assert.ok(stdout.includes("OPEN"), `Expected "OPEN" in:\n${stdout}`);
    assert.ok(stdout.includes("cceptance criteria: present"), `Expected AC present in:\n${stdout}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: --json output ───────────────────────────────────────

test("info.mjs --issue --json produces valid JSON with gh stubs", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "info-test-json-"));
  try {
    const repoSlug = "test-owner/test-repo";
    const issueNumber = 1;

    const ghPath = path.join(tmpDir, "gh");
    const ghScript = [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      `const repo = "${repoSlug}";`,
      `if (args[0] === "issue" && args[1] === "view") {`,
      `  process.stdout.write(JSON.stringify({`,
      `    number: ${issueNumber}, title: "JSON test", body: "", state: "OPEN",`,
      `    labels: [], assignees: [], milestone: null,`,
      `    url: "https://github.com/${repoSlug}/issues/${issueNumber}"`,
      `  }) + "\\n");`,
      `  process.exit(0);`,
      `}`,
      `process.exit(1);`,
    ].join("\n");

    await writeFile(ghPath, ghScript);
    await import("fs").then(fs => fs.promises.chmod(ghPath, 0o755));

    const stubDir = path.join(tmpDir, "stubs");
    await mkdir(stubDir, { recursive: true });
    await writeFile(path.join(stubDir, "detect-linked-issue-pr.mjs"), [
      "#!/usr/bin/env node",
      `process.stdout.write(JSON.stringify({ ok: true, repo: "${repoSlug}", issue: ${issueNumber}, hasOpenLinkedPr: false, prNumber: null, prUrl: null, hasPriorClosedUnmergedPr: false }) + '\\n');`,
    ].join("\n"));
    await writeFile(path.join(stubDir, "resolve-dev-loop-startup.mjs"), [
      "#!/usr/bin/env node",
      `process.stdout.write(JSON.stringify({ ok: true, bundleKind: "resolved", selectedStrategy: "issue_intake", nextAction: "test", bundle: {} }) + '\\n');`,
    ].join("\n"));

    const { code, stdout, stderr } = await runNode(["--issue", "1", "--repo", repoSlug, "--json"], {
      env: { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` },
      cwd: tmpDir,
    });

    assert.equal(code, 0, `Expected exit 0, got ${code}. stderr: ${stderr}`);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.kind, "issue");
    assert.equal(parsed.issue.number, issueNumber);
    assert.equal(parsed.issue.title, "JSON test");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Repo auto-detection failure ──────────────────────────────────────

test("info.mjs fails gracefully when repo cannot be detected", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "info-test-norepo-"));
  try {
    const { code, stderr } = await runNode(["--issue", "1"], {
      cwd: tmpDir,
    });
    assert.notEqual(code, 0);
    assert.ok(stderr.length > 0, "Expected stderr output on repo detection failure");
    // Should include usage in error output
    assert.ok(stderr.includes("usage") || stderr.includes("Usage") || stderr.includes("origin remote") || stderr.includes("detection"),
      `Expected usage/error hint in stderr, got: ${stderr}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

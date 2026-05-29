import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { parseRemoteFreshnessGuardCliArgs } from "../../scripts/loop/pre-write-remote-freshness-guard.mjs";

const scriptPath = path.resolve("scripts/loop/pre-write-remote-freshness-guard.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
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

async function writeGitStub(tempDir, { commits = [], logFile } = {}) {
  const gitPath = path.join(tempDir, "git");
  const commitOutput = commits.length > 0 ? `${commits.join("\n")}\n` : "";

  await writeFile(
    gitPath,
    [
      "#!/usr/bin/env node",
      "const { appendFileSync } = await import('node:fs');",
      "const args = process.argv.slice(2);",
      "const joined = args.join(' ');",
      "if (process.env.FRESHNESS_GUARD_LOG_FILE) {",
      "  appendFileSync(process.env.FRESHNESS_GUARD_LOG_FILE, `${joined}\\n`);",
      "}",
      "if (args[0] === 'fetch' && args[1] === 'origin' && typeof args[2] === 'string') {",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'log' && typeof args[1] === 'string' && args[2] === '--oneline') {",
      `  process.stdout.write(${JSON.stringify(commitOutput)});`,
      "  process.exit(0);",
      "}",
      "process.stderr.write(`unexpected git args: ${joined}\\n`);",
      "process.exit(1);",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(gitPath, 0o755);

  return {
    ...process.env,
    FRESHNESS_GUARD_LOG_FILE: logFile,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
  };
}

test("parseRemoteFreshnessGuardCliArgs rejects missing --branch", () => {
  assert.throws(() => parseRemoteFreshnessGuardCliArgs([]), /--branch .* is required/i);
});

test("parseRemoteFreshnessGuardCliArgs parses --branch", () => {
  const options = parseRemoteFreshnessGuardCliArgs(["--branch", "copilot/a"]);
  assert.equal(options.branch, "copilot/a");
  assert.equal(options.help, false);
});

test("freshness guard exits 0 when remote branch is up to date", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "freshness-guard-test-"));
  const logFile = path.join(tempDir, "git.log");

  try {
    const env = await writeGitStub(tempDir, { commits: [], logFile });
    const result = await runNode(["--branch", "copilot/expected"], { env });

    assert.equal(result.code, 0, `expected exit 0, got stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.deepEqual(parsed, { ok: true, status: "up_to_date" });

    const gitLog = await readFile(logFile, "utf8");
    assert.equal(gitLog.trim(), "fetch origin copilot/expected\nlog HEAD..origin/copilot/expected --oneline".trim());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("freshness guard exits non-zero with remote_ahead commits list", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "freshness-guard-test-"));
  const logFile = path.join(tempDir, "git.log");

  try {
    const env = await writeGitStub(tempDir, {
      commits: ["abc1234 add guard", "def5678 fix tests"],
      logFile,
    });
    const result = await runNode(["--branch", "copilot/expected"], { env });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stderr.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "remote_ahead");
    assert.deepEqual(parsed.newCommits, ["abc1234 add guard", "def5678 fix tests"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("freshness guard exits non-zero with usage when --branch is missing", async () => {
  const result = await runNode([]);
  assert.equal(result.code, 1);

  const parsed = JSON.parse(result.stderr.trim());
  assert.equal(parsed.ok, false);
  assert.ok(/required/i.test(parsed.error));
  assert.ok(typeof parsed.usage === "string" && parsed.usage.includes("--branch"));
});

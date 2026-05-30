import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { parseBranchGuardCliArgs, runCli } from "../../scripts/loop/pre-commit-branch-guard.mjs";

const scriptPath = path.resolve("scripts/loop/pre-commit-branch-guard.mjs");

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

async function writeGitStub(tempDir, { branch = "copilot/feature-branch", logFile } = {}) {
  const gitPath = path.join(tempDir, "git");
  await writeFile(
    gitPath,
    [
      "#!/usr/bin/env node",
      "const { appendFileSync } = await import('node:fs');",
      "const args = process.argv.slice(2);",
      "const joined = args.join(' ');",
      "if (process.env.BRANCH_GUARD_LOG_FILE) {",
      "  appendFileSync(process.env.BRANCH_GUARD_LOG_FILE, `${joined}\\n`);",
      "}",
      "if (joined === 'branch --show-current') {",
      `  process.stdout.write(${JSON.stringify(`${branch}\n`)});`,
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
    BRANCH_GUARD_LOG_FILE: logFile,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
  };
}

test("parseBranchGuardCliArgs rejects missing --expected-branch", () => {
  assert.throws(() => parseBranchGuardCliArgs([]), /--expected-branch .* is required/i);
});

test("parseBranchGuardCliArgs parses --expected-branch", () => {
  const options = parseBranchGuardCliArgs(["--expected-branch", "copilot/a"]);
  assert.equal(options.expectedBranch, "copilot/a");
  assert.equal(options.help, false);
});

test("branch guard exits 0 when branch matches expected", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "branch-guard-test-"));
  const logFile = path.join(tempDir, "git.log");

  try {
    const env = await writeGitStub(tempDir, { branch: "copilot/expected", logFile });
    const result = await runNode(["--expected-branch", "copilot/expected"], { env });

    assert.equal(result.code, 0, `expected exit 0, got stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.branch, "copilot/expected");
    assert.equal(parsed.matched, true);

    const gitLog = await readFile(logFile, "utf8");
    assert.match(gitLog, /branch --show-current/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("branch guard exits non-zero with structured mismatch error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "branch-guard-test-"));
  const logFile = path.join(tempDir, "git.log");

  try {
    const env = await writeGitStub(tempDir, { branch: "copilot/actual", logFile });
    const result = await runNode(["--expected-branch", "copilot/expected"], { env });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stderr.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "branch_mismatch");
    assert.equal(parsed.current, "copilot/actual");
    assert.equal(parsed.expected, "copilot/expected");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("branch guard exits non-zero with usage when --expected-branch is missing", async () => {
  const result = await runNode([]);
  assert.equal(result.code, 1);

  const parsed = JSON.parse(result.stderr.trim());
  assert.equal(parsed.ok, false);
  assert.ok(/required/i.test(parsed.error));
  assert.ok(typeof parsed.usage === "string" && parsed.usage.includes("--expected-branch"));
});

test("parseBranchGuardCliArgs --help returns help flag", () => {
  const options = parseBranchGuardCliArgs(["--help"]);
  assert.equal(options.help, true);
});

test("parseBranchGuardCliArgs -h returns help flag", () => {
  const options = parseBranchGuardCliArgs(["-h"]);
  assert.equal(options.help, true);
});

test("parseBranchGuardCliArgs rejects unknown argument", () => {
  assert.throws(() => parseBranchGuardCliArgs(["--unknown-flag"]), /Unknown argument/i);
});

test("parseBranchGuardCliArgs rejects flag-like value for --expected-branch", () => {
  assert.throws(
    () => parseBranchGuardCliArgs(["--expected-branch", "--other-flag"]),
    /Missing value for --expected-branch/i,
  );
});

test("branch guard exits 0 and prints usage with --help", async () => {
  const result = await runNode(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--expected-branch/);
});

test("branch guard exits 0 and prints usage with -h", async () => {
  const result = await runNode(["-h"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--expected-branch/);
});

test("branch guard exits non-zero with structured error for unknown argument", async () => {
  const result = await runNode(["--unexpected-arg"]);
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stderr.trim());
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /Unknown argument/i);
});

test("branch guard runCli rejects when git command fails with non-empty stderr", async () => {
  const chunks = [];
  const errChunks = [];
  const out = { write: (c) => chunks.push(c) };
  const err = { write: (c) => errChunks.push(c) };

  await assert.rejects(
    () =>
      runCli(["--expected-branch", "main"], {
        stdout: out,
        stderr: err,
        gitCommand: "this-binary-does-not-exist-xyz",
      }),
    (e) => {
      assert.ok(e instanceof Error);
      return true;
    },
  );
});

test("branch guard runCli rejects when git exits non-zero with empty stderr", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "branch-guard-err-"));
  try {
    const gitPath = path.join(tempDir, "git");
    await writeFile(
      gitPath,
      [
        "#!/usr/bin/env node",
        "process.exit(2);",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(gitPath, 0o755);
    const env = { ...process.env, PATH: `${tempDir}${path.delimiter}${process.env.PATH}` };
    const out = { write: () => {} };
    const err = { write: () => {} };

    await assert.rejects(
      () => runCli(["--expected-branch", "main"], { stdout: out, stderr: err, env }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /exited with code/i);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

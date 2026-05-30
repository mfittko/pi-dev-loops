#!/usr/bin/env node
import { spawn } from "node:child_process";

import { formatCliError, isDirectCliRun } from "../_core-helpers.mjs";

const USAGE = `Usage:
  pre-commit-branch-guard.mjs --expected-branch <name>

Verify the current git branch identity immediately before local commit steps.

Required:
  --expected-branch <name>   Expected current branch name (for example PR headRefName).

Success output (stdout, JSON):
  { "ok": true, "branch": "<current>", "matched": true }

Branch mismatch output (stderr, JSON, exit 1):
  { "ok": false, "error": "branch_mismatch", "current": "<actual>", "expected": "<expected>" }

Usage errors (stderr, JSON, exit 1):
  { "ok": false, "error": "...", "usage": "..." }`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function requireOptionValue(args, flag) {
  const value = args.shift();
  if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) {
    throw parseError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseBranchGuardCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    expectedBranch: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--expected-branch") {
      options.expectedBranch = requireOptionValue(args, "--expected-branch");
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.expectedBranch === undefined) {
    throw parseError("--expected-branch <name> is required");
  }

  return options;
}

function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
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
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim().length > 0 ? stderr.trim() : `${command} exited with code ${code}`));
    });
  });
}


export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = process.cwd(),
    env = process.env,
    gitCommand = "git",
  } = {},
) {
  const options = parseBranchGuardCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return { ok: true, help: true };
  }

  const { stdout: branchOutput } = await runCommand(gitCommand, ["branch", "--show-current"], { cwd, env });
  const currentBranch = branchOutput.trim();

  if (currentBranch === options.expectedBranch) {
    const payload = { ok: true, branch: currentBranch, matched: true };
    stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const payload = {
    ok: false,
    error: "branch_mismatch",
    current: currentBranch,
    expected: options.expectedBranch,
  };

  stderr.write(`${JSON.stringify(payload)}\n`);
  return payload;
}

if (isDirectCliRun(import.meta.url)) {
  runCli()
    .then((result) => {
      if (result?.ok === false) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
}

#!/usr/bin/env node
import { spawn } from "node:child_process";

import { isDirectCliRun } from "../_core-helpers.mjs";

const USAGE = `Usage:
  pre-write-remote-freshness-guard.mjs --branch <name>

Refresh remote branch state before starting local file writes on Copilot-assigned PR work.

Required:
  --branch <name>   Target branch name to fetch and compare against origin/<name>.

Success output (stdout, JSON):
  { "ok": true, "status": "up_to_date" }

Remote ahead output (stderr, JSON, exit 1):
  { "ok": false, "error": "remote_ahead", "newCommits": ["<sha> <subject>", ...] }

Usage errors (stderr, JSON, exit 1):
  { "ok": false, "error": "...", "usage": "..." }`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function requireOptionValue(args, flag) {
  const value = args.shift();
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw parseError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseRemoteFreshnessGuardCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    branch: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--branch") {
      options.branch = requireOptionValue(args, "--branch");
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.branch === undefined) {
    throw parseError("--branch <name> is required");
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

function formatCliError(error) {
  const payload = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof Error && typeof error.usage === "string") {
    payload.usage = error.usage;
  }

  return JSON.stringify(payload);
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
  const options = parseRemoteFreshnessGuardCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return { ok: true, help: true };
  }

  await runCommand(gitCommand, ["fetch", "origin", options.branch], { cwd, env });
  const { stdout: logOutput } = await runCommand(
    gitCommand,
    ["log", `HEAD..origin/${options.branch}`, "--oneline"],
    { cwd, env },
  );

  const newCommits = logOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (newCommits.length === 0) {
    const payload = { ok: true, status: "up_to_date" };
    stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const payload = {
    ok: false,
    error: "remote_ahead",
    newCommits,
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

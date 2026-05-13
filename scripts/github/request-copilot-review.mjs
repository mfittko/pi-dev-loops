#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError } from "../_core-helpers.mjs";

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parsePrNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new Error("--pr must be a positive integer");
  }

  return Number(value);
}

export function parseRequestCliArgs(argv) {
  const args = [...argv];
  const options = {
    repo: undefined,
    pr: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo");
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr"));
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw new Error("Requesting Copilot review requires both --repo <owner/name> and --pr <number>");
  }

  return options;
}

function runChild(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
      resolve({ code, stdout, stderr });
    });
  });
}

function isCopilotReviewer(login) {
  return typeof login === "string" && login.toLowerCase() === "copilot";
}

function parseRequestedReviewersPayload(text) {
  const payload = JSON.parse(text);
  const users = Array.isArray(payload?.users) ? payload.users : [];
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];

  return {
    users,
    teams,
    requested: users.some((user) => isCopilotReviewer(user?.login)),
  };
}

async function fetchRequestedReviewers({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseRequestedReviewersPayload(result.stdout);
}

function classifyRequestFailure(detail) {
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("not a collaborator") ||
    normalized.includes("not requestable") ||
    normalized.includes("copilot review") ||
    normalized.includes("reviews may only be requested")
  ) {
    return "unavailable";
  }

  return undefined;
}

async function requestCopilotReview({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "edit", String(pr), "--repo", repo, "--add-reviewer", "@copilot"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    const classified = classifyRequestFailure(detail);

    if (classified === "unavailable") {
      return {
        ok: true,
        status: "unavailable",
        repo,
        pr,
        reviewer: "Copilot",
        detail,
      };
    }

    throw new Error(`gh command failed: ${detail}`);
  }

  return {
    ok: true,
    status: "requested",
    repo,
    pr,
    reviewer: "Copilot",
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseRequestCliArgs(argv);
  const before = await fetchRequestedReviewers(options, { env, ghCommand });

  if (before.requested) {
    stdout.write(`${JSON.stringify({
      ok: true,
      status: "already-requested",
      repo: options.repo,
      pr: options.pr,
      reviewer: "Copilot",
    })}\n`);
    return;
  }

  const requestResult = await requestCopilotReview(options, { env, ghCommand });

  if (requestResult.status === "unavailable") {
    stdout.write(`${JSON.stringify(requestResult)}\n`);
    return;
  }

  const after = await fetchRequestedReviewers(options, { env, ghCommand });

  if (!after.requested) {
    throw new Error("Copilot review request did not appear in requested reviewers after gh pr edit");
  }

  stdout.write(`${JSON.stringify(requestResult)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

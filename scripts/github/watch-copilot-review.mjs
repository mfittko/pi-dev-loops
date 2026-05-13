#!/usr/bin/env node
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { formatCliError, parseReviewThreads } from "../_core-helpers.mjs";
import { fetchGithubReviewThreadsPayload } from "./capture-review-threads.mjs";

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseNonNegativeInteger(value, flag) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }

  return Number(value);
}

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return Number(value);
}

export function parseWatchCliArgs(argv) {
  const args = [...argv];
  const options = {
    repo: undefined,
    pr: undefined,
    pollIntervalMs: 1000,
    timeoutMs: 60_000,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo");
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePositiveInteger(requireOptionValue(args, "--pr"), "--pr");
      continue;
    }

    if (token === "--poll-interval-ms") {
      options.pollIntervalMs = parsePositiveInteger(requireOptionValue(args, "--poll-interval-ms"), "--poll-interval-ms");
      continue;
    }

    if (token === "--timeout-ms") {
      options.timeoutMs = parseNonNegativeInteger(requireOptionValue(args, "--timeout-ms"), "--timeout-ms");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw new Error("Watching Copilot review requires both --repo <owner/name> and --pr <number>");
  }

  return options;
}

function isCopilotLogin(login) {
  return typeof login === "string" && /^copilot(?:[^a-z]|$)/i.test(login);
}

export function findFreshCopilotComments(baseline, current) {
  const baselineIds = new Set((baseline?.comments ?? []).map((comment) => comment.id));

  return (current?.comments ?? [])
    .filter((comment) => !baselineIds.has(comment.id))
    .filter((comment) => isCopilotLogin(comment.author?.login))
    .map((comment) => ({
      id: comment.id,
      threadId: comment.threadId,
      authorLogin: comment.author?.login ?? "",
      body: comment.body,
    }));
}

function buildNoChangePayload(status, repo, pr, attempts) {
  return {
    ok: true,
    status,
    repo,
    pr,
    attempts,
    newComments: [],
  };
}

function buildAttemptBudget(timeoutMs, pollIntervalMs) {
  if (timeoutMs === 0) {
    return 1;
  }

  return Math.max(1, Math.floor(timeoutMs / pollIntervalMs));
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseWatchCliArgs(argv);
  const baseline = parseReviewThreads(await fetchGithubReviewThreadsPayload(
    { repo: options.repo, pr: options.pr },
    { env, ghCommand },
  ));
  const attemptBudget = buildAttemptBudget(options.timeoutMs, options.pollIntervalMs);

  for (let attempt = 1; attempt <= attemptBudget; attempt += 1) {
    if (!(options.timeoutMs === 0 && attempt === 1)) {
      await delay(options.pollIntervalMs);
    }

    const current = parseReviewThreads(await fetchGithubReviewThreadsPayload(
      { repo: options.repo, pr: options.pr },
      { env, ghCommand },
    ));
    const newComments = findFreshCopilotComments(baseline, current);

    if (newComments.length > 0) {
      stdout.write(`${JSON.stringify({
        ok: true,
        status: "changed",
        repo: options.repo,
        pr: options.pr,
        attempts: attempt,
        newComments,
      })}\n`);
      return;
    }
  }

  const status = options.timeoutMs === 0 ? "idle" : "timeout";
  stdout.write(`${JSON.stringify(buildNoChangePayload(status, options.repo, options.pr, attemptBudget))}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { formatCliError, parseJsonText, parseReviewThreads } from "../_core-helpers.mjs";
import { parseRepoSlug } from "./capture-review-threads.mjs";

const COPILOT_ACTIVITY_QUERY = [
  "query($owner: String!, $name: String!, $pr: Int!) {",
  "  repository(owner: $owner, name: $name) {",
  "    pullRequest(number: $pr) {",
  "      reviewThreads(first: 100) {",
  "        nodes {",
  "          id",
  "          isResolved",
  "          comments(first: 100) {",
  "            nodes {",
  "              id",
  "              body",
  "              author {",
  "                login",
  "                __typename",
  "              }",
  "            }",
  "          }",
  "        }",
  "      }",
  "      reviews(first: 100) {",
  "        nodes {",
  "          id",
  "          body",
  "          author {",
  "            login",
  "            __typename",
  "          }",
  "        }",
  "      }",
  "      comments(first: 100) {",
  "        nodes {",
  "          id",
  "          body",
  "          author {",
  "            login",
  "            __typename",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

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

async function fetchGithubCopilotActivityPayload(
  { repo, pr },
  { env = process.env, ghCommand = "gh" } = {},
) {
  const { owner, name } = parseRepoSlug(repo);
  const result = await runChild(
    ghCommand,
    [
      "api",
      "graphql",
      "--field",
      `owner=${owner}`,
      "--field",
      `name=${name}`,
      "--field",
      `pr=${pr}`,
      "--field",
      `query=${COPILOT_ACTIVITY_QUERY}`,
    ],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseJsonText(result.stdout);
}

function normalizeAuthorLogin(author) {
  return typeof author?.login === "string" ? author.login : "";
}

function normalizeBody(body) {
  return typeof body === "string" ? body.trim() : "";
}

function extractCopilotReviews(payload) {
  const reviews = payload?.data?.repository?.pullRequest?.reviews?.nodes;

  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews
    .filter((review) => isCopilotLogin(normalizeAuthorLogin(review?.author)))
    .map((review) => ({
      id: String(review?.id ?? ""),
      authorLogin: normalizeAuthorLogin(review?.author),
      body: normalizeBody(review?.body),
    }))
    .filter((review) => review.id.length > 0);
}

function extractCopilotIssueComments(payload) {
  const comments = payload?.data?.repository?.pullRequest?.comments?.nodes;

  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .filter((comment) => isCopilotLogin(normalizeAuthorLogin(comment?.author)))
    .map((comment) => ({
      id: String(comment?.id ?? ""),
      authorLogin: normalizeAuthorLogin(comment?.author),
      body: normalizeBody(comment?.body),
    }))
    .filter((comment) => comment.id.length > 0);
}

function parseCopilotActivity(payload) {
  const parsedThreads = parseReviewThreads(payload);
  const newComments = (parsedThreads?.comments ?? [])
    .filter((comment) => isCopilotLogin(comment.author?.login))
    .map((comment) => ({
      id: comment.id,
      threadId: comment.threadId,
      authorLogin: comment.author?.login ?? "",
      body: comment.body,
    }));

  return {
    reviewThreadComments: newComments,
    reviews: extractCopilotReviews(payload),
    issueComments: extractCopilotIssueComments(payload),
  };
}

export function findFreshCopilotActivity(baseline, current) {
  const baselineCommentIds = new Set((baseline?.reviewThreadComments ?? []).map((comment) => comment.id));
  const baselineReviewIds = new Set((baseline?.reviews ?? []).map((review) => review.id));
  const baselineIssueCommentIds = new Set((baseline?.issueComments ?? []).map((comment) => comment.id));

  return {
    newComments: (current?.reviewThreadComments ?? []).filter((comment) => !baselineCommentIds.has(comment.id)),
    newReviews: (current?.reviews ?? []).filter((review) => !baselineReviewIds.has(review.id)),
    newIssueComments: (current?.issueComments ?? []).filter((comment) => !baselineIssueCommentIds.has(comment.id)),
  };
}

function buildNoChangePayload(status, repo, pr, attempts) {
  return {
    ok: true,
    status,
    repo,
    pr,
    attempts,
    newComments: [],
    newReviews: [],
    newIssueComments: [],
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
  const baseline = parseCopilotActivity(await fetchGithubCopilotActivityPayload(
    { repo: options.repo, pr: options.pr },
    { env, ghCommand },
  ));
  const attemptBudget = buildAttemptBudget(options.timeoutMs, options.pollIntervalMs);

  for (let attempt = 1; attempt <= attemptBudget; attempt += 1) {
    if (!(options.timeoutMs === 0 && attempt === 1)) {
      await delay(options.pollIntervalMs);
    }

    const current = parseCopilotActivity(await fetchGithubCopilotActivityPayload(
      { repo: options.repo, pr: options.pr },
      { env, ghCommand },
    ));
    const activity = findFreshCopilotActivity(baseline, current);

    if (activity.newComments.length > 0 || activity.newReviews.length > 0 || activity.newIssueComments.length > 0) {
      stdout.write(`${JSON.stringify({
        ok: true,
        status: "changed",
        repo: options.repo,
        pr: options.pr,
        attempts: attempt,
        ...activity,
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

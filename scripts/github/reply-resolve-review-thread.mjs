#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { formatCliError, isDirectCliRun, parseReviewThreads } from "../_core-helpers.mjs";
import { fetchGithubReviewThreadsPayload, parseRepoSlug } from "./capture-review-threads.mjs";

const RESOLVE_REVIEW_THREAD_MUTATION = [
  "mutation($threadId: ID!) {",
  "  resolveReviewThread(input: { threadId: $threadId }) {",
  "    thread {",
  "      id",
  "      isResolved",
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

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return Number(value);
}

export function parseReplyResolveCliArgs(argv) {
  const args = [...argv];
  const options = {
    repo: undefined,
    pr: undefined,
    commentId: undefined,
    threadId: undefined,
    bodyFile: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo").trim();
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePositiveInteger(requireOptionValue(args, "--pr"), "--pr");
      continue;
    }

    if (token === "--comment-id") {
      options.commentId = parsePositiveInteger(requireOptionValue(args, "--comment-id"), "--comment-id");
      continue;
    }

    if (token === "--thread-id") {
      options.threadId = requireOptionValue(args, "--thread-id");
      continue;
    }

    if (token === "--body-file") {
      options.bodyFile = requireOptionValue(args, "--body-file");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.repo || !options.pr || !options.commentId || !options.threadId || !options.bodyFile) {
    throw new Error(
      "Replying and resolving a review thread requires --repo <owner/name>, --pr <number>, --comment-id <number>, --thread-id <node-id>, and --body-file <path>",
    );
  }

  parseRepoSlug(options.repo);

  return options;
}

function runChild(command, args, env, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    if (stdinText === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(stdinText);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from gh: ${text.trim() || "<empty>"}`);
  }
}

function parseReplyPayload(payload) {
  const replyId = payload?.id;
  const replyUrl = payload?.html_url;

  if (!Number.isFinite(replyId) || typeof replyUrl !== "string" || replyUrl.trim().length === 0) {
    throw new Error("Reply payload from gh did not include both id and html_url");
  }

  return {
    replyId,
    replyUrl,
  };
}

async function validateReplyTarget(
  { repo, pr, commentId, threadId },
  { env = process.env, ghCommand = "gh" } = {},
) {
  const payload = await fetchGithubReviewThreadsPayload({ repo, pr }, { env, ghCommand });
  const parsed = parseReviewThreads(payload);
  const targetCommentId = String(commentId);
  const thread = parsed.threads.find((entry) => entry.id === threadId) ?? null;
  const comment = parsed.comments.find((entry) => entry.databaseId === targetCommentId) ?? null;

  if (thread === null) {
    throw new Error(`Review thread ${threadId} was not found on pull request ${repo}#${pr}`);
  }

  if (comment === null) {
    throw new Error(`Review comment ${commentId} was not found on pull request ${repo}#${pr}`);
  }

  if (comment.threadId !== threadId) {
    throw new Error(`Review comment ${commentId} does not belong to review thread ${threadId} on pull request ${repo}#${pr}`);
  }
}

async function postReply({ repo, pr, commentId, body }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    [
      "api",
      "-X",
      "POST",
      `repos/${repo}/pulls/${pr}/comments/${commentId}/replies`,
      "--input",
      "-",
    ],
    env,
    `${JSON.stringify({ body })}\n`,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseJson(result.stdout);
}

async function resolveThread(threadId, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    [
      "api",
      "graphql",
      "--field",
      `threadId=${threadId}`,
      "--field",
      `query=${RESOLVE_REVIEW_THREAD_MUTATION}`,
    ],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  const payload = parseJson(result.stdout);
  return payload?.data?.resolveReviewThread?.thread;
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseReplyResolveCliArgs(argv);
  const rawBody = await readFile(options.bodyFile, "utf8");

  if (rawBody.trim().length === 0) {
    throw new Error("--body-file must contain non-empty text");
  }

  await validateReplyTarget(
    {
      repo: options.repo,
      pr: options.pr,
      commentId: options.commentId,
      threadId: options.threadId,
    },
    { env, ghCommand },
  );

  const reply = parseReplyPayload(await postReply(
    {
      repo: options.repo,
      pr: options.pr,
      commentId: options.commentId,
      body: rawBody,
    },
    { env, ghCommand },
  ));
  const resolvedThread = await resolveThread(options.threadId, { env, ghCommand });

  if (!resolvedThread?.isResolved) {
    throw new Error(`Review thread did not resolve successfully: ${options.threadId}`);
  }

  stdout.write(`${JSON.stringify({
    ok: true,
    repo: options.repo,
    pr: options.pr,
    commentId: options.commentId,
    threadId: options.threadId,
    replyId: reply.replyId,
    replyUrl: reply.replyUrl,
    resolved: true,
  })}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

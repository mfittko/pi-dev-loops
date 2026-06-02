#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { parsePositiveInteger, requireOptionValue } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import {
  replyAndMaybeResolve,
  validateResolutionMessage,
} from "./_review-thread-mutations.mjs";

export { hasCommitShaReference } from "./_review-thread-mutations.mjs";

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

  validateResolutionMessage(rawBody);

  const result = await replyAndMaybeResolve(
    {
      repo: options.repo,
      pr: options.pr,
      commentId: options.commentId,
      threadId: options.threadId,
      body: rawBody,
      resolve: true,
    },
    { env, ghCommand },
  );

  stdout.write(`${JSON.stringify({
    ok: true,
    repo: options.repo,
    pr: options.pr,
    commentId: options.commentId,
    threadId: options.threadId,
    replyId: result.replyId,
    replyUrl: result.replyUrl,
    resolved: true,
  })}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError, isCopilotLogin, summarizeCopilotReviews } from "../_core-helpers.mjs";
import { parseRepoSlug } from "./capture-review-threads.mjs";

const USAGE = `Usage: request-copilot-review.mjs --repo <owner/name> --pr <number>

Request Copilot as a reviewer on a GitHub pull request.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Output (stdout, JSON):
  { "ok": true, "status": "requested"|"already-requested"|"unavailable", "repo": "...", "pr": N, "reviewer": "Copilot", "detail"?: "..." }

Request statuses:
  requested           Copilot review was successfully requested
  already-requested   Copilot review was already observably in progress; no new request needed
  unavailable         Copilot review is not enabled/requestable and no in-progress evidence was found

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success (including unavailable)
  1  Argument error or gh failure`.trim();

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

function parsePrNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw parseError("--pr must be a positive integer");
  }

  return Number(value);
}

export function parseRequestCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo").trim();
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr"));
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("Requesting Copilot review requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
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

function parseRequestedReviewersPayload(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from gh: ${text.trim() || "<empty>"}`);
  }

  const users = Array.isArray(payload?.users) ? payload.users : [];
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];

  return {
    users,
    teams,
    requested: users.some((user) => isCopilotLogin(user?.login)),
  };
}

function parseReviewsPayload(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from gh: ${text.trim() || "<empty>"}`);
  }

  const headSha = typeof payload?.headRefOid === "string" && payload.headRefOid.trim().length > 0
    ? payload.headRefOid.trim()
    : null;
  const reviewSummary = summarizeCopilotReviews(payload?.reviews, { headSha });

  return {
    headSha,
    copilotReviewIds: reviewSummary.copilotReviewIds,
    hasCopilotPendingReview: reviewSummary.hasPendingReviewOnCurrentHead,
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

async function fetchCopilotReviewIds({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid,reviews"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  return parseReviewsPayload(result.stdout);
}

async function fetchCopilotReviewState(options, runtime) {
  const requestedReviewers = await fetchRequestedReviewers(options, runtime);
  const reviews = await fetchCopilotReviewIds(options, runtime);

  return {
    requested: requestedReviewers.requested,
    copilotReviewIds: reviews.copilotReviewIds,
    hasPendingReview: reviews.hasCopilotPendingReview,
  };
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

/**
 * Perform the full Copilot review-request logic and return the result payload.
 * Exported for use by higher-level orchestration helpers.
 */
export async function performCopilotReviewRequest(options, { env = process.env, ghCommand = "gh" } = {}) {
  const before = await fetchCopilotReviewState(options, { env, ghCommand });

  if (before.requested || before.hasPendingReview) {
    return {
      ok: true,
      status: "already-requested",
      repo: options.repo,
      pr: options.pr,
      reviewer: "Copilot",
    };
  }

  const requestResult = await requestCopilotReview(options, { env, ghCommand });

  if (requestResult.status === "unavailable") {
    // Post-failure verification: even when the explicit request path is rejected,
    // Copilot review may already be in progress if GitHub internally queued it.
    // Check for observable in-progress evidence before treating this as a terminal stop.
    const after = await fetchCopilotReviewState(options, { env, ghCommand });
    if (after.requested || after.hasPendingReview) {
      return {
        ok: true,
        status: "already-requested",
        repo: options.repo,
        pr: options.pr,
        reviewer: "Copilot",
      };
    }
    return requestResult;
  }

  const after = await fetchCopilotReviewState(options, { env, ghCommand });
  const reviewCountIncreased = after.copilotReviewIds.length > before.copilotReviewIds.length;
  const reviewNowObservablyInProgress = after.requested || after.hasPendingReview || reviewCountIncreased;

  if (!reviewNowObservablyInProgress) {
    throw new Error("Copilot review request did not appear in requested reviewers or fresh/in-progress Copilot reviews after gh pr edit");
  }

  return requestResult;
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

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await performCopilotReviewRequest(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

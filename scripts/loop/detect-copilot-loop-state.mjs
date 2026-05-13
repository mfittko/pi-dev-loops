#!/usr/bin/env node
/**
 * Deterministic Copilot-loop state detector.
 *
 * Two modes:
 *
 * 1. Auto-detect (--repo <owner/name> --pr <number>)
 *    Fetches current PR/GitHub facts and interprets the loop state.
 *
 * 2. Snapshot interpretation (--input <path>)
 *    Reads a pre-built snapshot JSON and interprets it without any gh calls.
 *    Use this mode when the caller has already gathered facts (e.g. incorporating
 *    the result of scripts/github/request-copilot-review.mjs which can report
 *    historical request-attempt outcomes like "already-requested", "unavailable",
 *    or "failed" that are not fully observable from static state alone).
 *
 * Optional (auto-detect mode only):
 *   --review-request-status <requested|already-requested|unavailable|none|failed>
 *     Override the Copilot review request status with a known prior result.
 *     Useful when the caller already ran request-copilot-review.mjs and wants
 *     to inject its output status without re-probing the reviewers endpoint.
 *
 * Success output shape:
 *   { "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "..." }
 *
 * Failure behavior:
 *   Malformed arguments, gh/GitHub failures, and incomplete review-thread detection
 *   emit { "ok": false, "error": "..." } on stderr and exit non-zero.
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError, parseJsonText, parseReviewThreads } from "../_core-helpers.mjs";
import { parseRepoSlug, fetchGithubReviewThreadsPayload } from "../github/capture-review-threads.mjs";
import { interpretLoopState, normalizeSnapshot } from "../../packages/core/src/loop/copilot-loop-state.mjs";

const VALID_OVERRIDE_STATUSES = new Set(["requested", "already-requested", "unavailable", "none", "failed"]);

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

export function parseDetectCliArgs(argv) {
  const args = [...argv];
  const options = {
    inputPath: undefined,
    repo: undefined,
    pr: undefined,
    reviewRequestStatusOverride: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--input") {
      options.inputPath = requireOptionValue(args, "--input");
      continue;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo").trim();
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr"));
      continue;
    }

    if (token === "--review-request-status") {
      const val = requireOptionValue(args, "--review-request-status");
      if (!VALID_OVERRIDE_STATUSES.has(val)) {
        throw new Error(`--review-request-status must be one of: ${[...VALID_OVERRIDE_STATUSES].join(", ")}`);
      }
      options.reviewRequestStatusOverride = val;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (options.inputPath !== undefined) {
    if (options.repo !== undefined || options.pr !== undefined) {
      throw new Error("Choose exactly one input source: --input <path> or --repo/--pr auto-detect");
    }
    if (options.reviewRequestStatusOverride !== undefined) {
      throw new Error("--review-request-status cannot be combined with --input");
    }
    return options;
  }

  const hasRepo = options.repo !== undefined;
  const hasPr = options.pr !== undefined;

  if (hasRepo || hasPr) {
    if (!hasRepo || !hasPr) {
      throw new Error("Auto-detect mode requires both --repo <owner/name> and --pr <number>");
    }
    parseRepoSlug(options.repo);
  } else {
    throw new Error("Provide either --input <path> or --repo <owner/name> --pr <number>");
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

function isCopilotLogin(login) {
  return typeof login === "string" && /^copilot(?:[^a-z]|$)/i.test(login);
}

/**
 * Fetch basic PR info: isDraft, state (OPEN/CLOSED/MERGED), number, reviews, statusCheckRollup.
 */
async function fetchPrView({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "isDraft,state,number,reviews,statusCheckRollup"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    // gh exits 1 with "no pull requests found" when the PR does not exist
    if (/no pull requests found/i.test(detail) || /could not find pull request/i.test(detail)) {
      return null;
    }
    throw new Error(`gh command failed: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }

  return payload;
}

/**
 * Fetch whether Copilot is currently in the PR's requested_reviewers list.
 */
async function fetchCopilotRequested({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }

  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.some((user) => isCopilotLogin(user?.login));
}

/**
 * Map a gh statusCheckRollup array to a normalized ciStatus string.
 */
function normalizeCiStatus(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return "none";
  }

  const FAILURE_CONCLUSIONS = new Set(["FAILURE", "ACTION_REQUIRED", "TIMED_OUT", "STARTUP_FAILURE"]);

  let hasPending = false;
  let hasFailure = false;

  for (const check of rollup) {
    const status = typeof check.status === "string" ? check.status.toUpperCase() : "";
    const conclusion = typeof check.conclusion === "string" ? check.conclusion.toUpperCase() : "";

    if (status === "COMPLETED" && FAILURE_CONCLUSIONS.has(conclusion)) {
      hasFailure = true;
      continue;
    }

    if (status !== "COMPLETED") {
      hasPending = true;
    }
  }

  if (hasFailure) return "failure";
  if (hasPending) return "pending";
  return "success";
}

/**
 * Auto-detect the current loop snapshot by querying GitHub.
 */
async function autoDetectSnapshot({ repo, pr, reviewRequestStatusOverride }, { env, ghCommand }) {
  const prData = await fetchPrView({ repo, pr }, { env, ghCommand });

  if (prData === null) {
    return normalizeSnapshot({ prExists: false });
  }

  const prState = typeof prData.state === "string" ? prData.state.toUpperCase() : "OPEN";
  const prMerged = prState === "MERGED";
  const prClosed = prState === "CLOSED";

  // For merged/closed PRs we can return early without further gh calls
  if (prMerged || prClosed) {
    return normalizeSnapshot({
      prExists: true,
      prNumber: typeof prData.number === "number" ? prData.number : pr,
      prMerged,
      prClosed,
    });
  }

  const isDraft = Boolean(prData.isDraft);
  const reviews = Array.isArray(prData.reviews) ? prData.reviews : [];
  const copilotReviewPresent = reviews.some((review) => isCopilotLogin(review?.author?.login));
  const ciStatus = normalizeCiStatus(prData.statusCheckRollup);

  // Determine review request status
  let copilotReviewRequestStatus;
  if (reviewRequestStatusOverride !== undefined) {
    copilotReviewRequestStatus = reviewRequestStatusOverride;
  } else {
    const copilotRequested = await fetchCopilotRequested({ repo, pr }, { env, ghCommand });
    copilotReviewRequestStatus = copilotRequested ? "requested" : "none";
  }

  // Fetch review threads for unresolved counts. This must fail closed: if we
  // cannot determine thread state, the loop cannot safely choose a wait or
  // re-request path.
  let unresolvedThreadCount = 0;
  let actionableThreadCount = 0;

  try {
    const threadsPayload = await fetchGithubReviewThreadsPayload({ repo, pr }, { env, ghCommand });
    const parsed = parseReviewThreads(threadsPayload);
    unresolvedThreadCount = parsed.summary.unresolvedThreads;
    actionableThreadCount = parsed.summary.actionableThreads;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not determine review-thread state: ${detail}`);
  }

  return normalizeSnapshot({
    prExists: true,
    prNumber: typeof prData.number === "number" ? prData.number : pr,
    prDraft: isDraft,
    prMerged: false,
    prClosed: false,
    copilotReviewRequestStatus,
    copilotReviewPresent,
    unresolvedThreadCount,
    actionableThreadCount,
    ciStatus,
  });
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseDetectCliArgs(argv);

  let snapshot;

  if (options.inputPath !== undefined) {
    const text = await readFile(options.inputPath, "utf8");
    snapshot = normalizeSnapshot(parseJsonText(text));
  } else {
    snapshot = await autoDetectSnapshot(
      { repo: options.repo, pr: options.pr, reviewRequestStatusOverride: options.reviewRequestStatusOverride },
      { env, ghCommand },
    );
  }

  const interpretation = interpretLoopState(snapshot);

  stdout.write(`${JSON.stringify({
    ok: true,
    snapshot,
    state: interpretation.state,
    allowedTransitions: interpretation.allowedTransitions,
    nextAction: interpretation.nextAction,
  })}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

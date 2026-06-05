#!/usr/bin/env node
/**
 * Deterministic reviewer-loop state detector.
 *
 * Two modes:
 * 1) --input <path> snapshot interpretation
 * 2) --repo <owner/name> --pr <number> auto-detect from GitHub (+ optional local state file)
 *
 * Exit codes:
 *   0   Success
 *   1   Error
 */
import { readFile } from "node:fs/promises";

import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import {
  interpretReviewerLoopState,
  normalizeReviewerSnapshot,
} from "@pi-dev-loops/core/loop/reviewer-loop-state";

const HELP = `Usage: detect-reviewer-loop-state.mjs [--input <path> | --repo <owner/name> --pr <number>] [--reviewer-login <login>] [--review-requested <true|false>] [--local-state <path>]

Detect reviewer loop state for a pull request.

Modes:
  --input <path>                Interpret a JSON snapshot from stdin or file
  --repo <owner/name> --pr <n>  Auto-detect state from GitHub PR

Options (auto-detect mode only):
  --reviewer-login <login>      Filter reviews by reviewer login
  --review-requested <bool>     Override review-requested detection (true/false)
  --local-state <path>          Path to local state file for snapshot merging

Exit codes:
  0   Success
  1   Error
`;

function parseBool(value, flag) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false`);
}

function parseReviewerLogin(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("--reviewer-login must not be empty");
  }
  return normalized;
}

export function parseDetectReviewerCliArgs(argv) {
  const args = [...argv];
  const options = {
    inputPath: undefined,
    repo: undefined,
    pr: undefined,
    reviewerLogin: undefined,
    reviewRequestedOverride: undefined,
    localStatePath: undefined,
  };

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    process.exit(0);
  }

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

    if (token === "--reviewer-login") {
      options.reviewerLogin = parseReviewerLogin(requireOptionValue(args, "--reviewer-login"));
      continue;
    }

    if (token === "--review-requested") {
      options.reviewRequestedOverride = parseBool(
        requireOptionValue(args, "--review-requested"),
        "--review-requested",
      );
      continue;
    }

    if (token === "--local-state") {
      options.localStatePath = requireOptionValue(args, "--local-state");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (options.inputPath !== undefined) {
    if (options.repo !== undefined || options.pr !== undefined) {
      throw new Error("Choose exactly one input source: --input <path> or --repo/--pr auto-detect");
    }
    const hasInputOnlyConflict = options.localStatePath !== undefined
      || options.reviewRequestedOverride !== undefined
      || options.reviewerLogin !== undefined;
    if (hasInputOnlyConflict) {
      throw new Error("--input cannot be combined with --reviewer-login, --review-requested, or --local-state");
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

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }
}

async function fetchPrView({ repo, pr }, deps) {
  const result = await runChild(
    deps.ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "isDraft,state,number,headRefOid"],
    deps.env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    if (/no pull requests found/i.test(detail) || /could not find pull request/i.test(detail)) {
      return null;
    }
    throw new Error(`gh command failed: ${detail}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }
}

/**
 * Check whether a PR review belongs to the reviewer scope.
 * Accepts either `user.login` (GitHub REST shape) or `author.login` (fixture/fallback shape).
 * When no reviewer login is provided, all reviews are considered in scope.
 *
 * @param {object} review
 * @param {string|undefined} reviewerLogin
 * @returns {boolean}
 */
function isReviewInScope(review, reviewerLogin) {
  if (!reviewerLogin) {
    // Without a reviewer scope, include all reviews so detector state reflects
    // any pending/submitted review activity on the PR.
    return true;
  }
  // REST `/pulls/{pr}/reviews` uses `user.login`; tests and fallback payload shims in
  // this repo may expose reviewer identity under `author.login`, so support both.
  const login = typeof review?.user?.login === "string"
    ? review.user.login
    : (typeof review?.author?.login === "string" ? review.author.login : "");
  return login.toLowerCase() === reviewerLogin.toLowerCase();
}

/**
 * Return true when a GitHub review state represents a submitted (non-pending) review.
 *
 * @param {string} state
 * @returns {boolean}
 */
function isSubmittedReviewState(state) {
  return ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(state);
}

/**
 * Return the item with the highest numeric `id`.
 *
 * @param {Array<object>} items
 * @returns {object|null}
 */
function pickLatestById(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  return items
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const aid = typeof a.id === "number" ? a.id : -1;
      const bid = typeof b.id === "number" ? b.id : -1;
      return bid - aid;
    })[0] ?? null;
}

async function fetchReviewRequested({ repo, pr, reviewerLogin, reviewRequestedOverride }, deps) {
  if (typeof reviewRequestedOverride === "boolean") {
    return reviewRequestedOverride;
  }

  const payload = await runGhJson(["api", `repos/${repo}/pulls/${pr}/requested_reviewers`], deps);
  const users = Array.isArray(payload?.users) ? payload.users : [];

  if (reviewerLogin) {
    return users.some((user) => {
      const login = typeof user?.login === "string" ? user.login : "";
      return login.toLowerCase() === reviewerLogin.toLowerCase();
    });
  }

  return users.length > 0;
}

async function fetchReviewState({ repo, pr, reviewerLogin }, deps) {
  const payload = await runGhJson(["api", `repos/${repo}/pulls/${pr}/reviews`], deps);
  const reviews = Array.isArray(payload) ? payload : [];
  const scoped = reviews.filter((review) => isReviewInScope(review, reviewerLogin));

  const pendingReview = pickLatestById(
    scoped.filter((review) => String(review?.state || "").toUpperCase() === "PENDING"),
  );
  const submittedReview = pickLatestById(
    scoped.filter((review) => isSubmittedReviewState(String(review?.state || "").toUpperCase())),
  );

  return {
    draftReviewPosted: Boolean(pendingReview),
    draftReviewId: typeof pendingReview?.id === "number" ? pendingReview.id : null,
    draftReviewUrl: typeof pendingReview?.html_url === "string" ? pendingReview.html_url : null,
    draftReviewCommitSha: typeof pendingReview?.commit_id === "string" ? pendingReview.commit_id : null,
    submittedReviewPresent: Boolean(submittedReview),
    submittedReviewCommitSha: typeof submittedReview?.commit_id === "string" ? submittedReview.commit_id : null,
    submittedReviewState: typeof submittedReview?.state === "string" ? submittedReview.state.toUpperCase() : null,
  };
}

async function readLocalState(pathname) {
  if (!pathname) {
    return {};
  }

  let text;
  try {
    text = await readFile(pathname, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const parsed = parseJsonText(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Local state file must contain a JSON object");
  }

  return parsed;
}

export async function autoDetectReviewerSnapshot(
  { repo, pr, reviewerLogin, reviewRequestedOverride, localStatePath },
  deps,
) {
  const prView = await fetchPrView({ repo, pr }, deps);

  if (prView === null) {
    return normalizeReviewerSnapshot({
      prExists: false,
      reviewerLogin,
    });
  }

  const localState = await readLocalState(localStatePath);
  const prState = typeof prView.state === "string" ? prView.state.toUpperCase() : "OPEN";
  const prMerged = prState === "MERGED";
  const prClosed = prState === "CLOSED";

  if (prMerged || prClosed) {
    return normalizeReviewerSnapshot({
      ...localState,
      prExists: true,
      prNumber: typeof prView.number === "number" ? prView.number : pr,
      prMerged,
      prClosed,
      prHeadSha: typeof prView.headRefOid === "string" ? prView.headRefOid : null,
      reviewerLogin,
    });
  }

  const reviewRequested = await fetchReviewRequested(
    { repo, pr, reviewerLogin, reviewRequestedOverride },
    deps,
  );

  const reviewState = await fetchReviewState({ repo, pr, reviewerLogin }, deps);

  return normalizeReviewerSnapshot({
    ...localState,
    prExists: true,
    prNumber: typeof prView.number === "number" ? prView.number : pr,
    prDraft: Boolean(prView.isDraft),
    prMerged: false,
    prClosed: false,
    prHeadSha: typeof prView.headRefOid === "string" ? prView.headRefOid : null,
    reviewerLogin,
    reviewRequested,
    ...reviewState,
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
  const options = parseDetectReviewerCliArgs(argv);

  let snapshot;
  if (options.inputPath) {
    const text = await readFile(options.inputPath, "utf8");
    snapshot = normalizeReviewerSnapshot(parseJsonText(text));
  } else {
    snapshot = await autoDetectReviewerSnapshot(options, { env, ghCommand });
  }

  const interpretation = interpretReviewerLoopState(snapshot);

  stdout.write(`${JSON.stringify({
    ok: true,
    snapshot,
    state: interpretation.state,
    allowedTransitions: interpretation.allowedTransitions,
    nextAction: interpretation.nextAction,
  })}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

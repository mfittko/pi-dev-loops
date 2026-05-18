#!/usr/bin/env node
/**
 * Thin high-level helper for the common Copilot PR follow-up handoff path.
 *
 * Flow:
 *   1. Detect current Copilot-loop state for the given PR.
 *   2. If the state suggests requesting review (pr_ready_no_feedback, or
 *      ready_to_rerequest_review when a meaningful remediation event made
 *      automatic re-request eligible), request Copilot review and re-interpret
 *      the state with the confirmed review-request status.
 *      An explicit operator override can force another same-head request.
 *   3. Emit a single JSON payload describing the current state, the
 *      recommended action ("watch", "fix", or "stop"), and — when the action
 *      is "watch" — the exact watch parameters to pass to watch-copilot-review.mjs.
 *
 * This helper does not run the full fix loop and does not perform any GitHub
 * mutations beyond the explicit Copilot review request step.
 *
 * Success output shape:
 *   { "ok": true, "action": "watch"|"fix"|"stop", "state": "...",
 *     "allowedTransitions": [...], "nextAction": "...", "snapshot": {...},
 *     "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false,
 *     "reviewRequestStatus"?: "...", "watchArgs"?: { "repo": "...", "pr": N,
 *     "pollIntervalMs": N, "timeoutMs": N } }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   gh failures emit { "ok": false, "error": "..." } on stderr and exit non-zero.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../github/capture-review-threads.mjs";
import { autoDetectSnapshot } from "./detect-copilot-loop-state.mjs";
import { performCopilotReviewRequest } from "../github/request-copilot-review.mjs";
import { interpretLoopState, normalizeSnapshot, STATE } from "../../packages/core/src/loop/copilot-loop-state.mjs";

const USAGE = `Usage: copilot-pr-handoff.mjs --repo <owner/name> --pr <number> [--force-rerequest-review]

Detect the Copilot-loop state for a PR, request Copilot review only when
a new request is still needed, and emit the recommended next action with
exact parameters.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Optional:
  --force-rerequest-review  Force a Copilot re-request even when automatic
                            same-head suppression is active

Output (stdout, JSON):
  { "ok": true, "action": "watch"|"fix"|"stop", "state": "...",
    "allowedTransitions": [...], "nextAction": "...", "snapshot": {...},
    "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false,
    "reviewRequestStatus"?: "...",
    "watchArgs"?: { "repo": "...", "pr": N, "pollIntervalMs": N, "timeoutMs": N } }

Actions:
  watch   Copilot review was requested; use watchArgs with watch-copilot-review.mjs
  fix     Unresolved feedback exists; address it before re-requesting review
  stop    Terminal or blocked state; report to user and do not proceed

Watch defaults:
  pollIntervalMs  60000  (1 minute)
  timeoutMs       86400000  (24 hours)

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or gh failure`.trim();

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 86_400_000;

const WATCH_STATES = new Set([
  STATE.WAITING_FOR_COPILOT_REVIEW,
]);

const FIX_STATES = new Set([
  STATE.UNRESOLVED_FEEDBACK_PRESENT,
  STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE,
]);

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

export function parseHandoffCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    forceRerequestReview: false,
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

    if (token === "--force-rerequest-review") {
      options.forceRerequestReview = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("copilot-pr-handoff requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

/**
 * Perform the detect → optional-request → interpret handoff.
 * Returns the result payload without writing to stdout.
 */
export async function runHandoff(options, { env = process.env, ghCommand = "gh" } = {}) {
  let snapshot = await autoDetectSnapshot(
    { repo: options.repo, pr: options.pr },
    { env, ghCommand },
  );
  let interpretation = interpretLoopState(snapshot);
  let reviewRequestStatus;

  const shouldRequestReview = interpretation.state === STATE.PR_READY_NO_FEEDBACK
    || interpretation.state === STATE.READY_TO_REREQUEST_REVIEW
    && (interpretation.autoRerequestEligible || options.forceRerequestReview);

  if (shouldRequestReview) {
    const requestResult = await performCopilotReviewRequest(
      { repo: options.repo, pr: options.pr },
      { env, ghCommand },
    );
    reviewRequestStatus = requestResult.status;

    snapshot = normalizeSnapshot({ ...snapshot, copilotReviewRequestStatus: reviewRequestStatus });
    interpretation = interpretLoopState(snapshot);
  }

  let action;
  if (reviewRequestStatus === "requested" || reviewRequestStatus === "already-requested") {
    action = "watch";
  } else if (WATCH_STATES.has(interpretation.state)) {
    action = "watch";
  } else if (FIX_STATES.has(interpretation.state)) {
    action = "fix";
  } else {
    action = "stop";
  }

  const result = {
    ok: true,
    action,
    state: interpretation.state,
    allowedTransitions: interpretation.allowedTransitions,
    nextAction: interpretation.nextAction,
    autoRerequestEligible: interpretation.autoRerequestEligible,
    sameHeadCleanConverged: interpretation.sameHeadCleanConverged,
    snapshot,
  };

  if (reviewRequestStatus !== undefined) {
    result.reviewRequestStatus = reviewRequestStatus;
  }

  if (action === "watch") {
    result.watchArgs = {
      repo: options.repo,
      pr: options.pr,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }

  return result;
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseHandoffCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runHandoff(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

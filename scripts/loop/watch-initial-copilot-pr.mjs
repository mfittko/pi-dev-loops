#!/usr/bin/env node
/**
 * Durable wait loop for the Copilot-first bootstrap-only draft PR seam.
 *
 * When a Copilot-assigned issue has a linked PR that is still in the
 * bootstrap-only draft shape (single "Initial plan" commit, 0 changed files,
 * draft, Copilot-authored), this script implements the healthy-wait boundary
 * from the public dev-loop contract:
 *
 *   - polls detect-initial-copilot-pr-state at the default interval
 *   - returns status="ready_for_followup" as soon as the PR leaves the
 *     bootstrap-only shape, carrying the PR number for immediate follow-up
 *   - returns status="timed_out" when the watch budget is exhausted;
 *     this is an *explicit still-waiting* outcome, not an implementation failure
 *
 * Both `waiting_for_initial_copilot_implementation` and `no_linked_pr` are
 * healthy non-terminal wait states for this seam.  Quiet poll cycles (PR still
 * bootstrap-only) do not surface as errors.
 *
 * `prior_linked_pr_closed_unmerged` is a terminal non-wait state: the loop
 * exits immediately with status="prior_linked_pr_closed_unmerged" so callers
 * can surface a reconcile/block reason rather than continuing to wait.
 *
 * The default watch budget is 1 hour, matching the Copilot-first durable-wait
 * seam defined in the public dev-loop contract.
 *
 * Success output shape:
 *   { "ok": true, "status": "ready_for_followup"|"timed_out",
 *     "repo": "...", "issue": N, "prNumber": N|null, "prUrl": "..."|null,
 *     "attempts": N, "elapsedMs": N }
 *
 * Failure behavior:
 *   Argument/usage errors emit { "ok": false, "error": "...", "usage": "..." }
 *   on stderr and exit non-zero.
 *   gh/runtime failures emit { "ok": false, "error": "..." } on stderr and
 *   exit non-zero.
 */
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { parseIssueNumber, requireOptionValue } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { detectInitialCopilotPrState, LINKED_PR_STATE } from "./detect-initial-copilot-pr-state.mjs";
import { enforcePersistentInternalWaitTimeout } from "@pi-dev-loops/core/loop/timeout-policy";
import {
  DEFAULT_POLL_INTERVAL_MS,
  COPILOT_FIRST_DURABLE_WAIT_TIMEOUT_MS,
} from "@pi-dev-loops/core/loop/policy-constants";

const REMOVED_FLAGS = new Set([
  "--poll-interval-ms",
  "--timeout-ms",
]);

const USAGE = `Usage: watch-initial-copilot-pr.mjs --repo <owner/name> --issue <number>

Wait for the Copilot-first bootstrap-only draft PR to become substantive.

Polls detect-initial-copilot-pr-state in a durable loop until the linked PR
leaves the bootstrap-only draft shape or the watch budget is exhausted.

Both waiting_for_initial_copilot_implementation, copilot_session_active, and
no_linked_pr are healthy non-terminal wait states for this seam.  Quiet poll
cycles do not surface as errors.  The 1-hour default watch budget matches the
Copilot-first durable-wait seam from the public dev-loop contract.

prior_linked_pr_closed_unmerged is a terminal non-wait state: the loop exits
immediately so callers can surface a reconcile/block reason.

Required:
  --repo <owner/name>           Repository slug (e.g. owner/repo)
  --issue <number>              Issue number

Output (stdout, JSON):
  { "ok": true, "status": "ready_for_followup"|"timed_out"|"prior_linked_pr_closed_unmerged",
    "repo": "...", "issue": N, "prNumber": N|null, "prUrl": "..."|null,
    "attempts": N, "elapsedMs": N }

Status values:
  ready_for_followup               Linked PR has left the bootstrap-only draft shape;
                                   proceed with PR follow-up using the returned prNumber
  timed_out                        Watch budget exhausted while linked PR was still
                                   bootstrap-only; this is an explicit still-waiting timeout
                                   outcome, not an implementation failure
  prior_linked_pr_closed_unmerged  A prior linked PR was closed without merging; the issue
                                   needs human reconciliation before the loop can continue

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }

Exit codes:
  0  Success (ready_for_followup, timed_out, and prior_linked_pr_closed_unmerged are all ok:true)
  1  Argument error or gh failure`.trim();

const parseError = buildParseError(USAGE);

function rejectRemovedFlag(token) {
  throw parseError(
    `${token} has been removed. Poll interval and timeout are centralized policy constants. Omit the flag.`,
  );
}

export async function watchCopilotRunUntilComplete(
  { repo, runId, timeoutMs = null },
  { env = process.env, ghCommand = "gh" } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ghCommand,
      ["run", "watch", String(runId), "--repo", repo],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    let timedOut = false;
    let timeoutId = null;

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    if (Number.isInteger(timeoutMs) && timeoutMs >= 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      if (timedOut) {
        resolve({ status: "timed_out" });
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        reject(new Error(`gh command failed: ${detail}`));
        return;
      }

      resolve({ status: "completed" });
    });
  });
}

export function parseWatchInitialCopilotPrCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    issue: undefined,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: COPILOT_FIRST_DURABLE_WAIT_TIMEOUT_MS,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (REMOVED_FLAGS.has(token)) {
      rejectRemovedFlag(token);
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", parseError).trim();
      continue;
    }

    if (token === "--issue") {
      options.issue = parseIssueNumber(requireOptionValue(args, "--issue", parseError), parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.issue === undefined) {
    throw parseError("watch-initial-copilot-pr requires both --repo <owner/name> and --issue <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  try {
    options.timeoutMs = options.timeoutMs === 0
      ? 0
      : enforcePersistentInternalWaitTimeout({
        timeoutMs: COPILOT_FIRST_DURABLE_WAIT_TIMEOUT_MS,
        contextLabel: "watch-initial-copilot-pr persistent wait",
      });
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

/**
 * Poll detect-initial-copilot-pr-state until the linked PR becomes substantive
 * or the watch budget is exhausted.
 *
 * Both `waiting_for_initial_copilot_implementation`, `copilot_session_active`,
 * and `no_linked_pr` are treated as healthy non-terminal wait states — they are
 * not implementation failures.  Only `linked_pr_ready_for_followup` triggers
 * early exit with a follow-up handoff result.
 *
 * `prior_linked_pr_closed_unmerged` is a terminal non-wait state: the loop
 * exits immediately with status="prior_linked_pr_closed_unmerged" so callers
 * can surface a reconcile/block reason rather than continuing to wait.
 *
 * @param {{ repo: string, issue: number, pollIntervalMs: number, timeoutMs: number }} options
 * @param {{ env?: object, ghCommand?: string, delayImpl?: function, nowMs?: function,
 *           detectInitialCopilotPrStateImpl?: function, watchCopilotRunUntilCompleteImpl?: function }} deps
 * @returns {Promise<{ ok: true, status: "ready_for_followup"|"timed_out"|"prior_linked_pr_closed_unmerged",
 *                     repo: string, issue: number, prNumber: number|null,
 *                     prUrl: string|null, attempts: number, elapsedMs: number }>}
 */
export async function watchInitialCopilotPr(
  options,
  {
    env = process.env,
    ghCommand = "gh",
    delayImpl = delay,
    nowMs = () => Date.now(),
    detectInitialCopilotPrStateImpl = detectInitialCopilotPrState,
    watchCopilotRunUntilCompleteImpl = watchCopilotRunUntilComplete,
  } = {},
) {
  const effectiveTimeoutMs = options.timeoutMs === 0
    ? 0
    : enforcePersistentInternalWaitTimeout({
      timeoutMs: options.timeoutMs,
      contextLabel: "watch-initial-copilot-pr persistent wait",
    });
  const { repo, issue, pollIntervalMs } = options;
  const startMs = nowMs();
  let attempts = 0;

  while (true) {
    attempts += 1;

    const detection = await detectInitialCopilotPrStateImpl({ repo, issue }, { env, ghCommand });
    const elapsedMs = nowMs() - startMs;

    if (detection.state === LINKED_PR_STATE.LINKED_PR_READY_FOR_FOLLOWUP) {
      return {
        ok: true,
        status: "ready_for_followup",
        repo,
        issue,
        prNumber: detection.prNumber,
        prUrl: detection.prUrl,
        attempts,
        elapsedMs,
      };
    }

    if (detection.state === LINKED_PR_STATE.PRIOR_LINKED_PR_CLOSED_UNMERGED) {
      return {
        ok: true,
        status: "prior_linked_pr_closed_unmerged",
        repo,
        issue,
        prNumber: detection.prNumber,
        prUrl: detection.prUrl,
        attempts,
        elapsedMs,
      };
    }

    // `waiting_for_initial_copilot_implementation`, `copilot_session_active`,
    // and `no_linked_pr` are healthy non-terminal wait states for this seam.
    // Only budget exhaustion terminates the loop.

    if (effectiveTimeoutMs === 0 || elapsedMs >= effectiveTimeoutMs) {
      return {
        ok: true,
        status: "timed_out",
        repo,
        issue,
        prNumber: detection.prNumber,
        prUrl: detection.prUrl,
        attempts,
        elapsedMs,
      };
    }

    if (
      detection.state === LINKED_PR_STATE.COPILOT_SESSION_ACTIVE
      && Number.isInteger(detection.sessionRunId)
    ) {
      const watchResult = await watchCopilotRunUntilCompleteImpl(
        {
          repo,
          runId: detection.sessionRunId,
          timeoutMs: effectiveTimeoutMs - elapsedMs,
        },
        { env, ghCommand },
      );
      if (watchResult?.status === "timed_out") {
        return {
          ok: true,
          status: "timed_out",
          repo,
          issue,
          prNumber: detection.prNumber,
          prUrl: detection.prUrl,
          attempts,
          elapsedMs: nowMs() - startMs,
        };
      }
      continue;
    }

    const remaining = effectiveTimeoutMs - (nowMs() - startMs);
    if (remaining > 0) {
      await delayImpl(Math.min(pollIntervalMs, remaining));
    }
  }
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, env = process.env, ghCommand = "gh" } = {},
) {
  const options = parseWatchInitialCopilotPrCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await watchInitialCopilotPr(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

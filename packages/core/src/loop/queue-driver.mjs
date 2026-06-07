/**
 * Sequential queue driver — iterates entries, calls startup resolver per entry,
 * routes through existing dev-loop strategies.
 *
 * Each entry goes through:
 *   1. Resolve dependencies
 *   2. Run dev-loop startup resolver
 *   3. Route to correct strategy
 *   4. Execute gates: draft_gate → pre_approval_gate → merge
 *   5. Write retrospective after merge
 *   6. Bug detection → auto-file → append to queue
 *   7. Failure classification + self-healing
 */

import {
  readQueue,
  writeQueue,
  transitionEntry,
  nextReadyEntry,
  allDone,
  RECOVERABLE_FAILURES,
  appendBugIssue,
} from "./queue-state.mjs";

/**
 * @typedef {Object} QueueDriverOptions
 * @property {string} repoRoot - Path to repo root
 * @property {string} repo - owner/name slug
 * @property {boolean} [mergeAuthorized=false] - Whether merge is pre-authorized
 * @property {number} [reDispatchMaxRetries=1] - Max re-dispatches for recoverable failures
 * @property {number} [maxAutoFiledIssues=10] - Cap on bug-injected issues per queue run
 * @property {Function} [onTransition] - Callback(state, entry, queue) on each transition
 * @property {Function} [runEntry] - Callback to execute a single entry (for testing)
 */

/** @type {QueueDriverOptions} */
export const DEFAULT_QUEUE_DRIVER_OPTIONS = {
  mergeAuthorized: false,
  reDispatchMaxRetries: 1,
  maxAutoFiledIssues: 10,
};

/**
 * Classify a failure reason into a failure kind.
 */
export function classifyFailure(error) {
  if (!error) return "unknown";
  const msg = typeof error === "string" ? error : error.message ?? "";

  if (/parse|acceptance.report|unexpected token|JSON|malformed/i.test(msg)) {
    return "acceptance_report_parse_failure";
  }
  if (/round.cap|max.*round|review.*limit/i.test(msg)) {
    return "round_cap_reached";
  }
  if (/timeout|timed.out|watch.*expired/i.test(msg)) {
    return "timeout";
  }
  if (/blocked|human.*comment|needs.*decision|needs.*user/i.test(msg)) {
    return "blocked_needs_user_decision";
  }
  if (/ci.*fail|check.*fail|build.*fail|test.*fail/i.test(msg)) {
    return "ci_failure";
  }
  return "unknown";
}

/**
 * Determine if a failure is recoverable (should be re-dispatched)
 * vs. blocking (pause entry, continue queue).
 */
export function isRecoverable(failureKind) {
  return RECOVERABLE_FAILURES.has(failureKind);
}

async function doTransition(entry, to, queue, repoRoot, opts, metadata) {
  transitionEntry(entry, to, metadata);
  await writeQueue(repoRoot, queue);
  if (opts.onTransition) opts.onTransition(to, entry, queue);
}

/**
 * Run the queue sequentially.
 *
 * Returns { ok, results, queue }. ok reflects whether ALL entries completed
 * successfully (ignoring blocked entries that were paused).
 */
export async function runQueue(repoRoot, repo, options = {}) {
  const opts = { ...DEFAULT_QUEUE_DRIVER_OPTIONS, ...options };
  const queue = await readQueue(repoRoot);
  let autoFiledCount = 0;

  const results = [];
  let incomplete = false;

  while (!allDone(queue)) {
    const entry = nextReadyEntry(queue, opts.reDispatchMaxRetries);

    if (!entry) {
      const remaining = queue.entries.filter(
        (e) => e.status !== "done" && e.status !== "blocked" && e.status !== "failed"
      );
      if (remaining.length > 0) {
        incomplete = true;
        results.push({
          target: null,
          ok: false,
          error: `Queue incomplete: ${remaining.length} entries blocked by unmet dependencies`,
          pendingTargets: remaining.map((e) => e.target),
        });
      }
      break;
    }

    // Handle retries: recoverable failed entries need failed → queued → running
    const wasFailed = entry.status === "failed";
    if (wasFailed) {
      entry.retryCount = (entry.retryCount ?? 0) + 1;
      await doTransition(entry, "queued", queue, repoRoot, opts);
    }

    await doTransition(entry, "running", queue, repoRoot, opts);

    try {
      const entryResult = opts.runEntry
        ? await opts.runEntry(entry, repo, opts)
        : { ok: true, pr: null };

      if (entryResult.ok) {
        if (entryResult.pr) {
          await doTransition(entry, "waiting_review", queue, repoRoot, opts, { pr: entryResult.pr });
          await doTransition(entry, "gates_passing", queue, repoRoot, opts);

          if (opts.mergeAuthorized) {
            await doTransition(entry, "merging", queue, repoRoot, opts);
            await doTransition(entry, "done", queue, repoRoot, opts, { retrospectiveWritten: true });
          }
          // When merge is not authorized, leave at gates_passing so a
          // future run can pick up and finish the merge step.
        } else {
          await doTransition(entry, "done", queue, repoRoot, opts);
        }

        results.push({ target: entry.target, ok: true, entry });
      } else {
        throw new Error(entryResult.error || "Entry failed");
      }
    } catch (err) {
      const failureKind = classifyFailure(err);
      const recoverable = isRecoverable(failureKind);

      if (recoverable && (entry.retryCount ?? 0) < opts.reDispatchMaxRetries) {
        await doTransition(entry, "failed", queue, repoRoot, opts, {
          failureReason: err.message,
          failureKind,
        });
        results.push({
          target: entry.target,
          ok: false,
          recoverable: true,
          failureKind,
          entry,
        });
      } else {
        await doTransition(entry, "blocked", queue, repoRoot, opts, {
          failureReason: err.message,
          failureKind,
        });

        // Bug detection: on workflow issues discovered during execution,
        // auto-file a new issue and append to queue end (capped).
        if (autoFiledCount < opts.maxAutoFiledIssues &&
            failureKind !== "blocked_needs_user_decision") {
          const bugIssue = entry.target + 1000; // placeholder
          appendBugIssue(queue, bugIssue, entry.target);
          autoFiledCount++;
        }

        results.push({
          target: entry.target,
          ok: false,
          recoverable: false,
          failureKind,
          entry,
        });
      }
    }
  }

  // ok is true only when all non-blocked entries succeeded
  const allOk = results.every((r) => r.ok !== false) && !incomplete;
  return { ok: allOk, results, queue };
}

/**
 * Evidence-loading helpers shared between outer-loop and inspect-run.
 *
 * Consolidates the copilot/reviewer snapshot-loading pattern that was
 * previously duplicated across scripts/loop/outer-loop.mjs and
 * scripts/loop/inspect-run.mjs:
 *
 *   Input-file mode (test/snapshot): load snapshot from a pre-built JSON file.
 *   Live mode: call the auto-detect function against GitHub.
 *
 * Each function returns { snapshot, interpretation } and lets errors propagate
 * so that callers can choose their own error-handling strategy:
 *   - outer-loop lets errors surface and fail the run
 *   - inspect-run wraps each call in a try-catch and records "failed" status
 */
import { readFile } from "node:fs/promises";

import { parseJsonText } from "../_core-helpers.mjs";
import { autoDetectSnapshot as autoDetectCopilotSnapshot } from "./detect-copilot-loop-state.mjs";
import { autoDetectReviewerSnapshot } from "./detect-reviewer-loop-state.mjs";
import {
  interpretLoopState,
  normalizeSnapshot as normalizeCopilotSnapshot,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  interpretReviewerLoopState,
  normalizeReviewerSnapshot,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";

/**
 * Load the copilot inner-loop snapshot and compute its interpretation.
 *
 * When copilotInputPath is provided, the snapshot is read from that file
 * (snapshot/test mode) and live GitHub detection is skipped.
 *
 * @param {object} options
 * @param {string} options.repo   Repository slug (owner/name).
 * @param {number} options.pr     Pull request number.
 * @param {string} [options.copilotInputPath]
 *   Path to a pre-built copilot snapshot JSON (skips live detection).
 * @param {{ env?: object, ghCommand?: string }} [deps]
 * @returns {Promise<{ snapshot: object, interpretation: object }>}
 */
export async function loadCopilotEvidence({ repo, pr, copilotInputPath }, { env = process.env, ghCommand = "gh" } = {}) {
  let snapshot;
  if (copilotInputPath !== undefined) {
    const text = await readFile(copilotInputPath, "utf8");
    snapshot = normalizeCopilotSnapshot(parseJsonText(text));
  } else {
    snapshot = await autoDetectCopilotSnapshot({ repo, pr }, { env, ghCommand });
  }
  return { snapshot, interpretation: interpretLoopState(snapshot) };
}

/**
 * Load the reviewer inner-loop snapshot and compute its interpretation.
 *
 * When reviewerInputPath is provided, the snapshot is read from that file
 * (snapshot/test mode) and live GitHub detection is skipped.
 * reviewerInputPath cannot be combined with reviewerLogin.
 *
 * @param {object} options
 * @param {string} options.repo   Repository slug (owner/name).
 * @param {number} options.pr     Pull request number.
 * @param {string} [options.reviewerLogin]
 *   Reviewer login for scoped detection. When omitted, aggregate
 *   all-reviewer scope is used.
 * @param {string} [options.reviewerInputPath]
 *   Path to a pre-built reviewer snapshot JSON (skips live detection).
 * @param {{ env?: object, ghCommand?: string }} [deps]
 * @returns {Promise<{ snapshot: object, interpretation: object }>}
 */
export async function loadReviewerEvidence({ repo, pr, reviewerLogin, reviewerInputPath }, { env = process.env, ghCommand = "gh" } = {}) {
  let snapshot;
  if (reviewerInputPath !== undefined) {
    const text = await readFile(reviewerInputPath, "utf8");
    snapshot = normalizeReviewerSnapshot(parseJsonText(text));
  } else {
    snapshot = await autoDetectReviewerSnapshot({ repo, pr, reviewerLogin }, { env, ghCommand });
  }
  return { snapshot, interpretation: interpretReviewerLoopState(snapshot) };
}

/**
 * Deterministic state machine for the async Copilot review/fix loop.
 *
 * This module provides:
 * - STATE: stable state name constants
 * - TRANSITIONS: legal next-state graph for each state
 * - normalizeSnapshot: validate and canonicalize a raw loop-state snapshot
 * - interpretLoopState: map a snapshot to one current state + allowed transitions + next action
 *
 * The state machine owns workflow control.
 * Agent judgment (accept/defer a comment, confirm a fix, decide on another Copilot pass)
 * becomes an explicit bounded input (agentFixStatus) rather than hidden orchestration behavior.
 */

/** Stable state name constants for the async Copilot review/fix loop. */
export const STATE = Object.freeze({
  /** No open PR exists for the current work. */
  NO_PR: "no_pr",
  /** PR exists but is in draft state. */
  PR_DRAFT: "pr_draft",
  /** PR is ready-for-review; no Copilot review has been requested or received yet. */
  PR_READY_NO_FEEDBACK: "pr_ready_no_feedback",
  /** Copilot review was requested and is in requested_reviewers; waiting for review activity. */
  WAITING_FOR_COPILOT_REVIEW: "waiting_for_copilot_review",
  /** Unresolved review threads exist that require a fix and/or reply/resolve action. */
  UNRESOLVED_FEEDBACK_PRESENT: "unresolved_feedback_present",
  /**
   * Agent has applied a fix; unresolved threads still exist on GitHub and need
   * reply/resolve before another Copilot pass or re-request is appropriate.
   */
  ALREADY_FIXED_NEEDS_REPLY_RESOLVE: "already_fixed_needs_reply_resolve",
  /**
   * All threads are resolved; Copilot has reviewed at least once and is not
   * currently requested. Ready to re-request a new Copilot pass or confirm done.
   */
  READY_TO_REREQUEST_REVIEW: "ready_to_rerequest_review",
  /**
   * Copilot review request returned `unavailable`. Must stop/report.
   * Do not sleep or watch as if review were requested.
   */
  REVIEW_REQUEST_UNAVAILABLE: "review_request_unavailable",
  /** CI checks are in progress; wait before proceeding. */
  WAITING_FOR_CI: "waiting_for_ci",
  /**
   * An unexpected failure occurred (bad review-request result, CI failure, etc.)
   * that requires user decision before the loop can continue.
   */
  BLOCKED_NEEDS_USER_DECISION: "blocked_needs_user_decision",
  /** PR has been merged or closed. Loop is complete. */
  DONE: "done",
});

/**
 * Legal transitions for each state.
 * Each entry lists the states that are reachable from the given state.
 * The agent layer selects among allowed transitions; the state machine enforces the graph.
 */
export const TRANSITIONS = Object.freeze({
  [STATE.NO_PR]: [],
  [STATE.PR_DRAFT]: [STATE.PR_READY_NO_FEEDBACK],
  [STATE.PR_READY_NO_FEEDBACK]: [STATE.WAITING_FOR_COPILOT_REVIEW],
  [STATE.WAITING_FOR_COPILOT_REVIEW]: [
    STATE.UNRESOLVED_FEEDBACK_PRESENT,
    STATE.READY_TO_REREQUEST_REVIEW,
    STATE.WAITING_FOR_CI,
  ],
  [STATE.UNRESOLVED_FEEDBACK_PRESENT]: [
    STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE,
    STATE.UNRESOLVED_FEEDBACK_PRESENT,
  ],
  [STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE]: [
    STATE.READY_TO_REREQUEST_REVIEW,
  ],
  [STATE.READY_TO_REREQUEST_REVIEW]: [
    STATE.WAITING_FOR_COPILOT_REVIEW,
    STATE.REVIEW_REQUEST_UNAVAILABLE,
    STATE.DONE,
  ],
  [STATE.REVIEW_REQUEST_UNAVAILABLE]: [],
  [STATE.WAITING_FOR_CI]: [
    STATE.PR_READY_NO_FEEDBACK,
    STATE.READY_TO_REREQUEST_REVIEW,
    STATE.BLOCKED_NEEDS_USER_DECISION,
  ],
  [STATE.BLOCKED_NEEDS_USER_DECISION]: [],
  [STATE.DONE]: [],
});

/** Recommended next action for each state. */
const NEXT_ACTIONS = Object.freeze({
  [STATE.NO_PR]: "Create a PR or hand work to Copilot",
  [STATE.PR_DRAFT]: "Move the PR from draft to ready-for-review",
  [STATE.PR_READY_NO_FEEDBACK]: "Request Copilot review via scripts/github/request-copilot-review.mjs",
  [STATE.WAITING_FOR_COPILOT_REVIEW]: "Wait for Copilot review via scripts/github/watch-copilot-review.mjs",
  [STATE.UNRESOLVED_FEEDBACK_PRESENT]: "Address unresolved review feedback, then reply to and resolve each thread on GitHub",
  [STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE]: "Reply to and resolve addressed threads on GitHub via scripts/github/reply-resolve-review-thread.mjs before re-requesting review",
  [STATE.READY_TO_REREQUEST_REVIEW]: "Re-request Copilot review via scripts/github/request-copilot-review.mjs only after smallest honest local validation is green and no known fixable CI-red state remains, or confirm the PR is done",
  [STATE.REVIEW_REQUEST_UNAVAILABLE]: "Report that Copilot review is unavailable and stop; do not sleep or watch as if review were requested",
  [STATE.WAITING_FOR_CI]: "Wait for CI checks to complete",
  [STATE.BLOCKED_NEEDS_USER_DECISION]: "Report the blocked state to the user and stop; do not proceed without explicit authorization",
  [STATE.DONE]: "Loop is complete; confirm merge-readiness or close",
});

const SAME_HEAD_CLEAN_CONVERGED_NEXT_ACTION = "Current head already has a clean submitted Copilot review; suppress automatic same-head re-request unless a meaningful remediation event occurs, or explicitly request another Copilot pass";

const VALID_REVIEW_REQUEST_STATUSES = new Set(["requested", "already-requested", "unavailable", "none", "failed"]);
const VALID_CI_STATUSES = new Set(["success", "failure", "pending", "none"]);

function isAutoRerequestEligible(snapshot, state) {
  if (state !== STATE.READY_TO_REREQUEST_REVIEW) return false;
  // A fresh submitted Copilot review on the current head with no unresolved feedback
  // is converged for that head on the automatic path. Auto re-request eligibility
  // re-opens only when the head advances (i.e. review is no longer on current head).
  return !snapshot.copilotReviewOnCurrentHead;
}

/**
 * Normalize a raw snapshot object into a validated, canonical snapshot.
 *
 * Unknown or invalid field values are replaced with safe defaults.
 * Throws if `raw` is not a non-null object.
 *
 * Snapshot schema:
 * - prExists {boolean} — whether a PR was found
 * - prNumber {number|null} — PR number if prExists, otherwise null
 * - prDraft {boolean} — whether the PR is in draft state
 * - prMerged {boolean} — whether the PR has been merged
 * - prClosed {boolean} — whether the PR has been closed without merge
 * - copilotReviewRequestStatus {"requested"|"already-requested"|"unavailable"|"none"|"failed"}
 *     — current known Copilot review-request state, or "none" if unknown
 * - copilotReviewPresent {boolean} — whether at least one Copilot review exists on the PR
 * - copilotReviewOnCurrentHead {boolean} — whether a submitted (non-PENDING) Copilot review
 *     exists for the current head commit; when true, the review is done even if
 *     requested_reviewers has not yet cleared
 * - unresolvedThreadCount {number} — total unresolved review-thread count
 * - actionableThreadCount {number} — unresolved threads with non-bot actionable comments
 * - ciStatus {"success"|"failure"|"pending"|"none"} — current CI check rollup status
 * - agentFixStatus {"applied"|null} — agent-provided input: "applied" when code has been fixed
 *
 * @param {object} raw - raw snapshot input
 * @returns {object} normalized snapshot
 */
export function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Snapshot must be a non-null object");
  }

  const prExists = Boolean(raw.prExists);

  const copilotReviewOnCurrentHead = Boolean(raw.copilotReviewOnCurrentHead);

  return {
    prExists,
    prNumber: prExists && typeof raw.prNumber === "number" && raw.prNumber > 0
      ? Math.floor(raw.prNumber)
      : null,
    prDraft: Boolean(raw.prDraft),
    prMerged: Boolean(raw.prMerged),
    prClosed: Boolean(raw.prClosed),
    copilotReviewRequestStatus: VALID_REVIEW_REQUEST_STATUSES.has(raw.copilotReviewRequestStatus)
      ? raw.copilotReviewRequestStatus
      : "none",
    copilotReviewPresent: Boolean(raw.copilotReviewPresent) || copilotReviewOnCurrentHead,
    copilotReviewOnCurrentHead,
    unresolvedThreadCount: typeof raw.unresolvedThreadCount === "number" && raw.unresolvedThreadCount >= 0
      ? Math.floor(raw.unresolvedThreadCount)
      : 0,
    actionableThreadCount: typeof raw.actionableThreadCount === "number" && raw.actionableThreadCount >= 0
      ? Math.floor(raw.actionableThreadCount)
      : 0,
    ciStatus: VALID_CI_STATUSES.has(raw.ciStatus) ? raw.ciStatus : "none",
    agentFixStatus: raw.agentFixStatus === "applied" ? "applied" : null,
  };
}

/**
 * Interpret a loop-state snapshot into one current state, allowed next transitions,
 * and a recommended next action.
 *
 * Interpretation is deterministic: the same snapshot always yields the same result.
 * The function normalizes the snapshot before interpreting, so raw inputs are accepted.
 *
 * Key routing guarantees:
 * - unresolvedThreadCount > 0 always routes into fix/reply-resolve flow, never into wait
 * - "unavailable" or "failed" review-request status routes into stop/report states
 * - agentFixStatus "applied" distinguishes fix-needed from already-fixed-needs-reply/resolve
 * - Copilot review still in progress (via requested_reviewers or a PENDING current-head Copilot review) routes into waiting_for_copilot_review
 *   UNLESS a submitted Copilot review already exists on the current head (copilotReviewOnCurrentHead),
 *   which means the wait is done and the loop can advance to ready_to_rerequest_review
 *
 * @param {object} snapshot - raw or normalized snapshot
 * @returns {{
 *   state: string,
 *   allowedTransitions: string[],
 *   nextAction: string,
 *   autoRerequestEligible: boolean,
 *   sameHeadCleanConverged: boolean
 * }}
 */
export function interpretLoopState(snapshot) {
  const s = normalizeSnapshot(snapshot);

  let state;

  if (!s.prExists) {
    state = STATE.NO_PR;
  } else if (s.prMerged || s.prClosed) {
    state = STATE.DONE;
  } else if (s.prDraft) {
    state = STATE.PR_DRAFT;
  } else if (s.copilotReviewRequestStatus === "unavailable") {
    state = STATE.REVIEW_REQUEST_UNAVAILABLE;
  } else if (s.copilotReviewRequestStatus === "failed") {
    state = STATE.BLOCKED_NEEDS_USER_DECISION;
  } else if (s.unresolvedThreadCount > 0 && s.agentFixStatus === "applied") {
    // Agent has fixed the code; threads still need reply/resolve on GitHub
    state = STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE;
  } else if (s.unresolvedThreadCount > 0) {
    // Unresolved feedback exists — do not wait; enter fix/reply-resolve handling
    state = STATE.UNRESOLVED_FEEDBACK_PRESENT;
  } else if ((s.copilotReviewRequestStatus === "requested" || s.copilotReviewRequestStatus === "already-requested") && !s.copilotReviewOnCurrentHead) {
    // Copilot is in requested_reviewers but has not yet submitted a review on the current head
    state = STATE.WAITING_FOR_COPILOT_REVIEW;
  } else if (s.copilotReviewPresent) {
    // Copilot has reviewed at least once; all threads resolved
    if (s.ciStatus === "pending") {
      state = STATE.WAITING_FOR_CI;
    } else if (s.ciStatus === "failure") {
      state = STATE.BLOCKED_NEEDS_USER_DECISION;
    } else {
      state = STATE.READY_TO_REREQUEST_REVIEW;
    }
  } else {
    // No Copilot review yet; not currently requested
    if (s.ciStatus === "pending") {
      state = STATE.WAITING_FOR_CI;
    } else if (s.ciStatus === "failure") {
      state = STATE.BLOCKED_NEEDS_USER_DECISION;
    } else {
      state = STATE.PR_READY_NO_FEEDBACK;
    }
  }

  const autoRerequestEligible = isAutoRerequestEligible(s, state);
  const sameHeadCleanConverged = state === STATE.READY_TO_REREQUEST_REVIEW
    && s.copilotReviewOnCurrentHead
    && s.unresolvedThreadCount === 0
    && s.actionableThreadCount === 0;

  let nextAction = NEXT_ACTIONS[state];
  if (sameHeadCleanConverged) {
    nextAction = SAME_HEAD_CLEAN_CONVERGED_NEXT_ACTION;
  }

  return {
    state,
    allowedTransitions: [...TRANSITIONS[state]],
    nextAction,
    autoRerequestEligible,
    sameHeadCleanConverged,
  };
}

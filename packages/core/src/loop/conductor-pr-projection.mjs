import { isSafeRepoSegment, normalizeRepoSlug } from "../github/repo-slug.mjs";

/**
 * Conductor PR projection contract: deterministic visible PR updates and
 * durable closeout artifacts for conductor-led hybrid PR loops.
 *
 * This module provides:
 * - PROJECTION_TRANSITION: which conductor-owned lifecycle transitions deserve visible projection
 * - PROJECTION_REQUIREMENT: output class for each transition (comment / artifact / both / neither)
 * - POST_MERGE_KIND: terminal closeout vs resumable post-merge continuation
 * - MENTION_TRIGGER: conditions under which a guarded human mention is allowed
 * - defaultProjectionConfig: returns a safe default config (all projection opt-in, all off by default)
 * - evaluateProjection: maps a state transition + config to a projection decision
 * - computeProjectionKey: deterministic idempotency key so repeated polls do not emit duplicate comments
 * - evaluateMentionEligibility: guarded mention decision with cooldown and allow-list enforcement
 * - classifyPostMergeKind: classifies a post-merge outcome as terminal or resumable
 *
 * Contract guarantees:
 * - Projection is a downstream observability mirror only; it does not replace upstream routing truth.
 * - Each projection decision is deterministic and purely functional (no I/O or side effects).
 * - Idempotency keys are stable across restarts/resumes so the same conductor-owned transition
 *   is never re-announced just because a new process observed it.
 * - Status comments are opt-in (default off); mentions are separately opt-in (default off).
 * - Mentions are only emitted when all five eligibility criteria are satisfied simultaneously.
 * - Lossy outerAction compatibility projections are NOT accepted as authoritative; callers must
 *   supply the authoritative routingOutcome when available.
 *
 * Integration boundary (see docs/conductor-pr-projection-contract.md):
 * - This module starts after upstream state truth has already been determined:
 *   ownership (#32), family-local lifecycle (#26), conductor routing (#61).
 * - It consumes those already-determined outcomes and decides which transitions to mirror.
 * - It does NOT define ownership, routing, request/watch, or family-local state semantics.
 */

// ---------------------------------------------------------------------------
// Projection transitions
// ---------------------------------------------------------------------------

/**
 * Canonical set of conductor-owned PR lifecycle transitions that are candidates
 * for visible projection or durable closeout artifacts.
 *
 * Only meaningful transitions that materially change operator understanding
 * of conductor progress are listed here. Low-level poll heartbeats, timing
 * updates, and routine wait-state re-evaluations are excluded.
 */
export const PROJECTION_TRANSITION = Object.freeze({
  /** PR entered draft stage; conductor local review gate opened. */
  DRAFT_GATE_ENTERED: "draft_gate_entered",
  /** Draft-stage local review gate completed; PR is ready for review. */
  READY_FOR_REVIEW_ENTERED: "ready_for_review_entered",
  /** Copilot review explicitly requested/confirmed for the current head. */
  COPILOT_REVIEW_REQUESTED: "copilot_review_requested",
  /**
   * Post-rerequest Copilot settle-wait entered for the current head.
   * The conductor is waiting for the fresh Copilot pass to arrive before
   * reviewer / final-approval routing can win.
   */
  COPILOT_SETTLE_WAIT_ENTERED: "copilot_settle_wait_entered",
  /**
   * Clean current-head Copilot settle achieved: Copilot has reviewed the
   * current head and no unresolved review threads remain.
   */
  COPILOT_SETTLE_ACHIEVED: "copilot_settle_achieved",
  /** Copilot loop converged (no remaining feedback) or re-entered a new iteration. */
  COPILOT_LOOP_CONVERGED: "copilot_loop_converged",
  /** Final local pre-approval gate completed; all automated checks are done. */
  FINAL_GATE_COMPLETED: "final_gate_completed",
  /** Conductor is waiting for human approval before merge. */
  WAITING_FOR_HUMAN_APPROVAL: "waiting_for_human_approval",
  /** Conductor is waiting for merge after approval. */
  WAITING_FOR_MERGE: "waiting_for_merge",
  /** Merge detected; outcome classified as terminal or resumable (see POST_MERGE_KIND). */
  MERGE_DETECTED: "merge_detected",
  /**
   * Loop blocked and requires a specific human decision before it can continue.
   * A guarded mention may accompany this transition when mention config allows it.
   */
  BLOCKED_NEEDS_HUMAN_DECISION: "blocked_needs_human_decision",
  /** Conductor stopped; a live owner stopped cleanly without terminal completion. */
  CONDUCTOR_STOP: "conductor_stop",
  /**
   * Ownership or state is ambiguous; conductor must reconcile before resuming.
   * No automated progress should be assumed until reconcile is done.
   */
  RECONCILE_REQUIRED: "reconcile_required",
});

// ---------------------------------------------------------------------------
// Projection requirement classes
// ---------------------------------------------------------------------------

/**
 * Output class for each projection transition.
 *
 * Determines what durable output is required when a transition is projected:
 * - VISIBLE_COMMENT: emit a concise idempotent PR/issue comment
 * - DURABLE_ARTIFACT: write a durable local closeout artifact under tmp/ or conductor artifact area
 * - BOTH: emit both a visible comment and a durable artifact
 * - NONE: the transition is noted internally but does not produce a visible or durable output
 */
export const PROJECTION_REQUIREMENT = Object.freeze({
  /** Emit a concise idempotent PR/issue comment for this transition. */
  VISIBLE_COMMENT: "visible_comment",
  /** Write a durable local closeout artifact. */
  DURABLE_ARTIFACT: "durable_artifact",
  /** Emit both a visible comment and a durable artifact. */
  BOTH: "both",
  /** No external output; transition is noted in local runtime only. */
  NONE: "none",
});

// ---------------------------------------------------------------------------
// Post-merge kind
// ---------------------------------------------------------------------------

/**
 * Classifies a post-merge outcome as terminal or resumable.
 *
 * The conductor must distinguish these two outcomes so operators can tell
 * without replaying the whole run whether follow-up work is still expected.
 */
export const POST_MERGE_KIND = Object.freeze({
  /**
   * Terminal closeout: the owned slice is complete and no further owned step
   * remains. This is the common "happy path done" outcome.
   */
  TERMINAL_CLOSEOUT: "terminal_closeout",
  /**
   * Resumable continuation: merge happened but there is a known next owned
   * step or follow-up continuation still expected (e.g., post-merge phase
   * or linked follow-up issue).
   */
  RESUMABLE_CONTINUATION: "resumable_continuation",
});

const KNOWN_PROJECTION_TRANSITIONS = new Set(Object.values(PROJECTION_TRANSITION));
const KNOWN_POST_MERGE_KINDS = new Set(Object.values(POST_MERGE_KIND));
const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

// ---------------------------------------------------------------------------
// Mention triggers
// ---------------------------------------------------------------------------

/**
 * Conditions under which a guarded human mention may be emitted.
 * All five eligibility criteria must be simultaneously satisfied.
 */
export const MENTION_TRIGGER = Object.freeze({
  /** Loop blocked; explicit human decision required before automation can continue. */
  BLOCKED_NEEDS_HUMAN_DECISION: "blocked_needs_human_decision",
  /** Conductor stopped due to reconcile-required state; human must reconcile. */
  RECONCILE_REQUIRED: "reconcile_required",
  /** Conductor stopped cleanly but a known next step needs human kickoff. */
  CONDUCTOR_STOP_WITH_PENDING_ACTION: "conductor_stop_with_pending_action",
});

// ---------------------------------------------------------------------------
// Default projection requirement table
// ---------------------------------------------------------------------------

/**
 * Default projection requirement for each transition.
 *
 * This table defines the minimum expected output for each transition.
 * Callers may reduce output below these defaults only when config disables
 * the corresponding output class (e.g. githubStatusComments.enabled = false
 * suppresses VISIBLE_COMMENT output).
 */
const DEFAULT_PROJECTION_REQUIREMENTS = Object.freeze({
  [PROJECTION_TRANSITION.DRAFT_GATE_ENTERED]: PROJECTION_REQUIREMENT.NONE,
  [PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED]: PROJECTION_REQUIREMENT.VISIBLE_COMMENT,
  [PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED]: PROJECTION_REQUIREMENT.VISIBLE_COMMENT,
  [PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED]: PROJECTION_REQUIREMENT.NONE,
  [PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED]: PROJECTION_REQUIREMENT.NONE,
  [PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED]: PROJECTION_REQUIREMENT.VISIBLE_COMMENT,
  [PROJECTION_TRANSITION.FINAL_GATE_COMPLETED]: PROJECTION_REQUIREMENT.NONE,
  [PROJECTION_TRANSITION.WAITING_FOR_HUMAN_APPROVAL]: PROJECTION_REQUIREMENT.VISIBLE_COMMENT,
  [PROJECTION_TRANSITION.WAITING_FOR_MERGE]: PROJECTION_REQUIREMENT.NONE,
  [PROJECTION_TRANSITION.MERGE_DETECTED]: PROJECTION_REQUIREMENT.BOTH,
  [PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION]: PROJECTION_REQUIREMENT.BOTH,
  [PROJECTION_TRANSITION.CONDUCTOR_STOP]: PROJECTION_REQUIREMENT.DURABLE_ARTIFACT,
  [PROJECTION_TRANSITION.RECONCILE_REQUIRED]: PROJECTION_REQUIREMENT.BOTH,
});

// ---------------------------------------------------------------------------
// Default projection config
// ---------------------------------------------------------------------------

/**
 * Returns the default projection configuration.
 *
 * By default, all external projection is disabled (opt-in). Callers must
 * explicitly enable githubStatusComments and/or mentions to receive visible
 * PR updates and/or guarded human mentions.
 *
 * @returns {object} Default projection config object.
 */
export function defaultProjectionConfig() {
  return {
    githubStatusComments: {
      enabled: false,
      mode: "upsert",
      target: "pr-or-issue",
      verbosity: "concise",
    },
    mentions: {
      enabled: false,
      allowedUsers: [],
      cooldownMinutes: 120,
    },
  };
}

// ---------------------------------------------------------------------------
// Projection key computation
// ---------------------------------------------------------------------------

/**
 * Compute a stable, deterministic idempotency key for a projection event.
 *
 * The key encodes the meaningful transition identity so that repeated polls,
 * restarts, or resumes that observe the same effective state do not emit
 * duplicate visible PR comments or artifacts.
 *
 * Key format: `<repo>#<pr>/<transition>[/<extra>]`
 *
 * The `extra` component is included only for transitions whose idempotency
 * depends on additional context (e.g. merge kind for MERGE_DETECTED, or
 * blocker identifier for BLOCKED_NEEDS_HUMAN_DECISION).
 *
 * @param {string} transition One of PROJECTION_TRANSITION values.
 * @param {{ repo: string, pr: number }} target Normalized target identity.
 * @param {object} [context] Optional extra idempotency context.
 * @param {string} [context.postMergeKind] Optional for MERGE_DETECTED transitions; defaults to terminal_closeout when omitted.
 * @param {string} [context.blockerKey] Optional stable blocker identifier for BLOCKED transitions.
 * @param {string} [context.headSha] Optional head commit SHA for settle transitions.
 * @returns {string|null} Stable idempotency key, or null when target is invalid.
 */
export function computeProjectionKey(transition, target, context = {}) {
  const normalizedTransition = normalizeProjectionTransition(transition);
  const normalizedTarget = normalizeProjectionTarget(target);
  if (!normalizedTransition || !normalizedTarget) {
    return null;
  }

  const base = `${normalizedTarget.repo}#${normalizedTarget.pr}/${normalizedTransition}`;

  if (normalizedTransition === PROJECTION_TRANSITION.MERGE_DETECTED) {
    if (context.postMergeKind !== undefined && context.postMergeKind !== null) {
      const mergeKind = normalizePostMergeKind(context.postMergeKind);
      return mergeKind === null ? null : `${base}/${mergeKind}`;
    }
    return `${base}/${POST_MERGE_KIND.TERMINAL_CLOSEOUT}`;
  }

  if (
    normalizedTransition === PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION ||
    normalizedTransition === PROJECTION_TRANSITION.RECONCILE_REQUIRED
  ) {
    if (context.blockerKey === undefined || context.blockerKey === null) {
      return base;
    }
    const blockerKey = normalizeBlockerKey(context.blockerKey);
    return blockerKey === null ? null : `${base}/${blockerKey}`;
  }

  if (
    normalizedTransition === PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED ||
    normalizedTransition === PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED
  ) {
    if (context.headSha === undefined || context.headSha === null) {
      return base;
    }
    const headSha = normalizeHeadSha(context.headSha);
    return headSha === null ? null : `${base}/${headSha}`;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Post-merge kind classification
// ---------------------------------------------------------------------------

/**
 * Classify a merge detection outcome as terminal closeout or resumable continuation.
 *
 * The classification must be inspectable without replaying the whole run.
 * Operators can tell from the durable artifact whether follow-up work is
 * still expected after the merge.
 *
 * @param {object} params Classification inputs.
 * @param {boolean} [params.hasKnownNextStep=false] Whether a known next owned step exists.
 * @param {string|null} [params.followUpIssue=null] Linked follow-up issue/continuation reference.
 * @returns {{ kind: string, reason: string }} Classification result.
 */
export function classifyPostMergeKind({ hasKnownNextStep = false, followUpIssue = null } = {}) {
  if (hasKnownNextStep || (typeof followUpIssue === "string" && followUpIssue.trim())) {
    return {
      kind: POST_MERGE_KIND.RESUMABLE_CONTINUATION,
      reason: followUpIssue
        ? `Post-merge continuation expected; follow-up: ${followUpIssue.trim()}`
        : "Post-merge continuation expected; a known next owned step remains.",
    };
  }
  return {
    kind: POST_MERGE_KIND.TERMINAL_CLOSEOUT,
    reason: "Owned slice is complete; no further owned step remains.",
  };
}

// ---------------------------------------------------------------------------
// Projection evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a state transition and config to produce a projection decision.
 *
 * Returns a deterministic projection result that tells callers:
 * - whether a visible PR comment should be emitted (`emitComment`)
 * - whether a durable local artifact should be written (`emitArtifact`)
 * - a stable idempotency key for de-duplication (`projectionKey`)
 * - a concise human-readable summary for the comment/artifact body (`summary`)
 * - whether mention eligibility should be separately evaluated (`checkMention`)
 * - the concrete mention trigger to evaluate when mention checks are relevant (`mentionTrigger`)
 *
 * When githubStatusComments.enabled is false (the default), emitComment is
 * always false regardless of the transition's default requirement class.
 *
 * @param {object} params Evaluation inputs.
 * @param {string} params.transition One of PROJECTION_TRANSITION values.
 * @param {{ repo: string, pr: number }} params.target Normalized target identity.
 * @param {object} [params.config] Projection config (use defaultProjectionConfig() if omitted).
 * @param {object} [params.context] Optional extra context for idempotency key and summary.
 * @param {string} [params.context.postMergeKind] Optional for MERGE_DETECTED transitions; defaults to terminal_closeout when omitted.
 * @param {string} [params.context.blockerKey] Optional stable blocker identifier.
 * @param {string} [params.context.headSha] Optional head commit SHA for settle transitions.
 * @param {string} [params.context.reason] Optional human-readable reason for the transition.
 * @returns {object} Projection decision.
 */
export function evaluateProjection({
  transition,
  target,
  config,
  context = {},
} = {}) {
  const effectiveConfig = config && typeof config === "object" ? config : defaultProjectionConfig();
  const commentsEnabled = effectiveConfig?.githubStatusComments?.enabled === true;

  const isKnownTransition = typeof transition === "string" &&
    Object.values(PROJECTION_TRANSITION).includes(transition);

  if (!isKnownTransition) {
    return {
      emitComment: false,
      emitArtifact: false,
      projectionKey: null,
      summary: "Unknown conductor projection transition; no projection emitted.",
      checkMention: false,
      mentionTrigger: null,
      projectionRequirement: PROJECTION_REQUIREMENT.NONE,
    };
  }

  const requirement = DEFAULT_PROJECTION_REQUIREMENTS[transition] ?? PROJECTION_REQUIREMENT.NONE;
  const projectionKey = computeProjectionKey(transition, target, context);

  const needsComment = requirement === PROJECTION_REQUIREMENT.VISIBLE_COMMENT ||
    requirement === PROJECTION_REQUIREMENT.BOTH;
  const needsArtifact = requirement === PROJECTION_REQUIREMENT.DURABLE_ARTIFACT ||
    requirement === PROJECTION_REQUIREMENT.BOTH;
  const hasStableProjectionIdentity = projectionKey !== null;

  const emitComment = commentsEnabled && needsComment && hasStableProjectionIdentity;
  const emitArtifact = needsArtifact && hasStableProjectionIdentity;

  const mentionTrigger = hasStableProjectionIdentity
    ? deriveMentionTrigger(transition, context)
    : null;
  const checkMention = mentionTrigger !== null;

  const summary = buildSummary(transition, context);

  return {
    emitComment,
    emitArtifact,
    projectionKey,
    summary,
    checkMention,
    mentionTrigger,
    projectionRequirement: requirement,
  };
}

// ---------------------------------------------------------------------------
// Mention eligibility evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a guarded human mention should be emitted.
 *
 * All five eligibility criteria must be simultaneously satisfied:
 * 1. mentions.enabled is true in config
 * 2. The trigger matches a known MENTION_TRIGGER
 * 3. The mention target is in config.mentions.allowedUsers
 * 4. The cooldown window has elapsed since the last mention for the same effective blocker
 * 5. The mention includes a specific, non-empty actionableAsk
 *
 * Mentions must NOT be emitted for routine wait states (CI wait, Copilot review wait,
 * scheduled polling, converged states). Only genuine blocked/needs-human states qualify.
 *
 * @param {object} params Eligibility inputs.
 * @param {object} params.config Projection config.
 * @param {string} params.trigger One of MENTION_TRIGGER values.
 * @param {string} params.mentionUser GitHub login of the person to mention.
 * @param {number|null} [params.lastMentionAt=null] Timestamp (ms) of the last mention for this blocker.
 * @param {number} [params.nowMs=Date.now()] Current time in milliseconds.
 * @param {string} [params.actionableAsk] Required human-readable ask to include in the mention.
 * @returns {{ eligible: boolean, reason: string }} Eligibility result.
 */
export function evaluateMentionEligibility({
  config,
  trigger,
  mentionUser,
  lastMentionAt = null,
  nowMs = Date.now(),
  actionableAsk,
} = {}) {
  if (config?.mentions?.enabled !== true) {
    return { eligible: false, reason: "mentions.enabled is false" };
  }

  const knownTriggers = Object.values(MENTION_TRIGGER);
  if (!knownTriggers.includes(trigger)) {
    return { eligible: false, reason: `trigger '${trigger}' is not a known MENTION_TRIGGER` };
  }

  if (typeof mentionUser !== "string" || !mentionUser.trim()) {
    return { eligible: false, reason: "mentionUser is empty or missing" };
  }

  const normalizedMentionUser = mentionUser.trim().toLowerCase();
  const allowedUsers = Array.isArray(config.mentions.allowedUsers)
    ? config.mentions.allowedUsers
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
    : [];
  if (!allowedUsers.includes(normalizedMentionUser)) {
    return { eligible: false, reason: `mentionUser '${mentionUser}' is not in mentions.allowedUsers` };
  }

  if (typeof actionableAsk !== "string" || !actionableAsk.trim()) {
    return { eligible: false, reason: "actionableAsk is missing; mentions must include a specific actionable ask" };
  }

  const cooldownMinutes = Number(config.mentions.cooldownMinutes ?? 120);
  const normalizedNowMs = Number(nowMs);
  const normalizedLastMentionAt = lastMentionAt === null ? null : Number(lastMentionAt);

  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
    return { eligible: false, reason: "mentions.cooldownMinutes must be a finite non-negative number" };
  }
  if (!Number.isFinite(normalizedNowMs)) {
    return { eligible: false, reason: "nowMs must be a finite number" };
  }
  if (normalizedLastMentionAt !== null && !Number.isFinite(normalizedLastMentionAt)) {
    return { eligible: false, reason: "lastMentionAt must be null or a finite number" };
  }

  if (normalizedLastMentionAt !== null) {
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const elapsed = normalizedNowMs - normalizedLastMentionAt;
    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsed) / 60000);
      return {
        eligible: false,
        reason: `cooldown has not elapsed; ${remainingMinutes} minute(s) remaining`,
      };
    }
  }

  return { eligible: true, reason: "all mention eligibility criteria satisfied" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize and validate a projection transition name.
 *
 * @param {string} transition
 * @returns {string|null}
 */
function normalizeProjectionTransition(transition) {
  return typeof transition === "string" && KNOWN_PROJECTION_TRANSITIONS.has(transition)
    ? transition
    : null;
}

function normalizeProjectionTarget(target) {
  if (
    !target ||
    typeof target !== "object" ||
    typeof target.pr !== "number" ||
    !Number.isInteger(target.pr) ||
    target.pr < 1
  ) {
    return null;
  }

  try {
    return {
      repo: normalizeRepoSlug(target.repo, { errorMessage: "repo must match <owner/name>" }),
      pr: target.pr,
    };
  } catch {
    return null;
  }
}

function normalizePostMergeKind(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return KNOWN_POST_MERGE_KINDS.has(trimmed)
    ? trimmed
    : null;
}

function normalizeBlockerKey(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return isSafeRepoSegment(trimmed)
    ? trimmed
    : null;
}

function normalizeHeadSha(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return GIT_SHA_PATTERN.test(trimmed)
    ? trimmed
    : null;
}

/**
 * Derive the concrete mention trigger for a projection transition when one exists.
 *
 * Most transitions do not support mentions. `CONDUCTOR_STOP` only derives a
 * trigger when context says a pending human action still exists.
 *
 * @param {string} transition
 * @param {object} context
 * @returns {string|null}
 */
function deriveMentionTrigger(transition, context = {}) {
  switch (transition) {
    case PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION:
      return MENTION_TRIGGER.BLOCKED_NEEDS_HUMAN_DECISION;
    case PROJECTION_TRANSITION.RECONCILE_REQUIRED:
      return MENTION_TRIGGER.RECONCILE_REQUIRED;
    case PROJECTION_TRANSITION.CONDUCTOR_STOP:
      return context.hasPendingAction === true
        ? MENTION_TRIGGER.CONDUCTOR_STOP_WITH_PENDING_ACTION
        : null;
    default:
      return null;
  }
}

function buildSummary(transition, context = {}) {
  switch (transition) {
    case PROJECTION_TRANSITION.DRAFT_GATE_ENTERED:
      return "PR entered draft stage; conductor local review gate opened.";
    case PROJECTION_TRANSITION.READY_FOR_REVIEW_ENTERED:
      return "PR marked ready for review.";
    case PROJECTION_TRANSITION.COPILOT_REVIEW_REQUESTED:
      return "Copilot review requested for the current head.";
    case PROJECTION_TRANSITION.COPILOT_SETTLE_WAIT_ENTERED:
      return context.headSha
        ? `Waiting for fresh Copilot pass to settle on head ${context.headSha}.`
        : "Waiting for fresh Copilot pass to settle.";
    case PROJECTION_TRANSITION.COPILOT_SETTLE_ACHIEVED:
      return context.headSha
        ? `Clean Copilot settle achieved on head ${context.headSha}.`
        : "Clean Copilot settle achieved on current head.";
    case PROJECTION_TRANSITION.COPILOT_LOOP_CONVERGED:
      return "Copilot loop converged; no unresolved feedback remains.";
    case PROJECTION_TRANSITION.FINAL_GATE_COMPLETED:
      return "Final local pre-approval gate completed.";
    case PROJECTION_TRANSITION.WAITING_FOR_HUMAN_APPROVAL:
      return "Waiting for human approval before merge.";
    case PROJECTION_TRANSITION.WAITING_FOR_MERGE:
      return "Waiting for merge after approval.";
    case PROJECTION_TRANSITION.MERGE_DETECTED: {
      const kind = normalizePostMergeKind(context.postMergeKind) ?? POST_MERGE_KIND.TERMINAL_CLOSEOUT;
      if (kind === POST_MERGE_KIND.RESUMABLE_CONTINUATION) {
        return context.reason ?? "Merge detected; post-merge continuation expected.";
      }
      return "Merge detected; conductor slice is complete.";
    }
    case PROJECTION_TRANSITION.BLOCKED_NEEDS_HUMAN_DECISION:
      return context.reason ?? "Conductor blocked; human decision required before automation can continue.";
    case PROJECTION_TRANSITION.CONDUCTOR_STOP:
      return context.reason ?? "Conductor stopped cleanly.";
    case PROJECTION_TRANSITION.RECONCILE_REQUIRED:
      return context.reason ?? "Reconcile required; ownership or state is ambiguous.";
    default:
      return `Conductor transition: ${transition}.`;
  }
}

/**
 * Unified dev-loop façade: single public entrypoint with deterministic internal routing.
 *
 * This module provides:
 * - USER_INTENT: closed taxonomy of user-facing intent actions
 * - TARGET_TYPE: target artifact types
 * - OWNER: who owns the next move
 * - ACTOR_STATE: what the current actor is doing
 * - LOOP_PHASE: high-level loop phases
 * - INTERNAL_STRATEGY: internal execution strategy identifiers
 * - parseUserIntent: parse a user-intent string into a structured intent object
 * - resolveCanonicalState: derive the canonical top-level state from available signals
 * - routeToStrategy: deterministically select an internal strategy from intent + state
 *
 * Contract guarantees:
 * - One deterministic routing decision per (intent, state) pair
 * - Ambiguous or insufficient inputs return a reconcile/clarify result, never a guess
 * - The façade is purely functional; no I/O or side effects
 * - Existing specialized loops remain available as internal strategies
 * - User never needs to choose among internal loop names up front
 *
 * This is the first implementation slice for issue #86.
 */

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * User-facing intent actions (the public API vocabulary).
 */
export const USER_INTENT = Object.freeze({
  /** Start working on an issue (default: route to best strategy). */
  START_ISSUE: "start_issue",
  /** Continue working on an existing PR. */
  CONTINUE_PR: "continue_pr",
  /** Start implementing an issue locally (explicit local path). */
  START_LOCAL: "start_local",
  /** Start implementing locally, then hand off to the full loop. */
  START_LOCAL_THEN_LOOP: "start_local_then_loop",
  /** Continue the current dev loop (auto-detect what's active). */
  CONTINUE: "continue",
  /** Query current loop state without acting. */
  STATUS: "status",
});

/**
 * Target artifact types.
 */
export const TARGET_TYPE = Object.freeze({
  ISSUE: "issue",
  PR: "pr",
  LOCAL_BRANCH: "local_branch",
  NONE: "none",
});

/**
 * Who owns the next move.
 */
export const OWNER = Object.freeze({
  /** Local user/Pi session. */
  LOCAL: "local",
  /** GitHub Copilot agent. */
  COPILOT: "copilot",
  /** External human contributor. */
  EXTERNAL_HUMAN: "external_human",
  /** Reviewer (local Pi or human). */
  REVIEWER: "reviewer",
  /** Maintainer (for merge decisions). */
  MAINTAINER: "maintainer",
  /** Unknown or not yet determined. */
  UNKNOWN: "unknown",
});

/**
 * What the current actor is doing.
 */
export const ACTOR_STATE = Object.freeze({
  IMPLEMENTING: "implementing",
  REVIEWING: "reviewing",
  WAITING: "waiting",
  BLOCKED: "blocked",
  APPROVAL_READY: "approval_ready",
  MERGE_READY: "merge_ready",
  DONE: "done",
  IDLE: "idle",
});

/**
 * High-level loop phase taxonomy.
 */
export const LOOP_PHASE = Object.freeze({
  /** No loop active; ready for intake. */
  INTAKE: "intake",
  /** Issue is being refined or normalized. */
  REFINEMENT: "refinement",
  /** Active implementation in progress. */
  IMPLEMENTATION: "implementation",
  /** Review cycle in progress. */
  REVIEW: "review",
  /** Waiting for external action (CI, Copilot review, human response). */
  WAITING: "waiting",
  /** Ready for final approval. */
  APPROVAL: "approval",
  /** Ready to merge. */
  MERGE: "merge",
  /** Fully done. */
  DONE: "done",
});

/**
 * Internal execution strategy identifiers.
 *
 * These map to the existing specialized loop skills/scripts.
 */
export const INTERNAL_STRATEGY = Object.freeze({
  /** Local phased implementation (maps to `dev-loop` skill). */
  LOCAL_IMPLEMENTATION: "local_implementation",
  /** Issue intake and normalization (maps to `copilot-autopilot` intake phase). */
  ISSUE_INTAKE: "issue_intake",
  /** Copilot PR follow-up loop (maps to `copilot-dev-loop` skill). */
  COPILOT_PR_FOLLOWUP: "copilot_pr_followup",
  /** External human PR follow-up (PR by non-Copilot contributor). */
  EXTERNAL_PR_FOLLOWUP: "external_pr_followup",
  /** Reviewer/fixer sub-loop (local review pass). */
  REVIEWER_FIXER: "reviewer_fixer",
  /** Wait/watch sub-loop (poll for external events). */
  WAIT_WATCH: "wait_watch",
  /** Final approval/merge gate. */
  APPROVAL_MERGE: "approval_merge",
  /** Needs clarification from user before routing. */
  NEEDS_CLARIFICATION: "needs_clarification",
});

/**
 * Compatibility mapping from old public entrypoints to internal strategies.
 */
export const COMPATIBILITY_MAP = Object.freeze({
  "dev-loop": INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION,
  "copilot-dev-loop": INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP,
  "copilot-autopilot": INTERNAL_STRATEGY.ISSUE_INTAKE,
});

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

/**
 * Known intent patterns for parseUserIntent.
 * Each entry: [regex, intentType, extractors].
 * @private
 */
const INTENT_PATTERNS = [
  [/^start\s+(?:dev\s+loop\s+on\s+)?issue\s+(?:#?|(?:\S+#))(\d+)$/i, USER_INTENT.START_ISSUE],
  [/^continue\s+(?:dev\s+loop\s+on\s+)?(?:pr|pull\s+request)\s+(?:#?|(?:\S+#))(\d+)$/i, USER_INTENT.CONTINUE_PR],
  [/^start\s+(?:implementing\s+)?issue\s+(?:#?|(?:\S+#))(\d+)\s+locally$/i, USER_INTENT.START_LOCAL],
  [/^start\s+(?:implementing\s+)?issue\s+(?:#?|(?:\S+#))(\d+)\s+locally[\s,]+then\s+(?:continue|enter)\s+(?:the\s+)?(?:dev\s+)?loop$/i, USER_INTENT.START_LOCAL_THEN_LOOP],
  [/^continue\s+(?:the\s+)?(?:current\s+)?dev\s+loop$/i, USER_INTENT.CONTINUE],
  [/^(?:what\s+)?state\s+(?:is\s+)?(?:the\s+)?(?:dev\s+)?loop(?:\s+in)?[?]?$/i, USER_INTENT.STATUS],
  [/^status$/i, USER_INTENT.STATUS],
];

/**
 * Parse a user-intent string into a structured intent object.
 *
 * @param {string} input - Raw user intent string
 * @returns {{ intent: string, targetNumber: number|null, repo: string|null, raw: string }}
 */
export function parseUserIntent(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { intent: null, targetNumber: null, repo: null, raw: input ?? "" };
  }

  const trimmed = input.trim();

  for (const [pattern, intentType] of INTENT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // Extract repo from patterns like owner/repo#N
      const repoMatch = trimmed.match(/(\S+\/\S+)#\d+/);
      const repo = repoMatch ? repoMatch[1] : null;
      const targetNumber = match[1] ? parseInt(match[1], 10) : null;
      return { intent: intentType, targetNumber, repo, raw: trimmed };
    }
  }

  return { intent: null, targetNumber: null, repo: null, raw: trimmed };
}

// ---------------------------------------------------------------------------
// Canonical state resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical top-level state from available signals.
 *
 * This normalizes heterogeneous inputs into the single authoritative state
 * model that drives routing decisions.
 *
 * @param {object} signals
 * @param {string} [signals.targetType] - One of TARGET_TYPE values
 * @param {number|null} [signals.targetNumber] - Issue/PR number
 * @param {string|null} [signals.repo] - Repository slug (owner/name)
 * @param {string} [signals.owner] - One of OWNER values
 * @param {string} [signals.actorState] - One of ACTOR_STATE values
 * @param {string} [signals.loopPhase] - One of LOOP_PHASE values
 * @param {string|null} [signals.copilotState] - From copilot-loop-state.mjs
 * @param {string|null} [signals.reviewerState] - From reviewer-loop-state.mjs
 * @param {string|null} [signals.ownershipState] - From conductor-ownership.mjs
 * @param {boolean} [signals.hasLinkedPR] - Whether the issue has a linked open PR
 * @param {number|null} [signals.linkedPRNumber] - The linked PR number if any
 * @returns {object} Canonical state object
 */
export function resolveCanonicalState(signals = {}) {
  const {
    targetType = TARGET_TYPE.NONE,
    targetNumber = null,
    repo = null,
    owner = OWNER.UNKNOWN,
    actorState = ACTOR_STATE.IDLE,
    loopPhase = LOOP_PHASE.INTAKE,
    copilotState = null,
    reviewerState = null,
    ownershipState = null,
    hasLinkedPR = false,
    linkedPRNumber = null,
  } = signals;

  return Object.freeze({
    targetType,
    targetNumber,
    repo,
    owner,
    actorState,
    loopPhase,
    copilotState,
    reviewerState,
    ownershipState,
    hasLinkedPR,
    linkedPRNumber,
  });
}

// ---------------------------------------------------------------------------
// Deterministic routing
// ---------------------------------------------------------------------------

/**
 * Deterministically route a parsed intent + canonical state to an internal strategy.
 *
 * @param {object} params
 * @param {{ intent: string, targetNumber: number|null, repo: string|null }} params.parsedIntent
 * @param {object} params.canonicalState - From resolveCanonicalState
 * @returns {{ strategy: string, reason: string, compatibility: string|null, actionable: boolean }}
 */
export function routeToStrategy({ parsedIntent, canonicalState }) {
  if (!parsedIntent || !parsedIntent.intent) {
    return {
      strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
      reason: "Could not parse user intent; ask user to clarify what they want to do",
      compatibility: null,
      actionable: false,
    };
  }

  const { intent } = parsedIntent;
  const { targetType, owner, actorState, loopPhase, hasLinkedPR, copilotState } = canonicalState;

  // --- STATUS intent: always actionable, no strategy dispatch ---
  if (intent === USER_INTENT.STATUS) {
    return {
      strategy: null,
      reason: "Status query; report current canonical state without dispatching to a strategy",
      compatibility: null,
      actionable: true,
    };
  }

  // --- START_LOCAL / START_LOCAL_THEN_LOOP: always route to local implementation ---
  if (intent === USER_INTENT.START_LOCAL || intent === USER_INTENT.START_LOCAL_THEN_LOOP) {
    return {
      strategy: INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION,
      reason: "User explicitly requested local implementation path",
      compatibility: "dev-loop",
      actionable: true,
    };
  }

  // --- START_ISSUE: route based on whether a linked PR exists ---
  if (intent === USER_INTENT.START_ISSUE) {
    if (hasLinkedPR && copilotState) {
      // Issue already has a PR in progress — route to copilot follow-up
      return {
        strategy: INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP,
        reason: "Issue has a linked PR with active Copilot state; routing to PR follow-up",
        compatibility: "copilot-dev-loop",
        actionable: true,
      };
    }
    // No linked PR yet — route to issue intake/normalization
    return {
      strategy: INTERNAL_STRATEGY.ISSUE_INTAKE,
      reason: "Issue has no linked PR; routing to issue intake and normalization",
      compatibility: "copilot-autopilot",
      actionable: true,
    };
  }

  // --- CONTINUE_PR: route based on ownership and state ---
  if (intent === USER_INTENT.CONTINUE_PR) {
    if (targetType === TARGET_TYPE.PR || parsedIntent.targetNumber) {
      return routePRContinuation(canonicalState);
    }
    return {
      strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
      reason: "Continue PR requested but no PR target could be identified",
      compatibility: null,
      actionable: false,
    };
  }

  // --- CONTINUE: auto-detect from current state ---
  if (intent === USER_INTENT.CONTINUE) {
    return routeContinuation(canonicalState);
  }

  return {
    strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
    reason: `Unrecognized intent: ${intent}`,
    compatibility: null,
    actionable: false,
  };
}

/**
 * Route a PR continuation based on the canonical state.
 * @private
 */
function routePRContinuation(canonicalState) {
  const { owner, actorState, loopPhase, copilotState, reviewerState } = canonicalState;

  // Done state
  if (actorState === ACTOR_STATE.DONE || loopPhase === LOOP_PHASE.DONE) {
    return {
      strategy: null,
      reason: "PR is already done/merged; no further action needed",
      compatibility: null,
      actionable: false,
    };
  }

  // Blocked state
  if (actorState === ACTOR_STATE.BLOCKED) {
    return {
      strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
      reason: "PR is blocked; human intervention required before continuing",
      compatibility: null,
      actionable: false,
    };
  }

  // Merge-ready
  if (actorState === ACTOR_STATE.MERGE_READY || loopPhase === LOOP_PHASE.MERGE) {
    return {
      strategy: INTERNAL_STRATEGY.APPROVAL_MERGE,
      reason: "PR is merge-ready; routing to approval/merge gate",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  // Waiting state — route to wait/watch
  if (actorState === ACTOR_STATE.WAITING || loopPhase === LOOP_PHASE.WAITING) {
    return {
      strategy: INTERNAL_STRATEGY.WAIT_WATCH,
      reason: "PR is waiting for external action; routing to wait/watch",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  // Reviewer active
  if (actorState === ACTOR_STATE.REVIEWING || loopPhase === LOOP_PHASE.REVIEW) {
    return {
      strategy: INTERNAL_STRATEGY.REVIEWER_FIXER,
      reason: "PR is in review phase; routing to reviewer/fixer sub-loop",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  // External human contributor
  if (owner === OWNER.EXTERNAL_HUMAN) {
    return {
      strategy: INTERNAL_STRATEGY.EXTERNAL_PR_FOLLOWUP,
      reason: "PR owned by external human contributor; routing to external PR follow-up",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  // Copilot-owned implementation
  if (owner === OWNER.COPILOT) {
    return {
      strategy: INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP,
      reason: "PR owned by Copilot; routing to Copilot PR follow-up loop",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  // Local implementation active
  if (owner === OWNER.LOCAL) {
    return {
      strategy: INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION,
      reason: "PR owned locally; routing to local implementation",
      compatibility: "dev-loop",
      actionable: true,
    };
  }

  // Default: copilot PR follow-up as the most common case
  return {
    strategy: INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP,
    reason: "Default PR continuation; routing to Copilot PR follow-up",
    compatibility: "copilot-dev-loop",
    actionable: true,
  };
}

/**
 * Route a generic "continue" request based on the canonical state.
 * @private
 */
function routeContinuation(canonicalState) {
  const { targetType, loopPhase, owner, actorState } = canonicalState;

  // Nothing active
  if (targetType === TARGET_TYPE.NONE && loopPhase === LOOP_PHASE.INTAKE) {
    return {
      strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
      reason: "No active loop detected; ask user what to work on",
      compatibility: null,
      actionable: false,
    };
  }

  // Active PR — delegate to PR continuation logic
  if (targetType === TARGET_TYPE.PR) {
    return routePRContinuation(canonicalState);
  }

  // Active local branch
  if (targetType === TARGET_TYPE.LOCAL_BRANCH) {
    return {
      strategy: INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION,
      reason: "Active local branch detected; routing to local implementation",
      compatibility: "dev-loop",
      actionable: true,
    };
  }

  // Active issue (no PR yet)
  if (targetType === TARGET_TYPE.ISSUE) {
    return {
      strategy: INTERNAL_STRATEGY.ISSUE_INTAKE,
      reason: "Active issue without PR; routing to issue intake",
      compatibility: "copilot-autopilot",
      actionable: true,
    };
  }

  // Fallback based on owner
  if (owner === OWNER.LOCAL) {
    return {
      strategy: INTERNAL_STRATEGY.LOCAL_IMPLEMENTATION,
      reason: "Continuing with local owner; routing to local implementation",
      compatibility: "dev-loop",
      actionable: true,
    };
  }

  if (owner === OWNER.COPILOT) {
    return {
      strategy: INTERNAL_STRATEGY.COPILOT_PR_FOLLOWUP,
      reason: "Continuing with Copilot owner; routing to Copilot PR follow-up",
      compatibility: "copilot-dev-loop",
      actionable: true,
    };
  }

  return {
    strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
    reason: "Cannot determine continuation path from current state; ask user for clarification",
    compatibility: null,
    actionable: false,
  };
}

// ---------------------------------------------------------------------------
// Compatibility bridge
// ---------------------------------------------------------------------------

/**
 * Route from an old public entrypoint name to the unified system.
 *
 * This allows existing `dev-loop`, `copilot-dev-loop`, and `copilot-autopilot`
 * invocations to continue working through the unified façade.
 *
 * @param {string} oldEntrypoint - One of "dev-loop", "copilot-dev-loop", "copilot-autopilot"
 * @param {object} [canonicalState] - Optional state for refined routing
 * @returns {{ strategy: string, reason: string, compatibility: string, deprecated: boolean }}
 */
export function routeFromLegacyEntrypoint(oldEntrypoint, canonicalState = null) {
  const strategy = COMPATIBILITY_MAP[oldEntrypoint];
  if (!strategy) {
    return {
      strategy: INTERNAL_STRATEGY.NEEDS_CLARIFICATION,
      reason: `Unknown legacy entrypoint: ${oldEntrypoint}`,
      compatibility: null,
      deprecated: false,
    };
  }

  return {
    strategy,
    reason: `Legacy entrypoint "${oldEntrypoint}" routed to ${strategy} for backward compatibility`,
    compatibility: oldEntrypoint,
    deprecated: true,
  };
}

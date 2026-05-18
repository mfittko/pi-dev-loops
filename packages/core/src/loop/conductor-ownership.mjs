/**
 * Conductor ownership policy: singleton ownership keys and idempotent orchestration actions.
 *
 * This module provides:
 * - ACTION: supported orchestration action constants
 * - OWNERSHIP_STATE: ownership state taxonomy constants
 * - OUTCOME: idempotency outcome taxonomy constants
 * - normalizeOwnershipKey: validate and canonicalize a raw scope key
 * - classifyOwnershipState: map local records + authoritative signals to an ownership state
 * - evaluateOwnershipAction: central policy entrypoint returning a deterministic outcome
 *
 * Contract guarantees:
 * - One effective owner per normalized orchestration scope
 * - `watch` is non-owning by default; watcher presence alone cannot satisfy conductor ownership
 * - Provisional local state never overrides authoritative live/remote state for final routing
 * - Caller-supplied authoritative/live signals are the authority boundary;
 *   backend discovery, transport, and remote polling semantics remain out of scope here
 *
 * Integration boundary (see docs/conductor-ownership-contract.md):
 * - Callers use evaluateOwnershipAction as the single policy entrypoint
 * - Local singleton coordination is sufficient when no non-terminal local record exists
 * - Authoritative live state must be consulted before routing or mutation decisions
 *   whenever local state is ambiguous or a live-owner signal is needed
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Supported orchestration action constants.
 * `kickoff` is a `start` alias for ownership policy purposes.
 */
export const ACTION = Object.freeze({
  /** Start a new conductor run for this scope. */
  START: "start",
  /** Treated as a `start` alias. */
  KICKOFF: "kickoff",
  /** Resume a prior recorded run for this scope. */
  RESUME: "resume",
  /** Non-owning observation of a scope; never creates or satisfies conductor ownership. */
  WATCH: "watch",
  /** Request a code review for this scope. Requires an existing active owner. */
  REQUEST_REVIEW: "request-review",
  /** Assign work for this scope. Requires an existing active owner. */
  ASSIGN: "assign",
});

/**
 * Ownership state taxonomy constants.
 *
 * These distinguish the six possible ownership conditions for a normalized scope:
 * - `live_owner` — an active/live owner exists (from authoritative signal or local active record)
 * - `recorded_no_live_owner` — non-terminal record exists but no confirmed live owner
 * - `stale_local_record` — only stale/superseded records exist; no non-terminal owner
 * - `duplicate_local_owners` — multiple non-terminal non-watcher local records for the same scope
 * - `watcher_only` — records exist but all are watchers; no owning record present
 * - `no_record` — no records of any kind for this scope
 */
export const OWNERSHIP_STATE = Object.freeze({
  /** An active live owner exists (authoritative or local active record). */
  LIVE_OWNER: "live_owner",
  /** Non-terminal recorded state exists but no live owner is confirmed. */
  RECORDED_NO_LIVE_OWNER: "recorded_no_live_owner",
  /** Only stale/superseded records exist; no non-terminal owner record. */
  STALE_LOCAL_RECORD: "stale_local_record",
  /** Multiple non-terminal non-watcher local records exist for the same scope. */
  DUPLICATE_LOCAL_OWNERS: "duplicate_local_owners",
  /** Records exist but all are watchers; no owning record is present. */
  WATCHER_ONLY: "watcher_only",
  /** No records of any kind for this scope. */
  NO_RECORD: "no_record",
});

/**
 * Idempotency outcome taxonomy constants.
 *
 * These represent the complete closed set of routing decisions for an orchestration action:
 * - `start_new` — safe to create a new owner for this scope
 * - `attach_existing_live_owner` — attach to the existing live owner instead of creating a new one
 * - `resume_recorded_but_not_live_state` — prior non-terminal state exists and can be resumed
 * - `noop_already_satisfied` — the requested action is already satisfied; no change needed
 * - `reject_duplicate_owner` — multiple owners exist; resolve duplicates before routing
 * - `needs_reconcile_before_resume` — ambiguous or conflicting state; must reconcile before routing
 * - `reject_ambiguous_scope` — scope identity is ambiguous; cannot determine single effective owner
 */
export const OUTCOME = Object.freeze({
  /** Safe to create a new owner for this scope. */
  START_NEW: "start_new",
  /** Attach to the existing live owner rather than creating a duplicate. */
  ATTACH_EXISTING_LIVE_OWNER: "attach_existing_live_owner",
  /** Prior non-terminal state exists and can be resumed; no live owner confirmed. */
  RESUME_RECORDED_BUT_NOT_LIVE_STATE: "resume_recorded_but_not_live_state",
  /** The requested action is already satisfied; no ownership change required. */
  NOOP_ALREADY_SATISFIED: "noop_already_satisfied",
  /** Multiple owners exist for this scope; must be resolved before routing new requests. */
  REJECT_DUPLICATE_OWNER: "reject_duplicate_owner",
  /** State is ambiguous or conflicting; authoritative reconciliation required before routing. */
  NEEDS_RECONCILE_BEFORE_RESUME: "needs_reconcile_before_resume",
  /** Scope identity is ambiguous; cannot determine a single effective owner. */
  REJECT_AMBIGUOUS_SCOPE: "reject_ambiguous_scope",
});

// ---------------------------------------------------------------------------
// Internal validation sets
// ---------------------------------------------------------------------------

const VALID_SCOPE_TYPES = new Set(["issue", "pr", "branch", "generic"]);
const VALID_ACTIONS = new Set(Object.values(ACTION));
const VALID_RECORD_STATES = new Set(["active", "inactive", "stale", "terminal"]);
const VALID_REPO_SLUG = /^[^/\s]+\/[^/\s]+$/;

// ---------------------------------------------------------------------------
// Ownership key normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw ownership key into a validated, canonical shape.
 *
 * Identity-bearing fields (included in the key):
 * - repo {string} — "owner/name" qualified repository slug
 * - scopeType {"issue"|"pr"|"branch"|"generic"} — scope category discriminator
 * - scopeId {string|number} — unique identifier within the scope type (e.g., issue #, branch name)
 *
 * Excluded non-semantic noise fields (accepted as raw input but never part of the key):
 * - runId, processId, watcherFlag, any timestamps, retry counters, or local identifiers
 *
 * Ambiguity handling:
 * - scopeId values containing wildcard/glob characters (*, ?, [, ], {, }) are flagged as ambiguous
 * - The literal values "unknown" and "any" are flagged as ambiguous
 * - Ambiguous keys yield `reject_ambiguous_scope` in evaluateOwnershipAction
 *
 * @param {object} raw
 * @returns {{ repo: string, scopeType: string, scopeId: string, keyString: string, isAmbiguous: boolean }}
 * @throws {Error} if required fields are missing or invalid
 */
export function normalizeOwnershipKey(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Ownership key must be a non-null object");
  }

  const repo = typeof raw.repo === "string" && raw.repo.trim().length > 0
    ? raw.repo.trim().toLowerCase()
    : null;
  if (!repo) {
    throw new Error("Ownership key requires a non-empty repo");
  }
  if (!VALID_REPO_SLUG.test(repo)) {
    throw new Error("Ownership key repo must be in owner/name format (e.g., 'acme/my-repo')");
  }

  const scopeType = VALID_SCOPE_TYPES.has(raw.scopeType) ? raw.scopeType : null;
  if (!scopeType) {
    throw new Error(`Ownership key scopeType must be one of: ${[...VALID_SCOPE_TYPES].join(", ")}`);
  }

  const rawScopeId = raw.scopeId;
  const scopeId = rawScopeId !== null && rawScopeId !== undefined
    ? String(rawScopeId).trim()
    : "";
  if (!scopeId) {
    throw new Error("Ownership key requires a non-empty scopeId");
  }

  // Ambiguity check: wildcard characters or well-known ambiguous placeholders
  const isAmbiguous = /[*?[\]{}]/.test(scopeId)
    || scopeId === "unknown"
    || scopeId === "any";

  const keyString = `${repo}:${scopeType}:${scopeId}`;

  return { repo, scopeType, scopeId, keyString, isAmbiguous };
}

// ---------------------------------------------------------------------------
// Local record normalization (internal)
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a single local ownership record.
 *
 * Local record schema:
 * - ownerId {string} — unique identifier for this owner process/run
 * - state {"active"|"inactive"|"stale"|"terminal"} — current record state
 *   - active: currently believed to be live
 *   - inactive: was active; believed no longer live but not formally ended (resume candidate)
 *   - stale: superseded by another run; no longer relevant
 *   - terminal: explicitly ended (done, failed, or cancelled)
 * - isWatcher {boolean} — true if this is a watcher (non-owning), not an owner (default: false)
 *
 * @param {object} raw
 * @param {number} index — position in the input array, for error messages
 * @returns {{ ownerId: string, state: string, isWatcher: boolean }}
 */
function normalizeLocalRecord(raw, index) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`localRecords[${index}] must be a non-null object`);
  }

  const ownerId = typeof raw.ownerId === "string" && raw.ownerId.trim().length > 0
    ? raw.ownerId.trim()
    : null;
  if (!ownerId) {
    throw new Error(`localRecords[${index}] requires a non-empty ownerId`);
  }

  const state = VALID_RECORD_STATES.has(raw.state) ? raw.state : null;
  if (!state) {
    throw new Error(
      `localRecords[${index}] state must be one of: ${[...VALID_RECORD_STATES].join(", ")}`,
    );
  }

  const isWatcher = raw.isWatcher === true;

  return { ownerId, state, isWatcher };
}

// ---------------------------------------------------------------------------
// Ownership state classification
// ---------------------------------------------------------------------------

/**
 * Classify the ownership state for a scope given local records and an optional
 * caller-supplied authoritative live signal.
 *
 * Authority precedence rule: authoritative live state always wins over local records
 * for the live-owner / no-live-owner distinction. Provisional local state never
 * overrides an authoritative signal for final routing or mutation decisions.
 *
 * Local-vs-shared coordination boundary:
 * - Local-only coordination is sufficient when: ownershipState is NO_RECORD or STALE_LOCAL_RECORD,
 *   and for WATCHER_ONLY only on start/resume-style owner creation
 * - Authoritative consultation is required before routing when: LIVE_OWNER (local only, unconfirmed),
 *   RECORDED_NO_LIVE_OWNER (local-only signal), DUPLICATE_LOCAL_OWNERS, or WATCHER_ONLY
 *   for request-review/assign
 *
 * @param {object[]} localRecords — caller-supplied local ownership records for this scope
 * @param {{ hasLiveOwner: boolean, liveOwnerId?: string }|null|undefined} authoritativeLiveState
 *   Caller-supplied authoritative signal. null/undefined means not yet consulted.
 * @returns {string} one of the OWNERSHIP_STATE values
 */
export function classifyOwnershipState(localRecords, authoritativeLiveState) {
  if (localRecords !== null && localRecords !== undefined && !Array.isArray(localRecords)) {
    throw new Error("localRecords must be an array when provided");
  }

  const normalized = (Array.isArray(localRecords) ? localRecords : [])
    .map((r, i) => normalizeLocalRecord(r, i));

  // Authoritative signal takes precedence over all local records
  if (authoritativeLiveState !== null && authoritativeLiveState !== undefined) {
    if (typeof authoritativeLiveState.hasLiveOwner !== "boolean") {
      throw new Error("authoritativeLiveState.hasLiveOwner must be a boolean when provided");
    }

    const activeOwners = normalized.filter(r => !r.isWatcher && r.state === "active");

    if (activeOwners.length > 1) {
      // Multiple local active records remain a duplicate-owner condition even when
      // authoritative state reports a live owner somewhere for the scope. The
      // caller still needs reconciliation before treating the scope as singly owned.
      return OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS;
    }

    if (authoritativeLiveState.hasLiveOwner) {
      // Authoritative confirms a single live owner once duplicate-local-owner
      // ambiguity has been ruled out.
      return OWNERSHIP_STATE.LIVE_OWNER;
    }

    // Authoritative confirms no live owner; duplicate-local-owner ambiguity has
    // already been ruled out above.

    // Authoritative overrides any local "active" record: treat as recorded-but-not-live
    const nonTerminalOwners = normalized.filter(
      r => !r.isWatcher && (r.state === "active" || r.state === "inactive"),
    );
    if (nonTerminalOwners.length > 1) {
      return OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS;
    }

    if (nonTerminalOwners.length === 1) {
      return OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER;
    }

    // Authoritative says no live owner; remaining local analysis for stale/watcher/none
  }

  // Local-only analysis (no authoritative signal provided, or auth confirmed no live owner
  // with no non-terminal local records remaining to classify)
  const ownerRecords = normalized.filter(r => !r.isWatcher);
  const watcherRecords = normalized.filter(r => r.isWatcher);

  if (normalized.length === 0) {
    return OWNERSHIP_STATE.NO_RECORD;
  }

  const activeOwners = ownerRecords.filter(r => r.state === "active");

  if (activeOwners.length > 1) {
    return OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS;
  }

  if (activeOwners.length === 1) {
    // One active local owner — live by local evidence, but authoritative confirmation
    // may still be needed before routing mutations (see requiresAuthoritativeConsultation)
    return OWNERSHIP_STATE.LIVE_OWNER;
  }

  const inactiveOwners = ownerRecords.filter(r => r.state === "inactive");
  if (inactiveOwners.length > 1) {
    return OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS;
  }

  if (inactiveOwners.length === 1) {
    return OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER;
  }

  const staleOwners = ownerRecords.filter(r => r.state === "stale");
  if (staleOwners.length > 0) {
    return OWNERSHIP_STATE.STALE_LOCAL_RECORD;
  }

  // No active, inactive, or stale owner records remain; only terminal or watcher records
  if (watcherRecords.length > 0) {
    return OWNERSHIP_STATE.WATCHER_ONLY;
  }

  return OWNERSHIP_STATE.NO_RECORD;
}

function validateNormalizedOwnershipKey(ownershipKey) {
  const validationError = new Error(
    "evaluateOwnershipAction requires a normalized ownershipKey from normalizeOwnershipKey",
  );

  if (!ownershipKey || typeof ownershipKey !== "object") {
    throw validationError;
  }

  let normalizedOwnershipKey;
  try {
    normalizedOwnershipKey = normalizeOwnershipKey({
      repo: ownershipKey.repo,
      scopeType: ownershipKey.scopeType,
      scopeId: ownershipKey.scopeId,
    });
  } catch {
    throw validationError;
  }

  if (ownershipKey.keyString !== normalizedOwnershipKey.keyString) {
    throw validationError;
  }

  if (ownershipKey.isAmbiguous !== normalizedOwnershipKey.isAmbiguous) {
    throw validationError;
  }

  return normalizedOwnershipKey;
}

// ---------------------------------------------------------------------------
// Idempotency evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate an orchestration action against the current ownership state for a
 * normalized scope, returning a deterministic idempotency outcome.
 *
 * This is the single central policy entrypoint. Callers must use this function
 * rather than implementing ad hoc ownership checks per command.
 *
 * Action semantics:
 * - `start` / `kickoff` (alias) — start or re-attach to an existing owner
 * - `resume` — resume a prior recorded run or start fresh if none exists
 * - `watch` — non-owning observation; returns noop_already_satisfied for
 *   unambiguous scopes with allowOwnerCreation: false; ambiguous scopes are still rejected
 * - `request-review` / `assign` — require an existing active owner; return
 *   noop_already_satisfied when one exists, needs_reconcile otherwise
 *
 * @param {string} action — one of the ACTION values
 * @param {{ repo, scopeType, scopeId, keyString, isAmbiguous }} ownershipKey
 *   Normalized key from normalizeOwnershipKey (shape is re-validated here)
 * @param {object[]} localRecords — local ownership records for this scope
 * @param {{ hasLiveOwner: boolean, liveOwnerId?: string }|null|undefined} authoritativeLiveState
 *   Caller-supplied authoritative signal. Pass null/undefined when not yet consulted.
 * @returns {{
 *   outcome: string,
 *   reason: string,
 *   allowOwnerCreation: boolean,
 *   requiresAuthoritativeConsultation: boolean
 * }}
 */
export function evaluateOwnershipAction(action, ownershipKey, localRecords, authoritativeLiveState) {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`action must be one of: ${[...VALID_ACTIONS].join(", ")}`);
  }

  const normalizedOwnershipKey = validateNormalizedOwnershipKey(ownershipKey);

  // Ambiguous scope: reject immediately, before any ownership classification
  if (normalizedOwnershipKey.isAmbiguous) {
    return {
      outcome: OUTCOME.REJECT_AMBIGUOUS_SCOPE,
      reason: `Scope identity is ambiguous for key '${normalizedOwnershipKey.keyString}'; cannot determine a single effective owner`,
      allowOwnerCreation: false,
      requiresAuthoritativeConsultation: false,
    };
  }

  // watch is non-owning for unambiguous scopes: returns noop_already_satisfied once
  // ambiguous-scope rejection has been ruled out above
  if (action === ACTION.WATCH) {
    return {
      outcome: OUTCOME.NOOP_ALREADY_SATISFIED,
      reason: "watch is non-owning; it does not create or satisfy conductor ownership — watcher presence alone is insufficient",
      allowOwnerCreation: false,
      requiresAuthoritativeConsultation: false,
    };
  }

  const ownershipState = classifyOwnershipState(localRecords, authoritativeLiveState);
  const hasAuthoritativeSignal = authoritativeLiveState !== null && authoritativeLiveState !== undefined;

  // kickoff is a start alias
  const normalizedAction = action === ACTION.KICKOFF ? ACTION.START : action;

  return routeOutcome(normalizedAction, ownershipState, hasAuthoritativeSignal);
}

/**
 * Route the idempotency outcome for a normalized action and ownership state.
 *
 * @param {string} action — normalized action (kickoff already resolved to start)
 * @param {string} ownershipState — one of the OWNERSHIP_STATE values
 * @param {boolean} hasAuthoritativeSignal — true if authoritative live state was supplied
 * @returns {{ outcome, reason, allowOwnerCreation, requiresAuthoritativeConsultation }}
 */
function routeOutcome(action, ownershipState, hasAuthoritativeSignal) {
  const isRequestAction = action === ACTION.REQUEST_REVIEW || action === ACTION.ASSIGN;

  switch (ownershipState) {
    case OWNERSHIP_STATE.NO_RECORD:
      if (isRequestAction) {
        return {
          outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
          reason: "No ownership record exists for this scope; cannot satisfy request-review/assign without an active owner",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: true,
        };
      }
      return {
        outcome: OUTCOME.START_NEW,
        reason: "No existing record for this scope; safe to create a new owner",
        allowOwnerCreation: true,
        requiresAuthoritativeConsultation: false,
      };

    case OWNERSHIP_STATE.LIVE_OWNER:
      if (isRequestAction) {
        return {
          outcome: OUTCOME.NOOP_ALREADY_SATISFIED,
          reason: "A live owner already exists for this scope; action is already satisfied",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: !hasAuthoritativeSignal,
        };
      }
      // start / resume: attach to the existing live owner
      return {
        outcome: OUTCOME.ATTACH_EXISTING_LIVE_OWNER,
        reason: "A live owner already exists for this scope; attach to it rather than creating a duplicate",
        allowOwnerCreation: false,
        // If the live-owner signal came only from local records (no authoritative confirmation),
        // the caller should verify with authoritative state before committing a mutation
        requiresAuthoritativeConsultation: !hasAuthoritativeSignal,
      };

    case OWNERSHIP_STATE.RECORDED_NO_LIVE_OWNER:
      if (isRequestAction) {
        if (!hasAuthoritativeSignal) {
          return {
            outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
            reason: "Recorded non-terminal state but no authoritative confirmation of live-owner absence; cannot satisfy request-review/assign without resolving owner status first",
            allowOwnerCreation: false,
            requiresAuthoritativeConsultation: true,
          };
        }
        return {
          outcome: OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE,
          reason: "Recorded non-terminal state confirmed as no-live-owner by authoritative signal; prior run must be resumed before request-review/assign can proceed",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: false,
        };
      }
      // start / resume: needs authoritative check when no auth signal was supplied
      if (!hasAuthoritativeSignal) {
        return {
          outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
          reason: "Recorded non-terminal state but no authoritative confirmation that the owner is no longer live; consult authoritative state before routing",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: true,
        };
      }
      return {
        outcome: OUTCOME.RESUME_RECORDED_BUT_NOT_LIVE_STATE,
        reason: "Authoritative state confirms no live owner; prior recorded non-terminal state is a resume candidate",
        allowOwnerCreation: false,
        requiresAuthoritativeConsultation: false,
      };

    case OWNERSHIP_STATE.STALE_LOCAL_RECORD:
      if (isRequestAction) {
        return {
          outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
          reason: "Only a stale/superseded local record exists; cannot satisfy request-review/assign without an active owner",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: true,
        };
      }
      return {
        outcome: OUTCOME.START_NEW,
        reason: "Only a stale/superseded local record exists; safe to create a new owner",
        allowOwnerCreation: true,
        requiresAuthoritativeConsultation: false,
      };

    case OWNERSHIP_STATE.DUPLICATE_LOCAL_OWNERS:
      return {
        outcome: OUTCOME.REJECT_DUPLICATE_OWNER,
        reason: "Multiple active local owner records exist for this scope; resolve duplicate owners before routing new requests",
        allowOwnerCreation: false,
        requiresAuthoritativeConsultation: true,
      };

    case OWNERSHIP_STATE.WATCHER_ONLY:
      if (isRequestAction) {
        return {
          outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
          reason: "Only watcher records exist; watcher presence does not satisfy conductor ownership for request-review/assign",
          allowOwnerCreation: false,
          requiresAuthoritativeConsultation: true,
        };
      }
      return {
        outcome: OUTCOME.START_NEW,
        reason: "Only watcher records exist; watchers do not satisfy conductor ownership — safe to create a new owner",
        allowOwnerCreation: true,
        requiresAuthoritativeConsultation: false,
      };

    default:
      return {
        outcome: OUTCOME.NEEDS_RECONCILE_BEFORE_RESUME,
        reason: `Unrecognized ownership state '${ownershipState}'; conservative fallback`,
        allowOwnerCreation: false,
        requiresAuthoritativeConsultation: true,
      };
  }
}

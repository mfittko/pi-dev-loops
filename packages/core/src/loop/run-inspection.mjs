/**
 * Pure snapshot composer for the Copilot PR outer-loop run inspection surface.
 *
 * This module provides a read-only, JSON-first inspection snapshot for one
 * explicitly targeted run in the Copilot PR outer-loop family.
 *
 * It composes already-fetched inner-loop facts into the canonical inspection
 * shape without performing any I/O, checkpoint writes, or state mutations.
 *
 * Schema version: 1
 *
 * Always-present output fields:
 *   ok, schemaVersion, target, inspectedAt, activeStateFamily,
 *   outerAction, activeFamilyState, statusClass, needsAttention,
 *   sourceMode, trust, evidence, markers
 *
 * Best-effort output fields:
 *   layers (copilot, reviewer, steering drill-down)
 *
 * Source precedence:
 *   1. Authoritative live detector-backed facts
 *   2. Bounded local checkpoint artifacts
 *   3. Unknown/unavailable markers when neither is sufficient
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

/** The workflow family this module inspects. */
export const ACTIVE_STATE_FAMILY = "copilot-pr-outer-loop";

export function deriveRunIdForInspectionTarget({ pr }) {
  return `pr-${pr}`;
}

/** Top-level status class values. */
export const STATUS_CLASS = Object.freeze({
  ACTIVE: "active",
  WAITING: "waiting",
  BLOCKED: "blocked",
  DONE: "done",
  UNKNOWN: "unknown",
});

/** Source mode values reflecting evidence availability. */
export const SOURCE_MODE = Object.freeze({
  /** Both inner-loop detectors returned live facts. */
  LIVE_DETECTOR_BACKED: "live-detector-backed",
  /** Live detection failed for all inner loops; state is checkpoint-derived only. */
  CHECKPOINT_ONLY: "checkpoint-only",
  /** Some live facts available; remaining are checkpoint-derived or missing. */
  PARTIAL: "partial",
  /** No live facts and no valid checkpoint available. */
  UNAVAILABLE: "unavailable",
});

/** Trust classification for the inspection output. */
export const TRUST = Object.freeze({
  /** All facts come from live authoritative sources. */
  AUTHORITATIVE: "authoritative",
  /** Facts come from a previously persisted checkpoint (advisory only). */
  CHECKPOINT: "checkpoint",
  /** Facts are a mix of live and checkpoint, or only partial live coverage. */
  DEGRADED: "degraded",
  /** No trustworthy evidence available. */
  UNAVAILABLE: "unavailable",
});

// ---------------------------------------------------------------------------
// Status-class mapping
// ---------------------------------------------------------------------------

/**
 * Map an outerAction value to a top-level statusClass.
 *
 * Mapping:
 *   continue_wait              → waiting
 *   reenter_copilot_loop       → active
 *   reenter_reviewer_loop      → active
 *   stop                       → blocked
 *   done                       → done
 *   anything else / undefined  → unknown
 *
 * @param {string | undefined} outerAction
 * @returns {string} one of STATUS_CLASS values
 */
export function mapOuterActionToStatusClass(outerAction) {
  switch (outerAction) {
    case "continue_wait":
      return STATUS_CLASS.WAITING;
    case "reenter_copilot_loop":
    case "reenter_reviewer_loop":
      return STATUS_CLASS.ACTIVE;
    case "stop":
      return STATUS_CLASS.BLOCKED;
    case "done":
      return STATUS_CLASS.DONE;
    default:
      return STATUS_CLASS.UNKNOWN;
  }
}

// ---------------------------------------------------------------------------
// Snapshot composer
// ---------------------------------------------------------------------------

/**
 * Compose a read-only run inspection snapshot for one explicitly targeted run
 * in the Copilot PR outer-loop family.
 *
 * This function is pure: it performs no I/O and does not mutate any files or
 * checkpoints. All evidence must be gathered by the caller before invoking it.
 *
 * @param {object} params
 * @param {{ repo: string, pr: number }} params.target
 *   Explicit target identity.
 * @param {string} params.inspectedAt
 *   ISO 8601 timestamp of when the inspection was initiated.
 * @param {string | undefined} params.outerAction
 *   Outer-loop action derived by the caller from decideOuterAction with neutral
 *   git status, or undefined when the outer action cannot be determined.
 * @param {string | undefined} [params.outerReason]
 *   Optional reason string from decideOuterAction (e.g. "copilot_blocked").
 * @param {{ snapshot: object, interpretation: { state: string, allowedTransitions: string[], nextAction: string } } | null} params.copilotEvidence
 *   Live copilot inner-loop facts. null when live detection was unavailable.
 * @param {{ snapshot: object, interpretation: { state: string, allowedTransitions: string[], nextAction: string } } | null} params.reviewerEvidence
 *   Live reviewer inner-loop facts. null when live detection was unavailable.
 * @param {object | null} params.existingCheckpoint
 *   Previously persisted outer-loop checkpoint (read-only). null when not found.
 * @param {{ copilot: "ok"|"failed", reviewer: "ok"|"failed" }} params.liveAvailability
 *   Tracks whether each detector/interpreter path succeeded ("ok") or failed ("failed").
 * @param {{ copilot?: "live"|"input", reviewer?: "live"|"input" }} [params.evidenceSourceKinds]
 *   Indicates whether successful evidence came from live detection or caller-supplied snapshot input.
 * @param {boolean} [params.explicitTargetMissing]
 *   True when the explicit target was not found by one or more detector inputs.
 * @param {string | null} [params.steeringLocatorPath]
 *   Path to the steering state file, when explicitly provided by the caller.
 *   null means no locator was given.
 * @param {object | null} [params.steeringEvidence]
 *   Loaded and normalized steering state, or null when file not found.
 * @param {boolean} [params.steeringLoadFailed]
 *   true when a steering locator was provided but loading the file failed.
 * @param {object | null} [params.steeringReadback]
 *   Precomputed steering readback summary for the inspection surface.
 * @returns {object} inspection snapshot with always-present and best-effort fields
 */
export function composeRunInspectionSnapshot({
  target,
  inspectedAt,
  outerAction,
  outerReason,
  copilotEvidence,
  reviewerEvidence,
  existingCheckpoint,
  liveAvailability,
  evidenceSourceKinds = { copilot: "live", reviewer: "live" },
  explicitTargetMissing = false,
  steeringLocatorPath = null,
  steeringEvidence = null,
  steeringLoadFailed = false,
  steeringReadback = null,
}) {
  const { repo, pr } = target;
  const runId = deriveRunIdForInspectionTarget(target);
  const markers = { missing: [], stale: [], conflicts: [] };

  const copilotLiveOk = liveAvailability.copilot === "ok";
  const reviewerLiveOk = liveAvailability.reviewer === "ok";
  const copilotLiveFailed = liveAvailability.copilot === "failed";
  const reviewerLiveFailed = liveAvailability.reviewer === "failed";
  const bothLiveOk = copilotLiveOk && reviewerLiveOk;
  const copilotSourceKind = evidenceSourceKinds.copilot ?? "live";
  const reviewerSourceKind = evidenceSourceKinds.reviewer ?? "live";
  const bothSourceKindsLive = copilotSourceKind === "live" && reviewerSourceKind === "live";
  const inputSnapshotMode = bothLiveOk && !bothSourceKindsLive;

  const evidenceAuthoritative = [];
  const evidenceCheckpoint = [];

  // -------------------------------------------------------------------------
  // Determine source mode and trust
  // -------------------------------------------------------------------------

  let sourceMode;
  let trust;

  if (explicitTargetMissing) {
    sourceMode = SOURCE_MODE.UNAVAILABLE;
    trust = TRUST.UNAVAILABLE;
    markers.missing.push("explicit target PR was not found");
  } else if (bothLiveOk && bothSourceKindsLive) {
    sourceMode = SOURCE_MODE.LIVE_DETECTOR_BACKED;
    trust = TRUST.AUTHORITATIVE;
    evidenceAuthoritative.push("live Copilot loop detector", "live reviewer loop detector");
  } else if (inputSnapshotMode) {
    sourceMode = SOURCE_MODE.PARTIAL;
    trust = TRUST.DEGRADED;
  } else if (!copilotLiveOk && !reviewerLiveOk) {
    if (existingCheckpoint !== null && typeof existingCheckpoint?.outerAction === "string") {
      sourceMode = SOURCE_MODE.CHECKPOINT_ONLY;
      trust = TRUST.CHECKPOINT;
    } else {
      sourceMode = SOURCE_MODE.UNAVAILABLE;
      trust = TRUST.UNAVAILABLE;
    }
    if (copilotLiveFailed) {
      markers.missing.push("live Copilot loop state (detection failed)");
    }
    if (reviewerLiveFailed) {
      markers.missing.push("live reviewer loop state (detection failed)");
    }
  } else {
    // Partial: one live ok, one failed
    sourceMode = SOURCE_MODE.PARTIAL;
    trust = TRUST.DEGRADED;
    if (copilotLiveOk) {
      evidenceAuthoritative.push("live Copilot loop detector");
    } else {
      if (copilotLiveFailed) {
        markers.missing.push("live Copilot loop state (detection failed)");
      }
      if (existingCheckpoint?.copilotState !== undefined) {
        markers.stale.push("copilot loop state (checkpoint-derived; live detection failed)");
      }
    }
    if (reviewerLiveOk) {
      evidenceAuthoritative.push("live reviewer loop detector");
    } else {
      if (reviewerLiveFailed) {
        markers.missing.push("live reviewer loop state (detection failed)");
      }
      if (existingCheckpoint?.reviewerState !== undefined) {
        markers.stale.push("reviewer loop state (checkpoint-derived; live detection failed)");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Checkpoint evidence and conflict detection
  // -------------------------------------------------------------------------

  if (existingCheckpoint !== null) {
    evidenceCheckpoint.push(`tmp/copilot-loop/pr-${pr}/outer-loop-state.json`);

    if (bothLiveOk && outerAction !== undefined) {
      // Check for conflicts between live-derived action and checkpoint
      const ckptOuterAction = existingCheckpoint.outerAction;
      if (typeof ckptOuterAction === "string" && ckptOuterAction !== outerAction) {
        markers.conflicts.push(
          `checkpoint outerAction '${ckptOuterAction}' differs from live-derived '${outerAction}'`,
        );
      }

      const ckptCopilotState = existingCheckpoint.copilotState;
      if (
        copilotEvidence !== null
        && typeof ckptCopilotState === "string"
        && ckptCopilotState !== copilotEvidence.interpretation.state
      ) {
        markers.conflicts.push(
          `checkpoint copilotState '${ckptCopilotState}' differs from live '${copilotEvidence.interpretation.state}'`,
        );
      }

      const ckptReviewerState = existingCheckpoint.reviewerState;
      if (
        reviewerEvidence !== null
        && typeof ckptReviewerState === "string"
        && ckptReviewerState !== reviewerEvidence.interpretation.state
      ) {
        markers.conflicts.push(
          `checkpoint reviewerState '${ckptReviewerState}' differs from live '${reviewerEvidence.interpretation.state}'`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Effective outerAction for unavailable source mode
  // -------------------------------------------------------------------------

  // When no live evidence is available but a valid checkpoint exists, fall back
  // to checkpoint outerAction (already captured above in sourceMode logic).
  const effectiveOuterAction =
    outerAction !== undefined
      ? outerAction
      : (
        sourceMode === SOURCE_MODE.CHECKPOINT_ONLY && typeof existingCheckpoint?.outerAction === "string"
          ? existingCheckpoint.outerAction
          : undefined
      );

  const effectiveOuterReason =
    outerReason !== undefined
      ? outerReason
      : (
        sourceMode === SOURCE_MODE.CHECKPOINT_ONLY && existingCheckpoint?.reason != null
          ? existingCheckpoint.reason
          : undefined
      );

  // -------------------------------------------------------------------------
  // Determine statusClass
  // -------------------------------------------------------------------------

  let statusClass;
  if (sourceMode === SOURCE_MODE.UNAVAILABLE || effectiveOuterAction === undefined) {
    statusClass = STATUS_CLASS.UNKNOWN;
  } else {
    statusClass = mapOuterActionToStatusClass(effectiveOuterAction);
  }

  // -------------------------------------------------------------------------
  // Determine needsAttention
  // -------------------------------------------------------------------------

  const needsAttention =
    effectiveOuterAction === "stop"
    || markers.conflicts.length > 0
    || markers.missing.length > 0
    || sourceMode === SOURCE_MODE.CHECKPOINT_ONLY
    || sourceMode === SOURCE_MODE.UNAVAILABLE
    || (sourceMode === SOURCE_MODE.PARTIAL && !inputSnapshotMode);

  // -------------------------------------------------------------------------
  // Build evidence summary
  // -------------------------------------------------------------------------

  let evidenceSummary;
  if (explicitTargetMissing) {
    evidenceSummary = "The explicit target PR was not found; no current run state could be determined.";
  } else if (sourceMode === SOURCE_MODE.LIVE_DETECTOR_BACKED) {
    if (effectiveOuterAction === "continue_wait") {
      evidenceSummary = `Live detectors agree the PR is in a wait state (outerAction: ${effectiveOuterAction}).`;
    } else if (effectiveOuterAction === "done") {
      evidenceSummary = "Live detectors agree the PR is complete.";
    } else if (effectiveOuterAction === "stop") {
      evidenceSummary = `Live detectors indicate a blocked/stop state${effectiveOuterReason !== undefined ? ` (reason: ${effectiveOuterReason})` : ""}.`;
    } else if (effectiveOuterAction !== undefined) {
      evidenceSummary = `Live detectors indicate active work is needed (outerAction: ${effectiveOuterAction}).`;
    } else {
      evidenceSummary = "Live detectors returned results but outer action could not be determined.";
    }
    if (markers.conflicts.length > 0) {
      evidenceSummary += " Checkpoint state conflicts with live facts.";
    }
  } else if (sourceMode === SOURCE_MODE.CHECKPOINT_ONLY) {
    evidenceSummary =
      "No live detector facts available; using checkpoint state only (degraded confidence).";
  } else if (sourceMode === SOURCE_MODE.PARTIAL) {
    evidenceSummary = inputSnapshotMode
      ? "Caller-supplied snapshot inputs were used; no live detection was performed (degraded confidence)."
      : "Partial live evidence available; some facts are checkpoint-derived (degraded confidence).";
  } else {
    evidenceSummary = "No evidence available to determine current run state.";
  }

  // -------------------------------------------------------------------------
  // Build layers (best-effort drill-down)
  // -------------------------------------------------------------------------

  const layers = {};

  if (copilotLiveOk && copilotEvidence !== null) {
    layers.copilot = {
      currentState: copilotEvidence.interpretation.state,
      allowedTransitions: copilotEvidence.interpretation.allowedTransitions,
    };
  } else if (typeof existingCheckpoint?.copilotState === "string") {
    layers.copilot = {
      currentState: existingCheckpoint.copilotState,
      source: "checkpoint",
    };
  }

  if (reviewerLiveOk && reviewerEvidence !== null) {
    layers.reviewer = {
      currentState: reviewerEvidence.interpretation.state,
      allowedTransitions: reviewerEvidence.interpretation.allowedTransitions,
    };
  } else if (typeof existingCheckpoint?.reviewerState === "string") {
    layers.reviewer = {
      currentState: existingCheckpoint.reviewerState,
      source: "checkpoint",
    };
  }

  // Steering layer (best-effort; only when an explicit locator is provided)
  if (steeringLocatorPath === null || steeringLocatorPath === undefined) {
    layers.steering = {
      status: "unavailable",
      reason: "no_steering_locator",
    };
  } else if (steeringLoadFailed) {
    layers.steering = {
      status: "unavailable",
      reason: "load_failed",
      locatorPath: steeringLocatorPath,
    };
  } else if (steeringEvidence === null) {
    layers.steering = {
      status: "unavailable",
      reason: "no_steering_file",
      locatorPath: steeringLocatorPath,
    };
  } else {
    layers.steering = {
      status: "available",
      locatorPath: steeringLocatorPath,
      state: steeringEvidence,
      ...(steeringReadback ?? {}),
    };
  }

  // -------------------------------------------------------------------------
  // Assemble final snapshot
  // -------------------------------------------------------------------------

  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    target: { repo, pr },
    runId,
    inspectedAt,
    activeStateFamily: ACTIVE_STATE_FAMILY,
    outerAction: effectiveOuterAction ?? "unknown",
    activeFamilyState: effectiveOuterAction ?? "unknown",
    statusClass,
    needsAttention,
    sourceMode,
    trust,
    evidence: {
      summary: evidenceSummary,
      authoritative: evidenceAuthoritative,
      checkpoint: evidenceCheckpoint,
    },
    markers,
    layers,
  };
}

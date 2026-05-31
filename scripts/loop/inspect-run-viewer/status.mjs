import { OUTER_STATE } from "@pi-dev-loops/core/loop/outer-loop-state";

import { renderStateVisualizationSection } from "./graph.mjs";
import {
  escapeHtml,
  formatStateToken,
  humanizeStateToken,
  renderCompactSection,
  titleCaseWords,
} from "./shared.mjs";

export function renderOuterLoopSummarySection(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    return renderCompactSection({ title: "outer-loop summary" });
  }

  return renderCompactSection({
    title: "outer-loop summary",
    entries: [
      ["activeStateFamily", snapshot.activeStateFamily ?? "not present"],
      ["outerState", snapshot.outerState ?? "not present"],
      ["outerAction (compatibility)", snapshot.outerAction ?? "not present"],
      ["activeFamilyState", snapshot.activeFamilyState ?? "not present"],
      ["statusClass", snapshot.statusClass ?? "not present"],
      ["needsAttention", String(snapshot.needsAttention ?? "not present")],
      ["sourceMode", snapshot.sourceMode ?? "not present"],
      ["trust", snapshot.trust ?? "not present"],
      ["evidence.summary", snapshot.evidence?.summary ?? "not present"],
    ],
    lists: [
      { title: "evidence.authoritative", items: snapshot.evidence?.authoritative },
      { title: "evidence.checkpoint", items: snapshot.evidence?.checkpoint },
    ],
  });
}

export function renderCopilotLayerSection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "copilot layer" });
  }

  return renderCompactSection({
    title: "copilot layer",
    entries: [["currentState", layer.currentState ?? "not present"]],
    lists: [{ title: "allowedTransitions", items: layer.allowedTransitions }],
  });
}

export function renderCopilotLoopIterationsSection(snapshot) {
  const loopIterations = snapshot?.loopIterations;

  if (loopIterations === null || loopIterations === undefined) {
    return renderCompactSection({ title: "Copilot loop iterations" });
  }

  const humanSummary = loopIterations.available
    ? [
      `state: ${snapshot?.layers?.copilot?.currentState ?? "not present"}`,
      `iterations: ${loopIterations.completedCopilotReviewRounds} completed, ${loopIterations.pendingCopilotReviewRounds} pending`,
      `comments: ${loopIterations.copilotReviewComments} produced, ${loopIterations.unresolvedReviewThreads} unresolved`,
      `fix commits: ${loopIterations.fixCommitsAfterFeedback}`,
    ].join("; ")
    : "not present / unavailable";

  return renderCompactSection({
    title: "Copilot loop iterations",
    entries: [
      ["available", String(loopIterations.available)],
      ["source", loopIterations.source ?? "not present"],
      ["reason", loopIterations.reason ?? "not present"],
      ["completedCopilotReviewRounds", loopIterations.completedCopilotReviewRounds ?? "not present"],
      ["pendingCopilotReviewRounds", loopIterations.pendingCopilotReviewRounds ?? "not present"],
      ["copilotReviewRequests", loopIterations.copilotReviewRequests ?? "not present"],
      ["copilotReviewComments", loopIterations.copilotReviewComments ?? "not present"],
      ["resolvedReviewThreads", loopIterations.resolvedReviewThreads ?? "not present"],
      ["unresolvedReviewThreads", loopIterations.unresolvedReviewThreads ?? "not present"],
      ["fixCommitsAfterFeedback", loopIterations.fixCommitsAfterFeedback ?? "not present"],
      ["humanSummary", humanSummary],
    ],
  });
}

export function renderReviewerLayerSection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "reviewer layer" });
  }

  return renderCompactSection({
    title: "reviewer layer",
    entries: [
      ["currentState", layer.currentState ?? "not present"],
      ["scope.mode", layer.scope?.mode ?? "not present"],
      ["scope.reviewerLogin", layer.scope?.reviewerLogin ?? "not present"],
    ],
    lists: [{ title: "allowedTransitions", items: layer.allowedTransitions }],
  });
}

export function renderSteeringSummarySection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "steering summary" });
  }

  return renderCompactSection({
    title: "steering summary",
    entries: [
      ["status", layer.status ?? "not present"],
      ["reason", layer.reason ?? "not present"],
    ],
  });
}

function renderReviewerVerdict(snapshot) {
  if (!snapshot) {
    return "not present";
  }

  if (snapshot.layers?.reviewer?.approvedOnCurrentHead === true) {
    return "approved on current head";
  }

  return formatStateToken(snapshot.layers?.reviewer?.submittedReviewState);
}

export function summarizeCurrentPrStatus(snapshot) {
  if (!snapshot) {
    return {
      headline: "Snapshot unavailable",
      detail: "Unable to determine the current PR state yet.",
      nextAction: "Reload the snapshot or open /snapshot.json for the raw error payload.",
    };
  }

  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);
  const statusClass = formatStateToken(snapshot.statusClass, "unknown");
  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");
  const sameHeadCleanConverged = snapshot.layers?.copilot?.sameHeadCleanConverged === true;
  const copilotLoopDisposition = formatStateToken(snapshot.layers?.copilot?.loopDisposition);
  const copilotTerminal = snapshot.layers?.copilot?.terminal === true;
  const reviewerApprovedOnCurrentHead = snapshot.layers?.reviewer?.approvedOnCurrentHead === true;

  if (outerState === OUTER_STATE.DONE_TERMINAL || statusClass === "done" || outerAction === "done" || copilotState === "done") {
    return {
      headline: "PR complete",
      detail: "The current inspection says this PR is in a terminal done state.",
      nextAction: "Confirm merge/readiness context or inspect the raw snapshot for terminal evidence.",
    };
  }

  if (outerState === OUTER_STATE.NEEDS_RECONCILE) {
    return {
      headline: "Needs reconcile",
      detail: "The authoritative outer state is needs_reconcile, which means the current inputs are ambiguous, conflicting, or insufficient.",
      nextAction: "Reconcile the conflicting state before trusting the current routing result.",
    };
  }

  if (outerState === OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER) {
    return {
      headline: "Live owner already active",
      detail: "The authoritative outer state is stay_with_current_live_owner, so the loop should not issue a new handoff yet.",
      nextAction: "Wait for the live owner to progress the run, then refresh the inspection.",
    };
  }

  if (outerState === OUTER_STATE.STOP_NEEDS_HUMAN) {
    return {
      headline: "Needs attention",
      detail: "The authoritative outer state is stop_needs_human, so automated progress should stop until a human resolves the blocking condition.",
      nextAction: "Read the stop reason, trust markers, and layer summaries before proceeding.",
    };
  }

  if (copilotState === "unresolved_feedback_present") {
    return {
      headline: "Needs author fixes",
      detail: "Copilot has unresolved feedback on the current PR head.",
      nextAction: "Address the feedback, then reply to and resolve each addressed thread.",
    };
  }

  if (copilotState === "already_fixed_needs_reply_resolve") {
    return {
      headline: "Fixes applied; threads still need resolution",
      detail: "Local fixes appear applied, but GitHub review threads still need reply/resolve follow-up.",
      nextAction: "Reply to and resolve the addressed review threads before requesting another Copilot pass.",
    };
  }

  if (copilotState === "waiting_for_copilot_review") {
    return {
      headline: "Waiting for Copilot review",
      detail: "Copilot review has been requested and the PR is waiting for new review activity.",
      nextAction: "Wait for Copilot review or refresh the snapshot after review activity lands.",
    };
  }

  if (copilotState === "ready_to_rerequest_review" && reviewerApprovedOnCurrentHead && (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged" || copilotTerminal)) {
    return {
      headline: "Clean reviews present; gate evidence still required",
      detail: "The current head has both a clean submitted Copilot review and an approved human review, but approval or merge suggestions still require explicit current-head pre_approval_gate evidence.",
      nextAction: "Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation.",
    };
  }

  if (copilotState === "ready_to_rerequest_review" && (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged" || copilotTerminal)) {
    return {
      headline: "Copilot pass complete; gate evidence still required",
      detail: "The current head already has a clean submitted Copilot review with no unresolved feedback, but that alone is not enough for an approval or merge suggestion.",
      nextAction: "Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation, or wait for a meaningful remediation event before requesting another Copilot pass.",
    };
  }

  if (copilotState === "ready_to_rerequest_review") {
    return {
      headline: "Ready to re-request Copilot review",
      detail: "The current head looks clean enough for another Copilot pass or final confirmation.",
      nextAction: "Re-request Copilot review only after the smallest honest local validation is green, or confirm the PR is done.",
    };
  }

  if (reviewerState === "waiting_for_author_followup") {
    return {
      headline: "Waiting for author follow-up",
      detail: "Reviewer work is done for this round and the PR is waiting on author-side changes.",
      nextAction: "Wait for author commits or refresh after follow-up lands.",
    };
  }

  if (reviewerState === "waiting_for_re_request") {
    return {
      headline: "Waiting for reviewer re-request",
      detail: "Reviewer work is paused until a new explicit review request arrives.",
      nextAction: "Wait for a reviewer re-request after follow-up commits.",
    };
  }

  if (reviewerState === "review_requested" || reviewerState === "determine_review_plan" || reviewerState === "reviews_running" || reviewerState === "merge_results" || reviewerState === "draft_review_ready" || reviewerState === "draft_review_posted" || reviewerState === "waiting_for_user_submit" || reviewerState === "submitted_review" || reviewerState === "review_invalidated") {
    return {
      headline: "Reviewer loop active",
      detail: `Reviewer lane is currently at ${humanizeStateToken(reviewerState)}.`,
      nextAction: "Follow the reviewer lane details below and refresh after the next review event.",
    };
  }

  if (copilotState === "waiting_for_ci") {
    return {
      headline: "Waiting for CI",
      detail: "The current head has progressed past review but is still waiting on CI readiness.",
      nextAction: "Wait for CI to complete or become available.",
    };
  }

  if (outerState === "unknown" && snapshot.needsAttention) {
    return {
      headline: "Needs attention",
      detail: "The current snapshot is not authoritative enough to collapse to one trusted outer state.",
      nextAction: "Check trust markers and layer summaries before acting on this snapshot.",
    };
  }

  if (outerAction === "stop" || statusClass === "blocked") {
    return {
      headline: "Needs attention",
      detail: "The inspection found a blocked or stop-like state, but the authoritative outer state was not specific enough to classify it more narrowly here.",
      nextAction: "Read the stop reason, trust markers, and layer summaries before proceeding.",
    };
  }

  if (outerState === OUTER_STATE.CONTINUE_CURRENT_WAIT || outerAction === "continue_wait") {
    return {
      headline: "Waiting for follow-up",
      detail: "The authoritative outer state is continue_current_wait, so the loop should remain in its durable wait path for now.",
      nextAction: "Refresh after new review, CI, or author activity lands.",
    };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP || outerAction === "reenter_copilot_loop") {
    return {
      headline: "Copilot loop needs action",
      detail: "The authoritative outer state is handoff_to_copilot_loop, so the next meaningful work is in the Copilot lane.",
      nextAction: "Inspect the Copilot state and act on the requested follow-up.",
    };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP || outerAction === "reenter_reviewer_loop") {
    return {
      headline: "Reviewer loop needs action",
      detail: "The authoritative outer state is handoff_to_reviewer_loop, so the next meaningful work is in the reviewer lane.",
      nextAction: "Inspect the reviewer state and act on the requested follow-up.",
    };
  }

  return {
    headline: titleCaseWords(humanizeStateToken(copilotState === "not present" ? (outerState === "unknown" ? outerAction : outerState) : copilotState)),
    detail: "The viewer could not collapse this to a narrower plain-English status than the current exported loop states.",
    nextAction: "Use the current-state banner fields plus the graph and summaries below.",
  };
}

function renderCurrentStateNote(snapshot) {
  if (!snapshot) {
    return "Unable to determine the current PR state yet.";
  }

  if (snapshot.sourceMode === "unavailable") {
    return "Snapshot unavailable. Open /snapshot.json or reload once the inspection surface is available again.";
  }

  if ((snapshot.markers?.conflicts?.length ?? 0) > 0) {
    return "Conflicting evidence is present. Treat the current-state fields below as advisory until the snapshot is reconciled.";
  }

  if (snapshot.sourceMode === "checkpoint-only") {
    return "This is a checkpoint-only snapshot. The current-state fields below are advisory, not live-confirmed.";
  }

  if (snapshot.sourceMode === "partial" || snapshot.trust === "degraded") {
    return "This snapshot is degraded. The current-state fields below may be incomplete and should be cross-checked against the graph and raw snapshot.";
  }

  return "These fields are shown directly from the loaded inspection snapshot so the current state stays visible without inventing a second viewer-only status model.";
}

function buildPullRequestHref(target) {
  if (!target?.repo || target?.pr === null || target?.pr === undefined) {
    return null;
  }
  return `https://github.com/${encodeURIComponent(target.repo).replaceAll("%2F", "/")}/pull/${encodeURIComponent(String(target.pr))}`;
}

function summarizeCurrentPrMode(snapshot) {
  if (!snapshot) {
    return null;
  }

  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);
  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");

  if (deriveInboxSignalFromSnapshot(snapshot) === "ready") {
    return { emoji: "✅", label: "Approved" };
  }

  if (copilotState === "waiting_for_copilot_review"
    || copilotState === "waiting_for_ci"
    || reviewerState === "waiting_for_author_followup"
    || reviewerState === "waiting_for_re_request"
    || outerState === OUTER_STATE.CONTINUE_CURRENT_WAIT
    || outerState === OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER
    || outerAction === "continue_wait") {
    return { emoji: "⏳", label: "Waiting state" };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP
    || outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP
    || outerAction === "reenter_copilot_loop"
    || outerAction === "reenter_reviewer_loop"
    || reviewerState === "review_requested"
    || reviewerState === "determine_review_plan"
    || reviewerState === "reviews_running"
    || reviewerState === "merge_results"
    || reviewerState === "draft_review_ready"
    || reviewerState === "draft_review_posted"
    || reviewerState === "waiting_for_user_submit"
    || reviewerState === "submitted_review"
    || reviewerState === "review_invalidated") {
    return { emoji: "🔁", label: "Active loop" };
  }

  return null;
}

export function renderCurrentStateBanner(snapshot, target, stateLabel, graph, selectedTitle = null) {
  const summary = summarizeCurrentPrStatus(snapshot);
  const pullRequestHref = buildPullRequestHref(target);
  const mode = summarizeCurrentPrMode(snapshot);
  const heading = typeof selectedTitle === "string" && selectedTitle.trim().length > 0
    ? selectedTitle.trim()
    : `PR #${target.pr}`;
  return `<section class="current-pr-state-banner" aria-label="PR #${escapeHtml(target.pr)}">
    <div class="current-pr-state-heading-row">
      <div class="current-pr-state-heading-copy">
        <p class="current-pr-state-kicker">${pullRequestHref
          ? `<a href="${escapeHtml(pullRequestHref)}">PR #${escapeHtml(target.pr)}</a>`
          : `PR #${escapeHtml(target.pr)}`}</p>
        <h1>${escapeHtml(heading)}</h1>
      </div>
      ${mode ? `<span class="current-pr-state-mode-indicator" title="${escapeHtml(mode.label)}" aria-label="${escapeHtml(mode.label)}">${escapeHtml(mode.emoji)}</span>` : ""}
    </div>
    <p class="current-pr-state-summary-headline">${escapeHtml(summary.headline)}</p>
    <p class="current-pr-state-detail">${escapeHtml(summary.detail)}</p>
    <p class="current-pr-state-detail">${escapeHtml(renderCurrentStateNote(snapshot))}</p>
    <dl class="current-pr-state-grid">
      <dt>target</dt><dd><code>${escapeHtml(target.repo)}#${escapeHtml(target.pr)}</code></dd>
      <dt>snapshot trust</dt><dd><span class="badge">${escapeHtml(stateLabel)}</span></dd>
      <dt>status class</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.statusClass))}</code></dd>
      <dt>outer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.outerState))}</code></dd>
      <dt>outerAction (compatibility)</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.outerAction))}</code></dd>
      <dt>current Copilot state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.copilot?.currentState))}</code></dd>
      <dt>current reviewer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.reviewer?.currentState))}</code></dd>
      <dt>reviewer verdict</dt><dd>${escapeHtml(renderReviewerVerdict(snapshot))}</dd>
      <dt>needs attention</dt><dd>${escapeHtml(String(snapshot?.needsAttention ?? "not present"))}</dd>
      <dt>next action</dt><dd>${escapeHtml(summary.nextAction)}</dd>
      <dt>trust</dt><dd>${escapeHtml(snapshot?.evidence?.summary ?? "not present")}</dd>
    </dl>
    <div class="current-pr-state-visualization">
      ${renderStateVisualizationSection(snapshot, graph)}
    </div>
  </section>`;
}

export function deriveInboxSignalFromSnapshot(snapshot) {
  if (!snapshot) {
    return "unknown";
  }

  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");
  const statusClass = formatStateToken(snapshot.statusClass, "unknown");
  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const sameHeadCleanConverged = snapshot.layers?.copilot?.sameHeadCleanConverged === true;
  const copilotLoopDisposition = formatStateToken(snapshot.layers?.copilot?.loopDisposition);
  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);

  if (snapshot.needsAttention === true
    || outerState === OUTER_STATE.NEEDS_RECONCILE
    || outerState === OUTER_STATE.STOP_NEEDS_HUMAN
    || outerAction === "stop"
    || statusClass === "blocked"
    || copilotState === "unresolved_feedback_present"
    || copilotState === "already_fixed_needs_reply_resolve") {
    return "attention";
  }

  if (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged") {
    return "gate";
  }

  if (copilotState === "waiting_for_copilot_review"
    || reviewerState === "waiting_for_author_followup"
    || reviewerState === "waiting_for_re_request") {
    return "waiting";
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP
    || outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP
    || outerAction === "reenter_copilot_loop"
    || outerAction === "reenter_reviewer_loop") {
    return "attention";
  }

  if (copilotState === "waiting_for_ci") {
    return "pending";
  }

  if (outerState === OUTER_STATE.DONE_TERMINAL || statusClass === "done") {
    return "ready";
  }

  if (snapshot.sourceMode === "unavailable") {
    return "unknown";
  }

  return "waiting";
}

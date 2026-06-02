import { LOOP_DISPOSITION, STATE } from "./copilot-loop-state.mjs";

export const PR_GATE_BOUNDARY = Object.freeze({
  DRAFT_REVIEW: "draft_review",
  POST_DRAFT_EXTERNAL_REVIEW: "post_draft_external_review",
  FEEDBACK_RESOLUTION: "feedback_resolution",
  PRE_APPROVAL_GATE_WINDOW: "pre_approval_gate_window",
  FINAL_APPROVAL_READY: "final_approval_ready",
  BLOCKED: "blocked",
  DONE: "done",
});

export const PR_GATE_ACTION = Object.freeze({
  RUN_DRAFT_GATE: "run_draft_gate",
  MARK_READY_FOR_REVIEW: "mark_ready_for_review",
  REQUEST_COPILOT_REVIEW: "request_copilot_review",
  WAIT_FOR_COPILOT_REVIEW: "wait_for_copilot_review",
  WAIT_FOR_CI: "wait_for_ci",
  ADDRESS_REVIEW_FEEDBACK: "address_review_feedback",
  REPLY_RESOLVE_REVIEW_THREADS: "reply_resolve_review_threads",
  REREQUEST_COPILOT_REVIEW: "rerequest_copilot_review",
  RUN_PRE_APPROVAL_GATE: "run_pre_approval_gate",
  AWAIT_FINAL_HUMAN_APPROVAL: "await_final_human_approval",
  DECLARE_MERGE_READY: "declare_merge_ready",
  REPORT_BLOCKED: "report_blocked",
  REPORT_DONE: "report_done",
});

function normalizeGateComment(summary = null) {
  if (!summary || typeof summary !== "object") {
    return {
      visible: false,
      headSha: null,
      verdict: null,
      findingsSummary: null,
      nextAction: null,
      contractComplete: false,
    };
  }

  return {
    visible: summary.visible === true,
    headSha: typeof summary.headSha === "string" && summary.headSha.trim().length > 0 ? summary.headSha.trim() : null,
    verdict: typeof summary.verdict === "string" && summary.verdict.trim().length > 0 ? summary.verdict.trim().toLowerCase() : null,
    findingsSummary: typeof summary.findingsSummary === "string" && summary.findingsSummary.trim().length > 0
      ? summary.findingsSummary.trim()
      : null,
    nextAction: typeof summary.nextAction === "string" && summary.nextAction.trim().length > 0
      ? summary.nextAction.trim()
      : null,
    contractComplete: summary.contractComplete === true,
  };
}

function toGateStatus(comment, marker, currentHeadSha) {
  const normalizedComment = normalizeGateComment(comment);
  const normalizedMarker = normalizeGateComment(marker);
  const markerHeadMatches = normalizedMarker.headSha !== null
    && typeof currentHeadSha === "string"
    && currentHeadSha.startsWith(normalizedMarker.headSha);

  const cleanEvidenceExists = normalizedComment.visible && normalizedComment.verdict === "clean" && normalizedComment.headSha !== null;

  return {
    visible: normalizedComment.visible,
    currentHead: normalizedMarker.visible && markerHeadMatches,
    headSha: normalizedComment.headSha,
    verdict: normalizedComment.verdict,
    findingsSummary: normalizedComment.findingsSummary,
    nextAction: normalizedComment.nextAction,
    contractComplete: normalizedMarker.visible && markerHeadMatches && normalizedMarker.contractComplete,
    currentHeadClean: normalizedMarker.visible && markerHeadMatches && normalizedMarker.verdict === "clean" && normalizedMarker.contractComplete,
    cleanEvidenceExists,
  };
}

function pushUnique(values, additions) {
  for (const value of additions) {
    if (typeof value === "string" && value.length > 0 && !values.includes(value)) {
      values.push(value);
    }
  }
}

function buildResult({
  draftGateAlreadySatisfied = false,
  repo = null,
  pr = null,
  currentHeadSha = null,
  lifecycleState,
  loopDisposition,
  gateBoundary,
  draftGate,
  preApprovalGate,
  allowedNextActions,
  forbiddenActions,
  nextAction,
  reason,
}) {
  return {
    ok: true,
    ...(repo ? { repo } : {}),
    ...(pr !== null ? { pr } : {}),
    currentHeadSha,
    lifecycleState,
    loopDisposition,
    gateBoundary,
    draftGate,
    preApprovalGate,
    allowedNextActions,
    forbiddenActions,
    nextAction,
    reason,
    draftGateAlreadySatisfied,
  };
}

export function evaluatePrGateCoordination(input = {}) {
  const currentHeadSha = typeof input.currentHeadSha === "string" && input.currentHeadSha.trim().length > 0
    ? input.currentHeadSha.trim()
    : null;
  const lifecycleState = typeof input.lifecycleState === "string" ? input.lifecycleState.trim().toLowerCase() : "";
  const loopDisposition = typeof input.loopDisposition === "string" ? input.loopDisposition.trim().toLowerCase() : null;
  const prDraft = input.prDraft === true;
  const prClosed = input.prClosed === true;
  const prMerged = input.prMerged === true;
  const sameHeadCleanConverged = input.sameHeadCleanConverged === true;
  const reviewMode = typeof input.reviewMode === "string"
    ? input.reviewMode.trim().toLowerCase()
    : null;

  const draftGate = toGateStatus(input.draftGate, input.draftGateMarker, currentHeadSha);
  const preApprovalGate = toGateStatus(input.preApprovalGate, input.preApprovalGateMarker, currentHeadSha);
  const draftGateAlreadySatisfied = !prDraft && (draftGate?.cleanEvidenceExists ?? false);

  const allowedNextActions = [];
  const forbiddenActions = [];

  if (prMerged || prClosed || lifecycleState === STATE.DONE) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.REPORT_DONE]);
    pushUnique(forbiddenActions, [
      PR_GATE_ACTION.RUN_DRAFT_GATE,
      PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ]);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.DONE,
      gateBoundary: PR_GATE_BOUNDARY.DONE,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.REPORT_DONE,
      reason: "The pull request is already closed or merged, so no further gate entry is legal.",
    });
  }

  if (lifecycleState === STATE.BLOCKED_NEEDS_USER_DECISION || lifecycleState === STATE.REVIEW_REQUEST_UNAVAILABLE) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.REPORT_BLOCKED]);
    pushUnique(forbiddenActions, [
      PR_GATE_ACTION.RUN_DRAFT_GATE,
      PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ]);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.BLOCKED,
      gateBoundary: PR_GATE_BOUNDARY.BLOCKED,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.REPORT_BLOCKED,
      reason: "The PR is in a blocked lifecycle state, so gate progression must stop for a user decision.",
    });
  }

  if (prDraft || lifecycleState === STATE.PR_DRAFT) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.RUN_DRAFT_GATE]);
    if (draftGate.currentHeadClean) {
      pushUnique(allowedNextActions, [PR_GATE_ACTION.MARK_READY_FOR_REVIEW]);
    }
    pushUnique(forbiddenActions, [
      ...(draftGate.currentHeadClean ? [] : [PR_GATE_ACTION.MARK_READY_FOR_REVIEW]),
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.WAIT_FOR_COPILOT_REVIEW,
      PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ]);

    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState: lifecycleState || STATE.PR_DRAFT,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.ACTION_REQUIRED,
      gateBoundary: PR_GATE_BOUNDARY.DRAFT_REVIEW,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: draftGate.currentHeadClean ? PR_GATE_ACTION.MARK_READY_FOR_REVIEW : PR_GATE_ACTION.RUN_DRAFT_GATE,
      reason: draftGate.currentHeadClean
        ? "The PR is still draft, and current-head clean `draft_gate` evidence exists, so `gh pr ready` is now legal."
        : "The PR is still draft, so `draft_gate` is the only legal gate boundary before `gh pr ready`.",
    });
  }

  if (!draftGate.cleanEvidenceExists) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.REPORT_BLOCKED]);
    pushUnique(forbiddenActions, [
      PR_GATE_ACTION.RUN_DRAFT_GATE,
      PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.WAIT_FOR_COPILOT_REVIEW,
      PR_GATE_ACTION.WAIT_FOR_CI,
      PR_GATE_ACTION.ADDRESS_REVIEW_FEEDBACK,
      PR_GATE_ACTION.REPLY_RESOLVE_REVIEW_THREADS,
      PR_GATE_ACTION.REREQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ]);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: LOOP_DISPOSITION.BLOCKED,
      gateBoundary: PR_GATE_BOUNDARY.BLOCKED,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.REPORT_BLOCKED,
      reason: "The PR is already non-draft and no clean `draft_gate` evidence exists at all, so no draft-gate transition was ever recorded; fail closed and reconcile draft-stage evidence before continuing.",
    });
  }

  const postDraftForbidden = [
    PR_GATE_ACTION.RUN_DRAFT_GATE,
    PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
    PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
    PR_GATE_ACTION.DECLARE_MERGE_READY,
  ];

  const localFirstPostDraftForbidden = [
    PR_GATE_ACTION.RUN_DRAFT_GATE,
    PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
    PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
    PR_GATE_ACTION.DECLARE_MERGE_READY,
  ];

  if (lifecycleState === STATE.PR_READY_NO_FEEDBACK) {
    if (reviewMode === "local_first") {
      // Explicitly local-first PR: skip the external Copilot review cycle
      if (preApprovalGate.currentHeadClean) {
        pushUnique(allowedNextActions, [PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL]);
        pushUnique(forbiddenActions, localFirstPostDraftForbidden);
        return buildResult({
          repo: input.repo ?? null,
          pr: Number.isInteger(input.pr) ? input.pr : null,
          currentHeadSha,
          lifecycleState,
          loopDisposition: loopDisposition ?? LOOP_DISPOSITION.CLEAN_CONVERGED,
          gateBoundary: PR_GATE_BOUNDARY.FINAL_APPROVAL_READY,
          draftGateAlreadySatisfied,
          draftGate,
          preApprovalGate,
          allowedNextActions,
          forbiddenActions,
          nextAction: PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL,
          reason: "This is an explicitly local-first PR with clean draft_gate evidence and current-head clean pre_approval_gate, so it is ready for final human approval.",
        });
      }

      pushUnique(allowedNextActions, [PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE]);
      pushUnique(forbiddenActions, localFirstPostDraftForbidden);
      return buildResult({
        repo: input.repo ?? null,
        pr: Number.isInteger(input.pr) ? input.pr : null,
        currentHeadSha,
        lifecycleState,
        loopDisposition: loopDisposition ?? LOOP_DISPOSITION.ACTION_REQUIRED,
        gateBoundary: PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW,
        draftGateAlreadySatisfied,
        draftGate,
        preApprovalGate,
        allowedNextActions,
        forbiddenActions,
        nextAction: PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
        reason: "This is an explicitly local-first PR, so `pre_approval_gate` is the next legal boundary instead of an external Copilot review cycle.",
      });
    }

    pushUnique(allowedNextActions, [PR_GATE_ACTION.REQUEST_COPILOT_REVIEW]);
    pushUnique(forbiddenActions, postDraftForbidden);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.ACTION_REQUIRED,
      gateBoundary: PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      reason: "The PR is ready for review but the post-draft external review cycle has not started yet; request Copilot review before any `pre_approval_gate` entry.",
    });
  }

  if (lifecycleState === STATE.WAITING_FOR_COPILOT_REVIEW || lifecycleState === STATE.WAITING_FOR_CI) {
    const waitAction = lifecycleState === STATE.WAITING_FOR_CI
      ? PR_GATE_ACTION.WAIT_FOR_CI
      : PR_GATE_ACTION.WAIT_FOR_COPILOT_REVIEW;

    pushUnique(allowedNextActions, [waitAction]);
    pushUnique(forbiddenActions, postDraftForbidden);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.PENDING,
      gateBoundary: PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: waitAction,
      reason: lifecycleState === STATE.WAITING_FOR_CI
        ? "The post-draft review cycle is waiting on current-head CI, so `pre_approval_gate` remains illegal until CI settles cleanly."
        : "The post-draft review cycle is still pending on Copilot review, so `pre_approval_gate` remains illegal until the current-head review cycle settles.",
    });
  }

  if (lifecycleState === STATE.UNRESOLVED_FEEDBACK_PRESENT) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.ADDRESS_REVIEW_FEEDBACK]);
    pushUnique(forbiddenActions, postDraftForbidden);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.UNRESOLVED_FEEDBACK,
      gateBoundary: PR_GATE_BOUNDARY.FEEDBACK_RESOLUTION,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.ADDRESS_REVIEW_FEEDBACK,
      reason: "Actionable unresolved feedback exists, so follow-up work must stay in the review/fix cycle and cannot enter `pre_approval_gate` yet.",
    });
  }

  if (lifecycleState === STATE.ALREADY_FIXED_NEEDS_REPLY_RESOLVE) {
    pushUnique(allowedNextActions, [PR_GATE_ACTION.REPLY_RESOLVE_REVIEW_THREADS]);
    pushUnique(forbiddenActions, postDraftForbidden);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.UNRESOLVED_FEEDBACK,
      gateBoundary: PR_GATE_BOUNDARY.FEEDBACK_RESOLUTION,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.REPLY_RESOLVE_REVIEW_THREADS,
      reason: "Fixes were applied, but unresolved threads still need reply/resolve handling before another gate boundary is legal.",
    });
  }

  if (lifecycleState === STATE.READY_TO_REREQUEST_REVIEW) {
    if (!sameHeadCleanConverged) {
      pushUnique(allowedNextActions, [PR_GATE_ACTION.REREQUEST_COPILOT_REVIEW]);
      pushUnique(forbiddenActions, postDraftForbidden);
      return buildResult({
        repo: input.repo ?? null,
        pr: Number.isInteger(input.pr) ? input.pr : null,
        currentHeadSha,
        lifecycleState,
        loopDisposition: loopDisposition ?? LOOP_DISPOSITION.ACTION_REQUIRED,
        gateBoundary: PR_GATE_BOUNDARY.POST_DRAFT_EXTERNAL_REVIEW,
        draftGateAlreadySatisfied,
        draftGate,
        preApprovalGate,
        allowedNextActions,
        forbiddenActions,
        nextAction: PR_GATE_ACTION.REREQUEST_COPILOT_REVIEW,
        reason: "The review loop is between passes, but the current head does not yet have a clean settled Copilot convergence point, so `pre_approval_gate` is still forbidden.",
      });
    }

    if (preApprovalGate.currentHeadClean) {
      pushUnique(allowedNextActions, [PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL]);
      pushUnique(forbiddenActions, [
        PR_GATE_ACTION.RUN_DRAFT_GATE,
        PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
        PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
        PR_GATE_ACTION.DECLARE_MERGE_READY,
      ]);
      return buildResult({
        repo: input.repo ?? null,
        pr: Number.isInteger(input.pr) ? input.pr : null,
        currentHeadSha,
        lifecycleState,
        loopDisposition: loopDisposition ?? LOOP_DISPOSITION.CLEAN_CONVERGED,
        gateBoundary: PR_GATE_BOUNDARY.FINAL_APPROVAL_READY,
        draftGateAlreadySatisfied,
        draftGate,
        preApprovalGate,
        allowedNextActions,
        forbiddenActions,
        nextAction: PR_GATE_ACTION.AWAIT_FINAL_HUMAN_APPROVAL,
        reason: "The current head has both a clean settled review cycle and clean `pre_approval_gate` evidence, so the PR is at the final approval boundary.",
      });
    }

    pushUnique(allowedNextActions, [PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE]);
    pushUnique(forbiddenActions, [
      PR_GATE_ACTION.RUN_DRAFT_GATE,
      PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
      PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
      PR_GATE_ACTION.DECLARE_MERGE_READY,
    ]);
    return buildResult({
      repo: input.repo ?? null,
      pr: Number.isInteger(input.pr) ? input.pr : null,
      currentHeadSha,
      lifecycleState,
      loopDisposition: loopDisposition ?? LOOP_DISPOSITION.CLEAN_CONVERGED,
      gateBoundary: PR_GATE_BOUNDARY.PRE_APPROVAL_GATE_WINDOW,
      draftGateAlreadySatisfied,
      draftGate,
      preApprovalGate,
      allowedNextActions,
      forbiddenActions,
      nextAction: PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
      reason: "The current head has a clean settled post-draft review cycle, so `pre_approval_gate` is now the next legal boundary.",
    });
  }

  pushUnique(allowedNextActions, [PR_GATE_ACTION.REPORT_BLOCKED]);
  pushUnique(forbiddenActions, [
    PR_GATE_ACTION.RUN_DRAFT_GATE,
    PR_GATE_ACTION.MARK_READY_FOR_REVIEW,
    PR_GATE_ACTION.REQUEST_COPILOT_REVIEW,
    PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE,
    PR_GATE_ACTION.DECLARE_MERGE_READY,
  ]);
  return buildResult({
    repo: input.repo ?? null,
    pr: Number.isInteger(input.pr) ? input.pr : null,
    currentHeadSha,
    lifecycleState,
    loopDisposition: loopDisposition ?? LOOP_DISPOSITION.BLOCKED,
    gateBoundary: PR_GATE_BOUNDARY.BLOCKED,
    draftGateAlreadySatisfied,
    draftGate,
    preApprovalGate,
    allowedNextActions,
    forbiddenActions,
    nextAction: PR_GATE_ACTION.REPORT_BLOCKED,
    reason: "The PR gate-boundary evaluator could not map this lifecycle state to a legal gate transition; reconcile before continuing.",
  });
}

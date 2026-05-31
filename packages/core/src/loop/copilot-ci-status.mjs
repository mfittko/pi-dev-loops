const VALID_HEAD_SCOPED_CI_STATUSES = new Set(["success", "failure", "pending", "none"]);
const FAILURE_CONCLUSIONS = new Set(["FAILURE", "ACTION_REQUIRED", "TIMED_OUT", "STARTUP_FAILURE"]);
const SUCCESS_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const STATUS_CONTEXT_FAILURE_STATES = new Set(["FAILURE", "ERROR"]);
const STATUS_CONTEXT_PENDING_STATES = new Set(["PENDING", "EXPECTED"]);
const STATUS_CONTEXT_SUCCESS_STATES = new Set(["SUCCESS"]);

function normalizeHeadScopedCiStatus(status) {
  return VALID_HEAD_SCOPED_CI_STATUSES.has(status) ? status : "none";
}

function buildCiContract(overallStatus) {
  const isWaiting = overallStatus === "pending" || overallStatus === "none";

  return {
    overallStatus,
    rollup: {
      success: overallStatus === "success",
      pending: overallStatus === "pending",
      failure: overallStatus === "failure",
      none: overallStatus === "none",
    },
    semantics: {
      wait: isWaiting,
      blocked: overallStatus === "failure",
      timeoutDisposition: isWaiting ? "remain_waiting" : "not_applicable",
    },
  };
}

/**
 * Normalize the PR `statusCheckRollup` payload into a stable status.
 * Supports both CheckRun-style entries (`status` + `conclusion`) and legacy
 * StatusContext-style entries (`state`).
 *
 * @param {Array<object>} rollup
 * @returns {"success"|"failure"|"pending"|"none"}
 */
export function normalizeStatusCheckRollupStatus(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return "none";
  }

  let hasPending = false;
  let hasFailure = false;
  let hasSuccess = false;
  let hasUnsupportedCompleted = false;

  for (const check of rollup) {
    const state = typeof check?.state === "string" ? check.state.toUpperCase() : "";
    if (STATUS_CONTEXT_FAILURE_STATES.has(state)) {
      hasFailure = true;
      continue;
    }
    if (STATUS_CONTEXT_PENDING_STATES.has(state)) {
      hasPending = true;
      continue;
    }
    if (STATUS_CONTEXT_SUCCESS_STATES.has(state)) {
      hasSuccess = true;
      continue;
    }

    const status = typeof check?.status === "string" ? check.status.toUpperCase() : "";
    const conclusion = typeof check?.conclusion === "string" ? check.conclusion.toUpperCase() : "";

    if (status === "COMPLETED" && FAILURE_CONCLUSIONS.has(conclusion)) {
      hasFailure = true;
      continue;
    }

    if (status !== "COMPLETED") {
      hasPending = true;
      continue;
    }

    if (SUCCESS_CONCLUSIONS.has(conclusion)) {
      hasSuccess = true;
      continue;
    }

    hasUnsupportedCompleted = true;
  }

  if (hasFailure) return "failure";
  if (hasPending) return "pending";
  if (hasUnsupportedCompleted) return "none";
  if (hasSuccess) return "success";
  return "none";
}

/**
 * Summarize the GitHub check-runs API payload for one head SHA.
 *
 * @param {object} payload
 * @returns {{ status: "success"|"failure"|"pending"|"none", unsupportedCompleted: boolean }}
 */
export function summarizeHeadScopedCheckRunsSignal(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  if (runs.length === 0) {
    return { status: "none", unsupportedCompleted: false };
  }

  let hasPending = false;
  let hasFailure = false;
  let hasSuccess = false;
  let hasUnsupportedCompleted = false;

  for (const run of runs) {
    const status = typeof run?.status === "string" ? run.status.toUpperCase() : "";
    const conclusion = typeof run?.conclusion === "string" ? run.conclusion.toUpperCase() : "";

    if (status !== "COMPLETED") {
      hasPending = true;
      continue;
    }

    if (FAILURE_CONCLUSIONS.has(conclusion)) {
      hasFailure = true;
      continue;
    }

    if (SUCCESS_CONCLUSIONS.has(conclusion)) {
      hasSuccess = true;
      continue;
    }

    hasUnsupportedCompleted = true;
  }

  if (hasFailure) return { status: "failure", unsupportedCompleted: hasUnsupportedCompleted };
  if (hasPending) return { status: "pending", unsupportedCompleted: hasUnsupportedCompleted };
  if (hasUnsupportedCompleted) return { status: "none", unsupportedCompleted: true };
  if (hasSuccess) return { status: "success", unsupportedCompleted: false };
  return { status: "none", unsupportedCompleted: false };
}

/**
 * Normalize the GitHub check-runs API payload for one head SHA into a stable status.
 *
 * @param {object} payload
 * @returns {"success"|"failure"|"pending"|"none"}
 */
export function normalizeHeadScopedCheckRunsStatus(payload) {
  return summarizeHeadScopedCheckRunsSignal(payload).status;
}

/**
 * Normalize the GitHub commit-status API payload for one head SHA into a stable status.
 *
 * @param {object} payload
 * @returns {"success"|"failure"|"pending"|"none"}
 */
export function normalizeHeadScopedCommitStatus(payload) {
  const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
  if (statuses.length === 0) {
    return "none";
  }

  let hasPending = false;
  let hasFailure = false;
  let hasSuccess = false;

  for (const statusItem of statuses) {
    const state = typeof statusItem?.state === "string" ? statusItem.state.toLowerCase() : "";
    if (state === "pending") {
      hasPending = true;
      continue;
    }
    if (state === "failure" || state === "error") {
      hasFailure = true;
      continue;
    }
    if (state === "success") {
      hasSuccess = true;
      continue;
    }
  }

  if (hasFailure) return "failure";
  if (hasPending) return "pending";
  if (hasSuccess) return "success";
  return "none";
}

/**
 * Merge head-scoped check-runs + commit-status signals into one deterministic status.
 *
 * @param {"success"|"failure"|"pending"|"none"} checkRunsStatus
 * @param {"success"|"failure"|"pending"|"none"} commitStatus
 * @returns {"success"|"failure"|"pending"|"none"}
 */
export function mergeHeadScopedCiStatuses(checkRunsStatus, commitStatus) {
  const normalizedCheckRunsStatus = normalizeHeadScopedCiStatus(checkRunsStatus);
  const normalizedCommitStatus = normalizeHeadScopedCiStatus(commitStatus);

  if (normalizedCheckRunsStatus === "failure" || normalizedCommitStatus === "failure") {
    return "failure";
  }
  if (normalizedCheckRunsStatus === "pending" || normalizedCommitStatus === "pending") {
    return "pending";
  }
  if (normalizedCheckRunsStatus === "success" || normalizedCommitStatus === "success") {
    return "success";
  }
  return "none";
}

/**
 * Normalize the PR `statusCheckRollup` payload into the shared machine-readable contract output.
 *
 * @param {Array<object>} rollup
 * @returns {{
 *  overallStatus: "success"|"failure"|"pending"|"none",
 *  rollup: { success: boolean, pending: boolean, failure: boolean, none: boolean },
 *  semantics: { wait: boolean, blocked: boolean, timeoutDisposition: "remain_waiting"|"not_applicable" }
 * }}
 */
export function normalizeStatusCheckRollupContract(rollup) {
  return buildCiContract(normalizeStatusCheckRollupStatus(rollup));
}

/**
 * Normalize current-head CI inputs into one machine-readable contract output.
 *
 * @param {{
 *  checkRunsStatus?: "success"|"failure"|"pending"|"none"|null,
 *  commitStatus?: "success"|"failure"|"pending"|"none"|null,
 *  checkRunsUnsupportedCompleted?: boolean|null
 * }} input
 * @returns {{
 *  overallStatus: "success"|"failure"|"pending"|"none",
 *  rollup: { success: boolean, pending: boolean, failure: boolean, none: boolean },
 *  semantics: { wait: boolean, blocked: boolean, timeoutDisposition: "remain_waiting"|"not_applicable" }
 * }}
 */
export function normalizeHeadScopedCiContract({
  checkRunsStatus = "none",
  commitStatus = "none",
  checkRunsUnsupportedCompleted = false,
} = {}) {
  const overallStatus = mergeHeadScopedCiStatuses(
    normalizeHeadScopedCiStatus(checkRunsStatus ?? "none"),
    normalizeHeadScopedCiStatus(commitStatus ?? "none"),
  );

  if (checkRunsUnsupportedCompleted === true && overallStatus === "success") {
    return buildCiContract("none");
  }

  return buildCiContract(overallStatus);
}

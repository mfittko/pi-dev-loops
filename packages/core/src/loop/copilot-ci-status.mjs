const VALID_HEAD_SCOPED_CI_STATUSES = new Set(["success", "failure", "pending", "none"]);

function normalizeHeadScopedCiStatus(status) {
  return VALID_HEAD_SCOPED_CI_STATUSES.has(status) ? status : "none";
}

/**
 * Normalize the GitHub check-runs API payload for one head SHA into a stable status.
 *
 * @param {object} payload
 * @returns {"success"|"failure"|"pending"|"none"}
 */
export function normalizeHeadScopedCheckRunsStatus(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  if (runs.length === 0) {
    return "none";
  }

  const FAILURE_CONCLUSIONS = new Set(["FAILURE", "ACTION_REQUIRED", "TIMED_OUT", "STARTUP_FAILURE"]);
  let hasPending = false;
  let hasFailure = false;
  let hasSuccess = false;

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

    hasSuccess = true;
  }

  if (hasFailure) return "failure";
  if (hasPending) return "pending";
  if (hasSuccess) return "success";
  return "none";
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
 * Normalize current-head CI inputs into one machine-readable contract output.
 *
 * @param {{
 *  checkRunsStatus?: "success"|"failure"|"pending"|"none"|null,
 *  commitStatus?: "success"|"failure"|"pending"|"none"|null
 * }} input
 * @returns {{
 *  overallStatus: "success"|"failure"|"pending"|"none",
 *  rollup: { success: boolean, pending: boolean, failure: boolean, none: boolean },
 *  semantics: { wait: boolean, blocked: boolean }
 * }}
 */
export function normalizeHeadScopedCiContract({ checkRunsStatus = "none", commitStatus = "none" } = {}) {
  const overallStatus = mergeHeadScopedCiStatuses(
    normalizeHeadScopedCiStatus(checkRunsStatus ?? "none"),
    normalizeHeadScopedCiStatus(commitStatus ?? "none"),
  );

  return {
    overallStatus,
    rollup: {
      success: overallStatus === "success",
      pending: overallStatus === "pending",
      failure: overallStatus === "failure",
      none: overallStatus === "none",
    },
    semantics: {
      wait: overallStatus === "pending" || overallStatus === "none",
      blocked: overallStatus === "failure",
    },
  };
}

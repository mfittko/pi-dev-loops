import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  composeRunInspectionSnapshot,
  mapOuterActionToStatusClass,
  STATUS_CLASS,
  SOURCE_MODE,
  TRUST,
  SCHEMA_VERSION,
  ACTIVE_STATE_FAMILY,
} from "../../packages/core/src/loop/run-inspection.mjs";

import {
  parseInspectRunCliArgs,
  inspectRun,
} from "../../scripts/loop/inspect-run.mjs";

const scriptPath = path.resolve("scripts/loop/inspect-run.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeGhStub(tempDir) {
  const ghPath = path.join(tempDir, "gh");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
const apiPath = args[0] === "api" ? args.find((arg) => arg.startsWith("repos/")) : null;

if (args[0] === "pr" && args[1] === "view") {
  const fields = args[args.indexOf("--json") + 1] || "";
  if (fields.includes("reviews")) {
    out({
      headRefOid: "abc123",
      isDraft: false,
      state: "OPEN",
      number: 55,
      reviews: [],
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    });
  } else {
    out({
      isDraft: false,
      state: "OPEN",
      number: 55,
      headRefOid: "abc123",
    });
  }
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/requested_reviewers") {
  out({ users: [{ login: "copilot-pull-request-reviewer[bot]" }, { login: "reviewer-user" }] });
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/reviews" || apiPath === "repos/owner/repo/pulls/55/reviews?per_page=100") {
  out([
    { id: 40, state: "COMMENTED", user: { login: "copilot-pull-request-reviewer[bot]" }, submitted_at: "2026-05-20T09:00:00Z", commit_id: "oldsha", html_url: "https://example.test/review/40" },
    { id: 41, state: "COMMENTED", user: { login: "reviewer-user" }, submitted_at: "2026-05-20T10:00:00Z", commit_id: "abc123", html_url: "https://example.test/review/41" },
  ]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/issues/55/timeline?per_page=100") {
  out([
    { event: "review_requested", created_at: "2026-05-20T08:55:00Z", requested_reviewer: { login: "copilot-pull-request-reviewer[bot]" } },
    { event: "review_requested", created_at: "2026-05-20T11:00:00Z", requested_reviewer: { login: "copilot-pull-request-reviewer[bot]" } },
  ]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/comments?per_page=100") {
  out([
    { id: 101, created_at: "2026-05-20T09:01:00Z", user: { login: "copilot-pull-request-reviewer[bot]" } },
    { id: 102, created_at: "2026-05-20T09:02:00Z", user: { login: "copilot-pull-request-reviewer[bot]" } },
  ]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/commits?per_page=100") {
  out([
    { sha: "oldsha", commit: { committer: { date: "2026-05-20T08:00:00Z" } }, author: { login: "copilot-swe-agent" } },
    { sha: "abc123", commit: { committer: { date: "2026-05-20T10:30:00Z" } }, author: { login: "author-user" } },
  ]);
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  out({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(1);
`;
  await writeFile(ghPath, script, "utf8");
  await chmod(ghPath, 0o755);
  return ghPath;
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-inspect-run-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Canonical live copilot evidence fixture
function makeCopilotEvidence(state = "waiting_for_copilot_review", { sameHeadCleanConverged = false } = {}) {
  return {
    snapshot: {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
      agentFixStatus: null,
    },
    interpretation: {
      state,
      allowedTransitions: ["unresolved_feedback_present", "ready_to_rerequest_review", "waiting_for_ci"],
      nextAction: "Wait for Copilot review",
      sameHeadCleanConverged,
    },
  };
}

// Canonical live reviewer evidence fixture
function makeReviewerEvidence(state = "waiting_for_author_followup", { submittedReviewState = "COMMENTED", submittedReviewPresent = true } = {}) {
  return {
    snapshot: {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      prHeadSha: "abc123",
      reviewRequested: false,
      localPlanningStatus: "none",
      localReviewRunsStatus: "none",
      localMergeStatus: "none",
      draftReviewPrepared: false,
      draftReviewPosted: false,
      draftReviewId: null,
      draftReviewUrl: null,
      draftReviewCommitSha: null,
      draftReviewNotificationStatus: "none",
      submittedReviewPresent,
      submittedReviewCommitSha: "abc123",
      submittedReviewState,
      reviewSubmissionStatus: "submitted",
    },
    interpretation: {
      state,
      allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
      nextAction: "Wait for author fixes or PR close/merge",
    },
  };
}

// ---------------------------------------------------------------------------
// Unit tests: mapOuterActionToStatusClass
// ---------------------------------------------------------------------------

test("mapOuterActionToStatusClass: continue_wait → waiting", () => {
  assert.equal(mapOuterActionToStatusClass("continue_wait"), STATUS_CLASS.WAITING);
});

test("mapOuterActionToStatusClass: reenter_copilot_loop → active", () => {
  assert.equal(mapOuterActionToStatusClass("reenter_copilot_loop"), STATUS_CLASS.ACTIVE);
});

test("mapOuterActionToStatusClass: reenter_reviewer_loop → active", () => {
  assert.equal(mapOuterActionToStatusClass("reenter_reviewer_loop"), STATUS_CLASS.ACTIVE);
});

test("mapOuterActionToStatusClass: stop → blocked", () => {
  assert.equal(mapOuterActionToStatusClass("stop"), STATUS_CLASS.BLOCKED);
});

test("mapOuterActionToStatusClass: done → done", () => {
  assert.equal(mapOuterActionToStatusClass("done"), STATUS_CLASS.DONE);
});

test("mapOuterActionToStatusClass: unknown value → unknown", () => {
  assert.equal(mapOuterActionToStatusClass("not_a_real_action"), STATUS_CLASS.UNKNOWN);
  assert.equal(mapOuterActionToStatusClass(undefined), STATUS_CLASS.UNKNOWN);
});

// ---------------------------------------------------------------------------
// Unit tests: composeRunInspectionSnapshot — complete live evidence
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: complete live evidence returns all required fields", () => {
  const copilotEvidence = makeCopilotEvidence("waiting_for_copilot_review");
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "continue_current_wait",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "continue_wait",
    outerReason: undefined,
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  // Always-present fields
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(snapshot.target, { repo: "owner/repo", pr: 55 });
  assert.equal(snapshot.inspectedAt, "2026-05-18T12:00:00Z");
  assert.equal(snapshot.activeStateFamily, ACTIVE_STATE_FAMILY);
  assert.equal(snapshot.outerState, "continue_current_wait");
  assert.deepEqual(snapshot.allowedTransitions, ["continue_current_wait", "handoff_to_copilot_loop"]);
  assert.equal(snapshot.outerAction, "continue_wait");
  assert.equal(snapshot.activeFamilyState, "continue_wait");
  assert.equal(snapshot.statusClass, STATUS_CLASS.WAITING);
  assert.equal(snapshot.needsAttention, false);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
  assert.equal(snapshot.trust, TRUST.AUTHORITATIVE);

  // Evidence
  assert.ok(typeof snapshot.evidence.summary === "string" && snapshot.evidence.summary.length > 0);
  assert.ok(Array.isArray(snapshot.evidence.authoritative));
  assert.ok(snapshot.evidence.authoritative.length > 0);
  assert.ok(Array.isArray(snapshot.evidence.checkpoint));

  // Markers
  assert.deepEqual(snapshot.markers.missing, []);
  assert.deepEqual(snapshot.markers.stale, []);
  assert.deepEqual(snapshot.markers.conflicts, []);

  // Layers (best-effort)
  assert.deepEqual(snapshot.loopIterations, {
    available: false,
    source: "github_pr_timeline",
    reason: "unavailable",
  });
  assert.equal(snapshot.layers.copilot.currentState, "waiting_for_copilot_review");
  assert.equal(snapshot.layers.copilot.sameHeadCleanConverged, false);
  assert.equal(snapshot.layers.copilot.loopDisposition, "pending");
  assert.equal(snapshot.layers.copilot.terminal, false);
  assert.equal(snapshot.layers.reviewer.currentState, "waiting_for_author_followup");
  assert.equal(snapshot.layers.reviewer.submittedReviewState, "COMMENTED");
  assert.equal(snapshot.layers.reviewer.approvedOnCurrentHead, false);
  assert.equal(snapshot.layers.steering.status, "unavailable");
  assert.equal(snapshot.layers.steering.reason, "no_steering_locator");
});

test("composeRunInspectionSnapshot: live evidence + done → statusClass done, needsAttention false", () => {
  const copilotEvidence = makeCopilotEvidence("done");
  copilotEvidence.snapshot.prMerged = true;
  const reviewerEvidence = makeReviewerEvidence("waiting_for_review_request");

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "done_terminal",
    outerAllowedTransitions: [],
    outerAction: "done",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.statusClass, STATUS_CLASS.DONE);
  assert.equal(snapshot.needsAttention, false);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
  assert.equal(snapshot.trust, TRUST.AUTHORITATIVE);
});

test("composeRunInspectionSnapshot: clean-converged Copilot state carries same-head convergence flags", () => {
  const copilotEvidence = makeCopilotEvidence("ready_to_rerequest_review", { sameHeadCleanConverged: true });
  copilotEvidence.snapshot.copilotReviewPresent = true;
  copilotEvidence.snapshot.copilotReviewOnCurrentHead = true;
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "continue_current_wait",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "continue_wait",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.layers.copilot.currentState, "ready_to_rerequest_review");
  assert.equal(snapshot.layers.copilot.sameHeadCleanConverged, true);
  assert.equal(snapshot.layers.copilot.loopDisposition, "clean_converged");
  assert.equal(snapshot.layers.copilot.terminal, true);
});

test("composeRunInspectionSnapshot: approved reviewer verdict on current head is surfaced in reviewer layer", () => {
  const copilotEvidence = makeCopilotEvidence("ready_to_rerequest_review", { sameHeadCleanConverged: true });
  copilotEvidence.snapshot.copilotReviewPresent = true;
  copilotEvidence.snapshot.copilotReviewOnCurrentHead = true;
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup", { submittedReviewState: "APPROVED" });

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "continue_current_wait",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "continue_wait",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.layers.reviewer.currentState, "waiting_for_author_followup");
  assert.equal(snapshot.layers.reviewer.submittedReviewState, "APPROVED");
  assert.equal(snapshot.layers.reviewer.approvedOnCurrentHead, true);
});

test("composeRunInspectionSnapshot: approved reviewer verdict without a submitted review does not count as current-head approval", () => {
  const copilotEvidence = makeCopilotEvidence("ready_to_rerequest_review", { sameHeadCleanConverged: true });
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup", {
    submittedReviewState: "APPROVED",
    submittedReviewPresent: false,
  });

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "continue_current_wait",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "continue_wait",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.layers.reviewer.submittedReviewState, "APPROVED");
  assert.equal(snapshot.layers.reviewer.approvedOnCurrentHead, false);
});

test("composeRunInspectionSnapshot: live evidence + stop → statusClass blocked, needsAttention true", () => {
  const copilotEvidence = makeCopilotEvidence("blocked_needs_user_decision");
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "stop_needs_human",
    outerAllowedTransitions: [],
    outerAction: "stop",
    outerReason: "copilot_blocked",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.statusClass, STATUS_CLASS.BLOCKED);
  assert.equal(snapshot.needsAttention, true);
  assert.ok(snapshot.evidence.summary.includes("blocked"));
});

test("composeRunInspectionSnapshot: live evidence + reenter_copilot_loop → active", () => {
  const copilotEvidence = makeCopilotEvidence("unresolved_feedback_present");
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "handoff_to_copilot_loop",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "reenter_copilot_loop",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.statusClass, STATUS_CLASS.ACTIVE);
  assert.equal(snapshot.needsAttention, false);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
});

test("composeRunInspectionSnapshot: evidence summary preserves stay_with_current_live_owner", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "stay_with_current_live_owner",
    outerAllowedTransitions: ["continue_current_wait"],
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("ready_to_rerequest_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_review_request"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.match(snapshot.evidence.summary, /live owner already controls this run/i);
  assert.doesNotMatch(snapshot.evidence.summary, /outerAction: continue_wait/i);
});


test("composeRunInspectionSnapshot: evidence summary preserves needs_reconcile", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "needs_reconcile",
    outerAllowedTransitions: [],
    outerAction: "stop",
    outerReason: "ownership_conflict",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_review_request"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.match(snapshot.evidence.summary, /must reconcile before continuing/i);
  assert.doesNotMatch(snapshot.evidence.summary, /blocked\/stop state/i);
});

test("composeRunInspectionSnapshot: invalid outerState normalizes to unknown and hides allowedTransitions", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "not_a_real_outer_state",
    outerAllowedTransitions: ["continue_current_wait", "handoff_to_copilot_loop"],
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.outerState, "unknown");
  assert.equal("allowedTransitions" in snapshot, false);
  assert.equal(snapshot.outerAction, "continue_wait");
  assert.equal(snapshot.statusClass, STATUS_CLASS.WAITING);
  assert.match(snapshot.evidence.summary, /only the compatibility outerAction could be determined/i);
});

// ---------------------------------------------------------------------------
// Unit tests: checkpoint-only fixture
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: checkpoint-only stays advisory and leaves top-level state unknown", () => {
  const existingCheckpoint = {
    pr: 55,
    repo: "owner/repo",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_author_followup",
    reason: null,
    timestamp: "2026-05-17T10:00:00Z",
    waitCycles: 3,
  };

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: undefined,
    copilotEvidence: null,
    reviewerEvidence: null,
    existingCheckpoint,
    checkpointEvidencePath: "tmp/copilot-loop/owner/repo/pr-55/outer-loop-state.json",
    liveAvailability: { copilot: "failed", reviewer: "failed" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.CHECKPOINT_ONLY);
  assert.equal(snapshot.trust, TRUST.CHECKPOINT);
  assert.equal(snapshot.needsAttention, true);
  assert.equal(snapshot.outerAction, "unknown");
  assert.equal(snapshot.activeFamilyState, "unknown");
  assert.equal(snapshot.statusClass, STATUS_CLASS.UNKNOWN);
  assert.match(snapshot.evidence.summary, /advisory/i);
  assert.match(snapshot.evidence.summary, /could not be determined|could not be confirmed/i);

  // Checkpoint layer is populated
  assert.equal(snapshot.layers.copilot.currentState, "waiting_for_copilot_review");
  assert.equal(snapshot.layers.copilot.source, "checkpoint");
  assert.equal(snapshot.layers.reviewer.currentState, "waiting_for_author_followup");
  assert.equal(snapshot.layers.reviewer.source, "checkpoint");

  // Missing markers present because live detection failed
  assert.ok(snapshot.markers.missing.length > 0);

  // Checkpoint listed in evidence.checkpoint
  assert.ok(snapshot.evidence.checkpoint.length > 0);
  assert.equal(snapshot.evidence.checkpoint[0], "tmp/copilot-loop/owner/repo/pr-55/outer-loop-state.json");
});

test("composeRunInspectionSnapshot: no live and no checkpoint → unavailable, unknown statusClass", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: undefined,
    copilotEvidence: null,
    reviewerEvidence: null,
    existingCheckpoint: null,
    liveAvailability: { copilot: "failed", reviewer: "failed" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.UNAVAILABLE);
  assert.equal(snapshot.trust, TRUST.UNAVAILABLE);
  assert.equal(snapshot.statusClass, STATUS_CLASS.UNKNOWN);
  assert.equal(snapshot.needsAttention, true);
  assert.equal(snapshot.outerAction, "unknown");
  assert.equal(snapshot.activeFamilyState, "unknown");
});

// ---------------------------------------------------------------------------
// Unit tests: stale checkpoint vs fresher live fact
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: live wins over stale checkpoint; conflict marker added", () => {
  const copilotEvidence = makeCopilotEvidence("ready_to_rerequest_review");
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  // Checkpoint says continue_wait but live says reenter_copilot_loop
  const existingCheckpoint = {
    pr: 55,
    repo: "owner/repo",
    outerAction: "continue_wait",           // stale: was waiting
    copilotState: "waiting_for_copilot_review", // stale
    reviewerState: "waiting_for_author_followup",
    reason: null,
    timestamp: "2026-05-17T10:00:00Z",
    waitCycles: 1,
  };

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "reenter_copilot_loop",   // live-derived
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  // Live wins
  assert.equal(snapshot.outerAction, "reenter_copilot_loop");
  assert.equal(snapshot.statusClass, STATUS_CLASS.ACTIVE);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
  assert.equal(snapshot.trust, TRUST.AUTHORITATIVE);

  // Conflicts are recorded
  assert.ok(snapshot.markers.conflicts.length > 0);
  assert.ok(snapshot.markers.conflicts.some((c) => c.includes("continue_wait")));
  assert.ok(snapshot.markers.conflicts.some((c) => c.includes("reenter_copilot_loop")));

  // needsAttention because of conflict
  assert.equal(snapshot.needsAttention, true);

  // Summary mentions conflict
  assert.ok(snapshot.evidence.summary.includes("conflict") || snapshot.evidence.summary.includes("Checkpoint state conflicts"));
});

test("composeRunInspectionSnapshot: live copilot state matches checkpoint — no conflict", () => {
  const copilotEvidence = makeCopilotEvidence("waiting_for_copilot_review");
  const reviewerEvidence = makeReviewerEvidence("waiting_for_author_followup");

  const existingCheckpoint = {
    pr: 55,
    repo: "owner/repo",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",   // same as live
    reviewerState: "waiting_for_author_followup", // same as live
    reason: null,
    timestamp: "2026-05-17T10:00:00Z",
    waitCycles: 1,
  };

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "continue_wait",
    copilotEvidence,
    reviewerEvidence,
    existingCheckpoint,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.deepEqual(snapshot.markers.conflicts, []);
  assert.equal(snapshot.needsAttention, false);
  assert.equal(snapshot.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
});

// ---------------------------------------------------------------------------
// Unit tests: partial live evidence
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: mixed live + checkpoint stays advisory and leaves top-level state unknown", () => {
  const copilotEvidence = makeCopilotEvidence("waiting_for_copilot_review");

  const existingCheckpoint = {
    pr: 55,
    repo: "owner/repo",
    outerAction: "continue_wait",
    copilotState: "waiting_for_copilot_review",
    reviewerState: "waiting_for_author_followup",
    reason: null,
    timestamp: "2026-05-17T10:00:00Z",
    waitCycles: 1,
  };

  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: undefined,
    copilotEvidence,
    reviewerEvidence: null,
    existingCheckpoint,
    liveAvailability: { copilot: "ok", reviewer: "failed" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.sourceMode, SOURCE_MODE.PARTIAL);
  assert.equal(snapshot.trust, TRUST.DEGRADED);
  assert.equal(snapshot.needsAttention, true);
  assert.equal(snapshot.outerAction, "unknown");
  assert.equal(snapshot.activeFamilyState, "unknown");
  assert.equal(snapshot.statusClass, STATUS_CLASS.UNKNOWN);
  assert.match(snapshot.evidence.summary, /insufficient|advisory/i);
  assert.ok(snapshot.markers.missing.length > 0 || snapshot.markers.stale.length > 0);

  // Copilot layer from live
  assert.equal(snapshot.layers.copilot.currentState, "waiting_for_copilot_review");
  assert.equal(snapshot.layers.copilot.source, undefined); // live source has no "source" field

  // Reviewer layer from checkpoint
  assert.equal(snapshot.layers.reviewer.currentState, "waiting_for_author_followup");
  assert.equal(snapshot.layers.reviewer.source, "checkpoint");
});

// ---------------------------------------------------------------------------
// Unit tests: steering layer
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: no steering locator → steering unavailable, no_steering_locator", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.layers.steering.status, "unavailable");
  assert.equal(snapshot.layers.steering.reason, "no_steering_locator");
  assert.equal(snapshot.layers.steering.locatorPath, undefined);
});

test("composeRunInspectionSnapshot: steering locator given but file missing → no_steering_file", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: "/tmp/nonexistent/steering.json",
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  assert.equal(snapshot.layers.steering.status, "unavailable");
  assert.equal(snapshot.layers.steering.reason, "no_steering_file");
  assert.equal(snapshot.layers.steering.locatorPath, undefined);
});

test("composeRunInspectionSnapshot: steering locator given and file loads → available", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: "/tmp/run-1-steering.json",
    steeringEvidence: {
      runId: "run-1",
      schemaVersion: 1,
      effectiveStack: [],
      queuedEvents: [],
    },
    steeringLoadFailed: false,
    steeringReadback: {
      latestAcknowledgement: null,
      effectiveConstraints: { hardConstraints: [], preferences: [], clarifications: [], stopAtNextSafeGate: false, unknownConstraints: [] },
      pendingSummary: { queuedCount: 0, queuedKinds: [], stopAtNextSafeGateQueued: false },
      stopAtNextSafeGate: { effective: false, queued: false, terminal: false, safePointCategory: "immediate" },
    },
  });

  assert.equal(snapshot.layers.steering.status, "available");
  assert.equal(snapshot.layers.steering.locatorPath, undefined);
  assert.equal(snapshot.layers.steering.latestAcknowledgement, null);
  assert.equal(snapshot.layers.steering.pendingSummary.queuedCount, 0);
  assert.equal(snapshot.layers.steering.stopAtNextSafeGate.effective, false);
  assert.equal("state" in snapshot.layers.steering, false);
});

test("composeRunInspectionSnapshot: steering load failed → load_failed reason", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: "/tmp/bad-steering.json",
    steeringEvidence: null,
    steeringLoadFailed: true,
  });

  assert.equal(snapshot.layers.steering.status, "unavailable");
  assert.equal(snapshot.layers.steering.reason, "load_failed");
  assert.equal(snapshot.layers.steering.locatorPath, undefined);
});

// ---------------------------------------------------------------------------
// Unit tests: schema contract
// ---------------------------------------------------------------------------

test("composeRunInspectionSnapshot: output has stable required top-level fields", () => {
  const snapshot = composeRunInspectionSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    inspectedAt: "2026-05-18T12:00:00Z",
    outerState: "continue_current_wait",
    outerAllowedTransitions: ["continue_current_wait"],
    outerAction: "continue_wait",
    copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
    reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
    existingCheckpoint: null,
    liveAvailability: { copilot: "ok", reviewer: "ok" },
    steeringLocatorPath: null,
    steeringEvidence: null,
    steeringLoadFailed: false,
  });

  const requiredFields = [
    "ok", "schemaVersion", "target", "inspectedAt",
    "activeStateFamily", "outerState", "outerAction", "activeFamilyState",
    "statusClass", "needsAttention", "sourceMode", "trust",
    "evidence", "markers", "loopIterations",
  ];

  for (const field of requiredFields) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(snapshot, field),
      `Missing required field: ${field}`,
    );
  }

  assert.ok(typeof snapshot.evidence.summary === "string");
  assert.ok(Array.isArray(snapshot.evidence.authoritative));
  assert.ok(Array.isArray(snapshot.evidence.checkpoint));
  assert.ok(Array.isArray(snapshot.markers.missing));
  assert.ok(Array.isArray(snapshot.markers.stale));
  assert.ok(Array.isArray(snapshot.markers.conflicts));
});

test("composeRunInspectionSnapshot: outerAction always equals activeFamilyState", () => {
  for (const outerAction of ["continue_wait", "done", "stop", "reenter_copilot_loop", "reenter_reviewer_loop"]) {
    const snapshot = composeRunInspectionSnapshot({
      target: { repo: "owner/repo", pr: 55 },
      inspectedAt: "2026-05-18T12:00:00Z",
      outerAction,
      copilotEvidence: makeCopilotEvidence("waiting_for_copilot_review"),
      reviewerEvidence: makeReviewerEvidence("waiting_for_author_followup"),
      existingCheckpoint: null,
      liveAvailability: { copilot: "ok", reviewer: "ok" },
      steeringLocatorPath: null,
      steeringEvidence: null,
      steeringLoadFailed: false,
    });

    assert.equal(
      snapshot.outerAction,
      snapshot.activeFamilyState,
      `outerAction and activeFamilyState must match for outerAction=${outerAction}`,
    );
  }
});

// ---------------------------------------------------------------------------
// CLI argument parsing unit tests
// ---------------------------------------------------------------------------

test("parseInspectRunCliArgs: parses required flags", () => {
  const opts = parseInspectRunCliArgs(["--repo", "owner/repo", "--pr", "55"]);
  assert.equal(opts.repo, "owner/repo");
  assert.equal(opts.pr, 55);
  assert.equal(opts.steeringStateFile, undefined);
  assert.equal(opts.copilotInputPath, undefined);
  assert.equal(opts.reviewerInputPath, undefined);
  assert.equal(opts.reviewerLogin, undefined);
});

test("parseInspectRunCliArgs: parses all optional flags", () => {
  const opts = parseInspectRunCliArgs([
    "--repo", "owner/repo",
    "--pr", "55",
    "--steering-state-file", "/tmp/steering.json",
    "--copilot-input", "/tmp/copilot.json",
    "--reviewer-input", "/tmp/reviewer.json",
  ]);
  assert.equal(opts.steeringStateFile, "/tmp/steering.json");
  assert.equal(opts.copilotInputPath, "/tmp/copilot.json");
  assert.equal(opts.reviewerInputPath, "/tmp/reviewer.json");
});

test("parseInspectRunCliArgs: parses reviewer-login for live reviewer detection", () => {
  const opts = parseInspectRunCliArgs([
    "--repo", "owner/repo",
    "--pr", "55",
    "--reviewer-login", "pi-reviewer",
  ]);
  assert.equal(opts.reviewerLogin, "pi-reviewer");
});

test("parseInspectRunCliArgs: rejects blank reviewer-login", () => {
  assert.throws(
    () => parseInspectRunCliArgs([
      "--repo", "owner/repo",
      "--pr", "55",
      "--reviewer-login", "   ",
    ]),
    (err) => err.message.includes("--reviewer-login") && err.message.includes("empty"),
  );
});

test("parseInspectRunCliArgs: --help returns help flag", () => {
  const opts = parseInspectRunCliArgs(["--help"]);
  assert.equal(opts.help, true);
});

test("parseInspectRunCliArgs: missing --repo throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--pr", "55"]),
    (err) => err.message.includes("--repo") || err.message.includes("both"),
  );
});

test("parseInspectRunCliArgs: missing --pr throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--repo", "owner/repo"]),
    (err) => err.message.includes("--pr") || err.message.includes("both"),
  );
});

test("parseInspectRunCliArgs: invalid --pr (non-numeric) throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--repo", "owner/repo", "--pr", "abc"]),
    (err) => err.message.includes("--pr"),
  );
});

test("parseInspectRunCliArgs: invalid --pr (zero) throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--repo", "owner/repo", "--pr", "0"]),
    (err) => err.message.includes("--pr"),
  );
});

test("parseInspectRunCliArgs: unknown flag throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--repo", "owner/repo", "--pr", "55", "--unknown-flag"]),
    (err) => err.message.includes("Unknown argument"),
  );
});

test("parseInspectRunCliArgs: rejects reviewer-input combined with reviewer-login", () => {
  assert.throws(
    () => parseInspectRunCliArgs([
      "--repo", "owner/repo",
      "--pr", "55",
      "--reviewer-input", "/tmp/reviewer.json",
      "--reviewer-login", "pi-reviewer",
    ]),
    (err) => err.message.includes("--reviewer-input") && err.message.includes("--reviewer-login"),
  );
});

test("parseInspectRunCliArgs: invalid repo slug throws", () => {
  assert.throws(
    () => parseInspectRunCliArgs(["--repo", "notavalidslug", "--pr", "55"]),
    (err) => err instanceof Error,
  );
});

// ---------------------------------------------------------------------------
// CLI integration tests: happy path with snapshot input files
// ---------------------------------------------------------------------------

test("inspect-run CLI: complete snapshot inputs -> partial sourceMode (degraded trust)", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
      agentFixStatus: null,
    });

    await writeJson(reviewerPath, {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      prHeadSha: "abc123",
      reviewRequested: false,
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
    ]);

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.schemaVersion, 1);
    assert.deepEqual(output.target, { repo: "owner/repo", pr: 55 });
    assert.equal(output.activeStateFamily, "copilot-pr-outer-loop");
    assert.equal(output.outerAction, output.activeFamilyState);
    assert.ok(["active", "waiting", "blocked", "done", "unknown"].includes(output.statusClass));
    assert.ok(typeof output.needsAttention === "boolean");
    assert.equal(output.sourceMode, "partial");
    assert.equal(output.trust, "degraded");
    assert.ok(typeof output.evidence.summary === "string");
    assert.ok(Array.isArray(output.markers.missing));
    assert.ok(Array.isArray(output.markers.stale));
    assert.ok(Array.isArray(output.markers.conflicts));
    assert.deepEqual(output.loopIterations, {
      available: false,
      source: "github_pr_timeline",
      reason: "requires_live_github_facts",
    });
  });
});

test("inspect-run CLI: mixed live + input coverage can still derive a degraded top-level state", async () => {
  await withTempDir(async (tempDir) => {
    await writeGhStub(tempDir);
    const copilotPath = path.join(tempDir, "copilot.json");
    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
      agentFixStatus: null,
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
    ], {
      cwd: tempDir,
      env: { ...process.env, PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.PARTIAL);
    assert.equal(output.trust, TRUST.DEGRADED);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.activeFamilyState, "continue_wait");
    assert.equal(output.statusClass, STATUS_CLASS.WAITING);
    assert.match(output.evidence.summary, /caller-supplied snapshot inputs|provided to inspection/i);
  });
});

test("inspect-run CLI: successful live detectors still derive authoritative top-level state", async () => {
  await withTempDir(async (tempDir) => {
    await writeGhStub(tempDir);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
    ], {
      cwd: tempDir,
      env: { ...process.env, PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.LIVE_DETECTOR_BACKED);
    assert.equal(output.trust, TRUST.AUTHORITATIVE);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.activeFamilyState, "continue_wait");
    assert.equal(output.statusClass, STATUS_CLASS.WAITING);
    assert.equal(output.needsAttention, false);
    assert.equal(output.layers.reviewer.scope.mode, "all_reviewers");
    assert.equal(output.layers.reviewer.scope.reviewerLogin, null);
    assert.deepEqual(output.loopIterations, {
      available: true,
      source: "github_pr_timeline",
      completedCopilotReviewRounds: 1,
      pendingCopilotReviewRounds: 1,
      copilotReviewRequests: 2,
      copilotReviewComments: 2,
      resolvedReviewThreads: 0,
      unresolvedReviewThreads: 0,
      fixCommitsAfterFeedback: 1,
    });
  });
});

test("inspect-run CLI: live PR counts a pending round when the current head differs from the latest Copilot review sha", async () => {
  await withTempDir(async (tempDir) => {
    const ghPath = path.join(tempDir, "gh");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
const apiPath = args[0] === "api" ? args.find((arg) => arg.startsWith("repos/")) : null;

if (args[0] === "pr" && args[1] === "view") {
  const fields = args[args.indexOf("--json") + 1] || "";
  if (fields.includes("reviews")) {
    out({
      headRefOid: "newsha",
      isDraft: false,
      state: "OPEN",
      number: 55,
      reviews: [{ id: 40, state: "COMMENTED", author: { login: "copilot-pull-request-reviewer[bot]" }, commit: { oid: "oldsha" } }],
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    });
  } else {
    out({ isDraft: false, state: "OPEN", number: 55, headRefOid: "newsha" });
  }
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/requested_reviewers") {
  out({ users: [{ login: "copilot-pull-request-reviewer[bot]" }], teams: [] });
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/reviews" || apiPath === "repos/owner/repo/pulls/55/reviews?per_page=100") {
  out([{ id: 40, state: "COMMENTED", user: { login: "copilot-pull-request-reviewer[bot]" }, submitted_at: "2026-05-20T09:00:00Z", commit_id: "oldsha" }]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/issues/55/timeline?per_page=100") {
  out([{ event: "review_requested", created_at: "2026-05-20T08:55:00Z", requested_reviewer: { login: "copilot-pull-request-reviewer[bot]" } }]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/comments?per_page=100") {
  out([]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/commits/newsha/check-runs?per_page=100") {
  out({ check_runs: [] });
  process.exit(0);
}

if (apiPath === "repos/owner/repo/commits/newsha/status?per_page=100") {
  out({ statuses: [] });
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/commits?per_page=100") {
  out([{ sha: "newsha", commit: { committer: { date: "2026-05-20T10:30:00Z" } }, author: { login: "author-user" } }]);
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  out({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(1);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
    ], {
      cwd: tempDir,
      env: { ...process.env, PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.loopIterations.available, true);
    assert.equal(output.loopIterations.completedCopilotReviewRounds, 1);
    assert.equal(output.loopIterations.pendingCopilotReviewRounds, 1);
  });
});

test("inspect-run CLI: truncated sources surface degraded loopIterations metadata", async () => {
  await withTempDir(async (tempDir) => {
    const ghPath = path.join(tempDir, "gh");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
const apiPath = args[0] === "api" ? args.find((arg) => arg.startsWith("repos/")) : null;

if (args[0] === "pr" && args[1] === "view") {
  const fields = args[args.indexOf("--json") + 1] || "";
  if (fields.includes("reviews")) {
    out({ headRefOid: "abc123", isDraft: false, state: "OPEN", number: 55, reviews: [], statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] });
  } else {
    out({ isDraft: false, state: "OPEN", number: 55, headRefOid: "abc123" });
  }
  process.exit(0);
}
if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/requested_reviewers") {
  out({ users: [{ login: "copilot-pull-request-reviewer[bot]" }], teams: [] });
  process.exit(0);
}
if (apiPath === "repos/owner/repo/pulls/55/reviews" || apiPath === "repos/owner/repo/pulls/55/reviews?per_page=100") {
  out(Array.from({ length: 100 }, (_, index) => ({ id: index + 1, state: "COMMENTED", user: { login: "copilot-pull-request-reviewer[bot]" }, submitted_at: "2026-05-20T09:00:00Z", commit_id: "abc123" })));
  process.exit(0);
}
if (apiPath === "repos/owner/repo/issues/55/timeline?per_page=100") { out([]); process.exit(0); }
if (apiPath === "repos/owner/repo/pulls/55/comments?per_page=100") { out([]); process.exit(0); }
if (apiPath === "repos/owner/repo/pulls/55/commits?per_page=100") { out([]); process.exit(0); }
if (args[0] === "api" && args[1] === "graphql") {
  out({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } } } } } });
  process.exit(0);
}
process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(1);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const result = await runNode(["--repo", "owner/repo", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.loopIterations.available, true);
    assert.equal(output.loopIterations.degraded, true);
    assert.deepEqual(output.loopIterations.degradedReasons, ["reviews_page_cap", "review_threads_has_next_page"]);
  });
});

test("inspect-run CLI: live PR with no Copilot review history marks loopIterations unavailable", async () => {
  await withTempDir(async (tempDir) => {
    const ghPath = path.join(tempDir, "gh");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
const apiPath = args[0] === "api" ? args.find((arg) => arg.startsWith("repos/")) : null;

if (args[0] === "pr" && args[1] === "view") {
  const fields = args[args.indexOf("--json") + 1] || "";
  if (fields.includes("reviews")) {
    out({
      headRefOid: "abc123",
      isDraft: false,
      state: "OPEN",
      number: 55,
      reviews: [],
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    });
  } else {
    out({ isDraft: false, state: "OPEN", number: 55, headRefOid: "abc123" });
  }
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/requested_reviewers") {
  out({ users: [], teams: [] });
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/reviews" || apiPath === "repos/owner/repo/pulls/55/reviews?per_page=100") {
  out([]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/issues/55/timeline?per_page=100") {
  out([]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/comments?per_page=100") {
  out([]);
  process.exit(0);
}

if (apiPath === "repos/owner/repo/pulls/55/commits?per_page=100") {
  out([{ sha: "abc123", commit: { committer: { date: "2026-05-20T10:30:00Z" } }, author: { login: "author-user" } }]);
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  out({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(1);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
    ], {
      cwd: tempDir,
      env: { ...process.env, PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.loopIterations, {
      available: false,
      source: "github_pr_timeline",
      reason: "no_copilot_review_history",
    });
  });
});

test("inspect-run CLI: reviewer-login narrows live reviewer detection to one reviewer identity", async () => {
  await withTempDir(async (tempDir) => {
    const ghPath = path.join(tempDir, "gh");
    await writeFile(
      ghPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));

if (args[0] === "pr" && args[1] === "view") {
  const fields = args[args.indexOf("--json") + 1] || "";
  if (fields.includes("reviews")) {
    out({
      headRefOid: "abc123",
      isDraft: false,
      state: "OPEN",
      number: 55,
      reviews: [],
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    });
  } else {
    out({ isDraft: false, state: "OPEN", number: 55, headRefOid: "abc123" });
  }
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/requested_reviewers") {
  out({ users: [{ login: "reviewer-user" }], teams: [] });
  process.exit(0);
}

if (args[0] === "api" && args[1] === "repos/owner/repo/pulls/55/reviews") {
  out([{ id: 41, state: "COMMENTED", user: { login: "other-reviewer" }, commit_id: "abc123", html_url: "https://example.test/review/41" }]);
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  out({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(1);
`,
      "utf8",
    );
    await chmod(ghPath, 0o755);

    const baseEnv = {
      ...process.env,
      PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
    };

    const aggregate = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
    ], {
      cwd: tempDir,
      env: baseEnv,
    });
    assert.equal(aggregate.code, 0, `stderr: ${aggregate.stderr}`);
    const aggregateOutput = JSON.parse(aggregate.stdout);
    assert.equal(aggregateOutput.layers.reviewer.currentState, "waiting_for_author_followup");
    assert.equal(aggregateOutput.layers.reviewer.scope.mode, "all_reviewers");
    assert.equal(aggregateOutput.layers.reviewer.scope.reviewerLogin, null);

    const scoped = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--reviewer-login", "reviewer-user",
    ], {
      cwd: tempDir,
      env: baseEnv,
    });
    assert.equal(scoped.code, 0, `stderr: ${scoped.stderr}`);
    const scopedOutput = JSON.parse(scoped.stdout);
    assert.equal(scopedOutput.layers.reviewer.currentState, "review_requested");
    assert.equal(scopedOutput.layers.reviewer.scope.mode, "single_reviewer");
    assert.equal(scopedOutput.layers.reviewer.scope.reviewerLogin, "reviewer-user");
  });
});

test("inspect-run CLI: waiting copilot → continue_wait, statusClass waiting", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });

    await writeJson(reviewerPath, {
      prExists: true,
      prNumber: 55,
      prHeadSha: "abc123",
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
    ]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.outerAction, "continue_wait");
    assert.equal(output.statusClass, "waiting");
    assert.equal(output.needsAttention, false);
    assert.equal(output.sourceMode, "partial");
    assert.equal(output.trust, "degraded");
  });
});

test("inspect-run CLI: merged PR → done, statusClass done", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, { prExists: true, prNumber: 55, prMerged: true });
    await writeJson(reviewerPath, { prExists: true, prNumber: 55, prMerged: true });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
    ]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.outerAction, "done");
    assert.equal(output.statusClass, "done");
    assert.equal(output.needsAttention, false);
  });
});

test("inspect-run CLI: PR not found → structured output with statusClass unknown", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, { prExists: false });
    await writeJson(reviewerPath, { prExists: false });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
    ]);

    // Should succeed (exit 0) with a structured non-misleading output
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.statusClass, "unknown");
    assert.ok(output.outerAction === undefined || output.outerAction === "unknown");
    assert.equal(output.trust, "unavailable");
    assert.equal(output.needsAttention, true);
    assert.match(output.evidence.summary, /not found/i);
    assert.ok(output.markers.missing.some((entry) => /explicit target PR was not found/i.test(entry)));
  });
});

test("inspect-run CLI: no steering file → steering unavailable with no_steering_locator", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0,
      ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true,
      prNumber: 55,
      submittedReviewPresent: true,
      submittedReviewCommitSha: "abc123",
      prHeadSha: "abc123",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
    ]);

    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.layers.steering.status, "unavailable");
    assert.equal(output.layers.steering.reason, "no_steering_locator");
  });
});

test("inspect-run CLI: --steering-state-file given but file missing → no_steering_file", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");
    const steeringPath = path.join(tempDir, "nonexistent-steering.json");

    await writeJson(copilotPath, {
      prExists: true, prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0, ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true, prNumber: 55, prHeadSha: "abc123",
      submittedReviewPresent: true, submittedReviewCommitSha: "abc123",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
      "--steering-state-file", steeringPath,
    ]);

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.layers.steering.status, "unavailable");
    assert.equal(output.layers.steering.reason, "no_steering_file");
    assert.equal(output.layers.steering.locatorPath, undefined);
  });
});

test("inspect-run CLI: --steering-state-file with mismatched target is unavailable and does not leak steering state", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");
    const steeringPath = path.join(tempDir, "steering.json");

    await writeJson(copilotPath, {
      prExists: true, prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0, ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true, prNumber: 55, prHeadSha: "abc123",
      submittedReviewPresent: true, submittedReviewCommitSha: "abc123",
    });
    await writeJson(steeringPath, {
      runId: "pr-55",
      target: { repo: "other/repo", pr: 55 },
      schemaVersion: 1,
      events: [],
      effectiveStack: [],
      queuedEvents: [],
      resultHistory: [],
      latestResult: null,
      nextSeq: 1,
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
      "--steering-state-file", steeringPath,
    ]);

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.layers.steering.status, "unavailable");
    assert.equal(output.layers.steering.reason, "mismatched_steering_target");
    assert.equal(output.layers.steering.locatorPath, undefined);
  });
});

test("inspect-run CLI: --steering-state-file given and file exists → available", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");
    const steeringPath = path.join(tempDir, "steering.json");

    await writeJson(copilotPath, {
      prExists: true, prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0, ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true, prNumber: 55, prHeadSha: "abc123",
      submittedReviewPresent: true, submittedReviewCommitSha: "abc123",
    });
    await writeJson(steeringPath, {
      runId: "pr-55",
      target: { repo: "owner/repo", pr: 55 },
      schemaVersion: 1,
      events: [{
        eventId: "evt-001",
        runId: "pr-55",
        kind: "stop_at_next_safe_gate",
        directive: "Stop before next review pass",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-18T12:00:00.000Z",
      }],
      effectiveStack: [],
      queuedEvents: [{
        eventId: "evt-001",
        runId: "pr-55",
        kind: "stop_at_next_safe_gate",
        directive: "Stop before next review pass",
        seq: 1,
        applyMode: "immediate",
        submittedAt: "2026-05-18T12:00:00.000Z",
      }],
      resultHistory: [{
        eventId: "evt-001",
        seq: 1,
        result: "queued_for_safe_point",
        reason: "current loop state is not yet an immediate safe point",
        acknowledgedAt: "2026-05-18T12:00:01.000Z",
      }],
      latestResult: {
        eventId: "evt-001",
        seq: 1,
        result: "queued_for_safe_point",
        reason: "current loop state is not yet an immediate safe point",
        acknowledgedAt: "2026-05-18T12:00:01.000Z",
      },
      nextSeq: 2,
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
      "--reviewer-input", reviewerPath,
      "--steering-state-file", steeringPath,
    ]);

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.layers.steering.status, "available");
    assert.equal(output.layers.steering.locatorPath, undefined);
    assert.equal(output.runId, "pr-55");
    assert.equal(output.layers.steering.latestAcknowledgement.result, "queued_for_safe_point");
    assert.equal(output.layers.steering.pendingSummary.queuedCount, 1);
    assert.equal(output.layers.steering.pendingSummary.stopAtNextSafeGateQueued, true);
    assert.equal(output.layers.steering.stopAtNextSafeGate.effective, false);
    assert.equal(output.layers.steering.stopAtNextSafeGate.queued, true);
    assert.equal(output.layers.steering.effectiveConstraints.stopAtNextSafeGate, false);
    assert.equal("state" in output.layers.steering, false);
  });
});

test("inspect-run CLI: checkpoint-only repo-qualified path stays advisory and top-level unknown", async () => {
  await withTempDir(async (tempDir) => {
    const checkpointPath = path.join(tempDir, "tmp", "copilot-loop", "owner", "repo", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await writeJson(checkpointPath, {
      pr: 55,
      repo: "owner/repo",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reviewerScope: "single_reviewer",
      reviewerLogin: "reviewer-user",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });

    const result = await runNode(["--repo", "owner/repo", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.CHECKPOINT_ONLY);
    assert.equal(output.outerAction, "unknown");
    assert.equal(output.activeFamilyState, "unknown");
    assert.equal(output.statusClass, STATUS_CLASS.UNKNOWN);
    assert.equal(output.layers.reviewer.scope.mode, "single_reviewer");
    assert.equal(output.layers.reviewer.scope.reviewerLogin, "reviewer-user");
    assert.match(output.evidence.summary, /advisory/i);
    assert.equal(output.evidence.checkpoint[0], path.join("tmp", "copilot-loop", "owner", "repo", "pr-55", "outer-loop-state.json"));
  });
});

test("inspect-run CLI: checkpoint-only selection still picks the targeted repo when two repos share a PR number", async () => {
  await withTempDir(async (tempDir) => {
    const checkpointPathA = path.join(tempDir, "tmp", "copilot-loop", "owner", "repo-a", "pr-55", "outer-loop-state.json");
    const checkpointPathB = path.join(tempDir, "tmp", "copilot-loop", "owner", "repo-b", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(checkpointPathA), { recursive: true });
    await mkdir(path.dirname(checkpointPathB), { recursive: true });
    await writeJson(checkpointPathA, {
      pr: 55,
      repo: "owner/repo-a",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });
    await writeJson(checkpointPathB, {
      pr: 55,
      repo: "owner/repo-b",
      outerAction: "stop",
      copilotState: "review_request_unavailable",
      reviewerState: "waiting_for_author_followup",
      reason: "review_unavailable",
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 1,
      headSha: "def456",
    });

    const result = await runNode(["--repo", "owner/repo-b", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.CHECKPOINT_ONLY);
    assert.equal(output.evidence.checkpoint[0], path.join("tmp", "copilot-loop", "owner", "repo-b", "pr-55", "outer-loop-state.json"));
    assert.equal(output.outerAction, "unknown");
    assert.equal(output.activeFamilyState, "unknown");
    assert.equal(output.statusClass, STATUS_CLASS.UNKNOWN);
  });
});

test("inspect-run CLI: mixed live + checkpoint fallback stays advisory and top-level unknown", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const checkpointPath = path.join(tempDir, "tmp", "copilot-loop", "owner", "repo", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await writeJson(copilotPath, {
      prExists: true,
      prNumber: 55,
      prDraft: false,
      prMerged: false,
      prClosed: false,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      copilotReviewOnCurrentHead: false,
      unresolvedThreadCount: 0,
      actionableThreadCount: 0,
      ciStatus: "success",
      agentFixStatus: null,
    });
    await writeJson(checkpointPath, {
      pr: 55,
      repo: "owner/repo",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "55",
      "--copilot-input", copilotPath,
    ], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.PARTIAL);
    assert.equal(output.trust, TRUST.DEGRADED);
    assert.equal(output.outerAction, "unknown");
    assert.equal(output.activeFamilyState, "unknown");
    assert.equal(output.statusClass, STATUS_CLASS.UNKNOWN);
    assert.equal(output.layers.copilot.currentState, "waiting_for_copilot_review");
    assert.equal(output.layers.reviewer.currentState, "waiting_for_author_followup");
    assert.equal(output.layers.reviewer.source, "checkpoint");
    assert.match(output.evidence.summary, /insufficient|advisory/i);
  });
});

test("inspect-run CLI: matching legacy checkpoint fallback stays advisory when repo input casing differs", async () => {
  await withTempDir(async (tempDir) => {
    const checkpointPath = path.join(tempDir, "tmp", "copilot-loop", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await writeJson(checkpointPath, {
      pr: 55,
      repo: "owner/repo",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });

    const result = await runNode(["--repo", "Owner/Repo", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.CHECKPOINT_ONLY);
    assert.equal(output.outerAction, "unknown");
    assert.equal(output.activeFamilyState, "unknown");
    assert.equal(output.statusClass, STATUS_CLASS.UNKNOWN);
    assert.equal(output.evidence.checkpoint[0], path.join("tmp", "copilot-loop", "pr-55", "outer-loop-state.json"));
  });
});

test("inspect-run CLI: prefers repo-qualified checkpoint when both new and legacy files exist and keeps top-level unknown", async () => {
  await withTempDir(async (tempDir) => {
    const repoQualifiedPath = path.join(tempDir, "tmp", "copilot-loop", "owner", "repo", "pr-55", "outer-loop-state.json");
    const legacyPath = path.join(tempDir, "tmp", "copilot-loop", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(repoQualifiedPath), { recursive: true });
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeJson(repoQualifiedPath, {
      pr: 55,
      repo: "owner/repo",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });
    await writeJson(legacyPath, {
      pr: 55,
      repo: "owner/repo",
      outerAction: "stop",
      copilotState: "review_request_unavailable",
      reviewerState: "waiting_for_author_followup",
      reason: "review_unavailable",
      timestamp: "2026-05-16T10:00:00Z",
      waitCycles: 9,
      headSha: "oldsha",
    });

    const result = await runNode(["--repo", "owner/repo", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.CHECKPOINT_ONLY);
    assert.equal(output.evidence.checkpoint[0], path.join("tmp", "copilot-loop", "owner", "repo", "pr-55", "outer-loop-state.json"));
    assert.equal(output.outerAction, "unknown");
    assert.equal(output.activeFamilyState, "unknown");
    assert.equal(output.statusClass, STATUS_CLASS.UNKNOWN);
  });
});

test("inspect-run CLI: ignores legacy fallback checkpoint when repo does not match target", async () => {
  await withTempDir(async (tempDir) => {
    const checkpointPath = path.join(tempDir, "tmp", "copilot-loop", "pr-55", "outer-loop-state.json");
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await writeJson(checkpointPath, {
      pr: 55,
      repo: "other/repo",
      outerAction: "continue_wait",
      copilotState: "waiting_for_copilot_review",
      reviewerState: "waiting_for_author_followup",
      reason: null,
      timestamp: "2026-05-17T10:00:00Z",
      waitCycles: 3,
      headSha: "abc123",
    });

    const result = await runNode(["--repo", "owner/repo", "--pr", "55"], {
      cwd: tempDir,
      env: { ...process.env, PATH: tempDir },
    });

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sourceMode, SOURCE_MODE.UNAVAILABLE);
    assert.deepEqual(output.evidence.checkpoint, []);
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests: read-only — no checkpoint creation
// ---------------------------------------------------------------------------

test("inspect-run CLI: does not create or update a checkpoint (read-only)", async () => {
  await withTempDir(async (tempDir) => {
    const copilotPath = path.join(tempDir, "copilot.json");
    const reviewerPath = path.join(tempDir, "reviewer.json");

    await writeJson(copilotPath, {
      prExists: true, prNumber: 55,
      copilotReviewRequestStatus: "requested",
      copilotReviewPresent: false,
      unresolvedThreadCount: 0, ciStatus: "success",
    });
    await writeJson(reviewerPath, {
      prExists: true, prNumber: 55, prHeadSha: "abc123",
      submittedReviewPresent: true, submittedReviewCommitSha: "abc123",
    });

    // Run from a dedicated cwd so any tmp writes would be relative to tempDir
    const result = await runNode(
      ["--repo", "owner/repo", "--pr", "55",
       "--copilot-input", copilotPath,
       "--reviewer-input", reviewerPath],
      { cwd: tempDir },
    );

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    // The inspector must not have created a checkpoint file
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(tempDir);
    const checkpointDirs = entries.filter((e) => e.startsWith("tmp") || e === "outer-loop-state.json");
    assert.deepEqual(checkpointDirs, [], `Unexpected checkpoint entries: ${checkpointDirs.join(", ")}`);
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests: malformed arguments
// ---------------------------------------------------------------------------

test("inspect-run CLI: missing --repo → structured stderr, non-zero exit", async () => {
  const result = await runNode(["--pr", "55"]);
  assert.notEqual(result.code, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert.ok(typeof err.error === "string" && err.error.length > 0);
  assert.ok(typeof err.usage === "string");
});

test("inspect-run CLI: missing --pr → structured stderr, non-zero exit", async () => {
  const result = await runNode(["--repo", "owner/repo"]);
  assert.notEqual(result.code, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert.ok(typeof err.error === "string");
  assert.ok(typeof err.usage === "string");
});

test("inspect-run CLI: unknown flag → structured stderr, non-zero exit", async () => {
  const result = await runNode(["--repo", "owner/repo", "--pr", "55", "--not-a-flag"]);
  assert.notEqual(result.code, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert.ok(err.error.includes("Unknown argument"));
});

test("inspect-run CLI: invalid --pr value → structured stderr, non-zero exit", async () => {
  const result = await runNode(["--repo", "owner/repo", "--pr", "not-a-number"]);
  assert.notEqual(result.code, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
});

test("inspect-run CLI: --help → usage text on stdout, exit 0", async () => {
  const result = await runNode(["--help"]);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes("inspect-run.mjs"));
  assert.ok(result.stdout.includes("--repo"));
  assert.ok(result.stdout.includes("--pr"));
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { get, request } from "node:http";
import test from "node:test";

import {
  buildInspectionMermaidGraph,
  createInspectRunViewerServer,
  formatInspectRunViewerUrl,
  listListeningPidsForPort,
  loadMermaidBrowserScript,
  parseInspectRunViewerCliArgs,
  renderInspectRunViewerHtml,
  resetMermaidBrowserScriptCache,
  restartExistingPortListener,
  runCli,
} from "../../scripts/loop/inspect-run-viewer.mjs";
import {
  STATE as COPILOT_STATE,
  TRANSITIONS as COPILOT_TRANSITIONS,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  OUTER_STATE,
  OUTER_TRANSITIONS,
} from "../../packages/core/src/loop/outer-loop-state.mjs";
import {
  REVIEWER_STATE,
  REVIEWER_TRANSITIONS,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";
import { createInspectionViewerAdapter, parseGhJsonOutput } from "../../scripts/loop/_inspect-run-viewer-adapter.mjs";
import { resolveMermaidBrowserAssetPath } from "../../scripts/loop/inspect-run-viewer/constants.mjs";

function makeSnapshot(overrides = {}) {
  return {
    ok: true,
    schemaVersion: 1,
    target: { repo: "owner/repo", pr: 55 },
    runId: "pr-55",
    inspectedAt: "2026-05-21T00:00:00.000Z",
    activeStateFamily: "copilot-pr-outer-loop",
    outerState: "continue_current_wait",
    allowedTransitions: [
      "continue_current_wait",
      "handoff_to_copilot_loop",
      "handoff_to_reviewer_loop",
      "stay_with_current_live_owner",
      "stop_needs_human",
      "done_terminal",
      "needs_reconcile",
    ],
    outerAction: "continue_wait",
    activeFamilyState: "continue_wait",
    statusClass: "waiting",
    needsAttention: false,
    sourceMode: "live-detector-backed",
    trust: "authoritative",
    evidence: { summary: "Live detectors agree.", authoritative: ["live"], checkpoint: [] },
    markers: { missing: [], stale: [], conflicts: [] },
    loopIterations: {
      available: true,
      source: "github_pr_timeline",
      completedCopilotReviewRounds: 4,
      pendingCopilotReviewRounds: 1,
      copilotReviewRequests: 5,
      copilotReviewComments: 8,
      resolvedReviewThreads: 8,
      unresolvedReviewThreads: 0,
      fixCommitsAfterFeedback: 3,
    },
    layers: {
      copilot: {
        currentState: "waiting_for_copilot_review",
        allowedTransitions: ["unresolved_feedback_present", "ready_to_rerequest_review", "waiting_for_ci"],
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
    ...overrides,
  };
}

function requestOnce(url, { method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("parseInspectRunViewerCliArgs normalizes repo values and rejects malformed input with usage", () => {
  const parsed = parseInspectRunViewerCliArgs(["--repo", "  owner/repo  "]);
  assert.equal(parsed.repo, "owner/repo");
  assert.equal("pr" in parsed, false);

  const unscoped = parseInspectRunViewerCliArgs([]);
  assert.equal(unscoped.repo, undefined);
  assert.equal("pr" in unscoped, false);

  const bracketedIpv6Host = parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "[::1]"]);
  assert.equal(bracketedIpv6Host.host, "::1");

  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "0.0.0.0"]),
    /--host must stay on localhost\/loopback unless --allow-non-localhost is set/i,
  );

  const nonLocalhostOptIn = parseInspectRunViewerCliArgs([
    "--repo",
    "owner/repo",
    "--host",
    "0.0.0.0",
    "--allow-non-localhost",
    "--restart",
  ]);
  assert.equal(nonLocalhostOptIn.host, "0.0.0.0");
  assert.equal(nonLocalhostOptIn.allowNonLocalhost, true);
  assert.equal(nonLocalhostOptIn.restart, true);

  let malformedTargetError;
  try {
    parseInspectRunViewerCliArgs(["--repo", "../../bad"]);
  } catch (error) {
    malformedTargetError = error;
  }
  assert.ok(malformedTargetError instanceof Error);
  assert.match(malformedTargetError.message, /Invalid repository slug|owner\/name|Repository slug/i);
  assert.equal(typeof malformedTargetError.usage, "string");
  assert.ok(malformedTargetError.usage.length > 0);
  assert.match(malformedTargetError.usage, /Usage: inspect-run-viewer\.mjs \[--repo <owner\/name>\]/);

  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55"]),
    /--pr is no longer supported on the CLI/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs([
      "--repo",
      "owner/repo",
      "--reviewer-login",
      "reviewer",
      "--reviewer-input",
      "tmp/reviewer.json",
    ]),
    /cannot be combined/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--reviewer-login", "   "]),
    /must not be empty/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "   "]),
    /--host must not be empty/i,
  );
});

test("restartExistingPortListener is a no-op when nothing is listening", async () => {
  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => [],
  });

  assert.deepEqual(restarted, []);
});


test("listListeningPidsForPort only treats empty-stderr lsof exit 1 as no listeners", async () => {
  const emptyResult = await listListeningPidsForPort(4311, {
    execFileImpl: async () => {
      const error = new Error("no listeners");
      error.code = 1;
      error.stderr = "";
      throw error;
    },
  });

  assert.deepEqual(emptyResult, []);

  await assert.rejects(
    () => listListeningPidsForPort(4311, {
      execFileImpl: async () => {
        const error = new Error("unsupported flag");
        error.code = 1;
        error.stderr = "lsof: illegal option";
        throw error;
      },
    }),
    /unsupported flag/,
  );
});

test("restartExistingPortListener stops existing listeners on the chosen port", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111, 222] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111, 222]);
  assert.deepEqual(killed, [
    [111, "SIGTERM"],
    [222, "SIGTERM"],
  ]);
});


test("restartExistingPortListener tolerates listeners that exit before SIGTERM", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111, 222] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
      if (pid === 111) {
        const error = new Error("process already exited");
        error.code = "ESRCH";
        throw error;
      }
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111, 222]);
  assert.deepEqual(killed, [
    [111, "SIGTERM"],
    [222, "SIGTERM"],
  ]);
});


test("restartExistingPortListener waits for the port to become free, not for the process to exit", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111]);
  assert.deepEqual(killed, [[111, "SIGTERM"]]);
  assert.equal(pollCount, 2);
});

test("formatInspectRunViewerUrl formats IPv4 and IPv6 hosts for copy-pasteable output", () => {
  assert.equal(formatInspectRunViewerUrl("127.0.0.1", 4311), "http://127.0.0.1:4311");
  assert.equal(formatInspectRunViewerUrl("::1", 4311), "http://[::1]:4311");
  assert.equal(formatInspectRunViewerUrl("[::1]", 4311), "http://[::1]:4311");
  assert.equal(formatInspectRunViewerUrl("0.0.0.0", 4311), "http://0.0.0.0:4311");
});

test("buildInspectionMermaidGraph renders full authoritative Mermaid state machines with current/next/terminal cues", () => {
  const graph = buildInspectionMermaidGraph(makeSnapshot({
    layers: {
      copilot: {
        currentState: "done",
        allowedTransitions: [],
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["review_requested"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  }));

  assert.ok(graph);
  assert.match(graph.definition, /flowchart TB/);
  assert.match(graph.definition, /subgraph outer_loop_family\["outer-loop family"\]/);
  assert.match(graph.definition, /outer_loop_family_start\(\["Start"\]\)/);
  assert.match(graph.definition, /outer_loop_family_end\(\("End"\)\)/);
  assert.match(graph.definition, /outer_loop_family_continue_current_wait\["continue current wait"\]/);
  assert.match(graph.definition, /copilot_layer_start\(\["Start"\]\)/);
  assert.match(graph.definition, /reviewer_layer_start\(\["Start"\]\)/);
  assert.match(graph.definition, /copilot_layer_no_pr\["no_pr"\]/);
  assert.match(graph.definition, /copilot_layer_ready_to_rerequest_review\["ready_to_rerequest_review"\]/);
  assert.match(graph.definition, /reviewer_layer_review_requested\["review_requested"\]/);
  assert.match(graph.definition, /reviewer_layer_waiting_for_re_request\["waiting_for_re_request"\]/);
  assert.match(graph.definition, /layer view/);
  assert.match(graph.definition, /next evaluation may resolve to any shown state/);
  assert.match(graph.definition, /class outer_loop_family_continue_current_wait,reviewer_layer_waiting_for_author_followup current;/);
  assert.match(graph.definition, /class copilot_layer_done currentTerminal;/);
  assert.match(graph.definition, /class [^\n]*reviewer_layer_review_requested next;/);
});

test("buildInspectionMermaidGraph covers every exported outer, Copilot, and reviewer state and edge", () => {
  const graph = buildInspectionMermaidGraph(makeSnapshot());

  assert.ok(graph);

  for (const state of Object.values(OUTER_STATE)) {
    const humanized = state.replaceAll("_", " ");
    assert.match(graph.definition, new RegExp(`outer_loop_family_${state}\\["${humanized}"\\]`));
  }
  for (const [state, nextStates] of Object.entries(OUTER_TRANSITIONS)) {
    if (nextStates.length === 0) {
      assert.match(graph.definition, new RegExp(`outer_loop_family_${state} --> outer_loop_family_end`));
      continue;
    }
    for (const nextState of nextStates) {
      assert.match(graph.definition, new RegExp(`outer_loop_family_${state} --> outer_loop_family_${nextState}`));
    }
  }

  for (const state of Object.values(COPILOT_STATE)) {
    assert.match(graph.definition, new RegExp(`copilot_layer_${state}\\["${state}"\\]`));
  }
  for (const [state, nextStates] of Object.entries(COPILOT_TRANSITIONS)) {
    if (nextStates.length === 0) {
      assert.match(graph.definition, new RegExp(`copilot_layer_${state} --> copilot_layer_end`));
      continue;
    }
    for (const nextState of nextStates) {
      assert.match(graph.definition, new RegExp(`copilot_layer_${state} --> copilot_layer_${nextState}`));
    }
  }

  for (const state of Object.values(REVIEWER_STATE)) {
    assert.match(graph.definition, new RegExp(`reviewer_layer_${state}\\["${state}"\\]`));
  }
  for (const [state, nextStates] of Object.entries(REVIEWER_TRANSITIONS)) {
    if (nextStates.length === 0) {
      assert.match(graph.definition, new RegExp(`reviewer_layer_${state} --> reviewer_layer_end`));
      continue;
    }
    for (const nextState of nextStates) {
      assert.match(graph.definition, new RegExp(`reviewer_layer_${state} --> reviewer_layer_${nextState}`));
    }
  }
});

test("buildInspectionMermaidGraph fails closed for invalid next-state highlights", () => {
  const graph = buildInspectionMermaidGraph(makeSnapshot({
    layers: {
      copilot: {
        currentState: "waiting_for_copilot_review",
        allowedTransitions: ["done"],
      },
      reviewer: {
        currentState: "unknown",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["review_requested"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  }));

  assert.ok(graph);
  assert.doesNotMatch(graph.definition, /class [^\n]*copilot_layer_done nextTerminal;/);
  assert.doesNotMatch(graph.definition, /class [^\n]*reviewer_layer_review_requested next;/);
});


test("buildInspectionMermaidGraph normalizes and de-duplicates transition tokens before highlighting", () => {
  const snapshot = makeSnapshot({
    layers: {
      copilot: {
        currentState: "waiting_for_copilot_review",
        allowedTransitions: [" waiting_for_ci ", "waiting_for_ci", " ready_to_rerequest_review "],
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_re_request"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });

  const graph = buildInspectionMermaidGraph(snapshot);
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot,
  });

  assert.ok(graph);
  assert.match(graph.definition, /class [^\n]*copilot_layer_waiting_for_ci[^\n]* next;/);
  assert.match(graph.definition, /class [^\n]*copilot_layer_ready_to_rerequest_review[^\n]* next;/);
  assert.match(html, /copilot layer:[\s\S]*full authoritative state machine shown; waiting_for_ci, ready_to_rerequest_review/);
  assert.doesNotMatch(html, /waiting_for_ci,\s*waiting_for_ci/);
});

test("renderInspectRunViewerHtml keeps the empty inbox copy generic across state and paging filters", () => {
  const html = renderInspectRunViewerHtml({
    repo: null,
    target: null,
    snapshot: null,
    inboxItems: [],
    inboxUpdatedWithinDays: null,
    inboxState: "all",
    inboxPage: 3,
    inboxTotalPages: 5,
  });

  assert.match(html, /No PR selected/);
  assert.match(html, /inspect-run remains authoritative for inspection\/status state while this UI owns inbox discovery plus read-only presentation\/prioritization/i);
  assert.match(html, /No assigned PR in all repos matched the current view yet\./);
  assert.match(html, /widen the state or updated filters, or move to another inbox page\./);
  assert.match(html, /<title>all repos PR inspection dashboard<\/title>/);
  assert.match(html, /aria-label="all repos PR inspection dashboard"/);
  assert.doesNotMatch(html, /assigned open PR/i);
  assert.doesNotMatch(html, /limit filters/i);
});

test("renderInspectRunViewerHtml keeps scope selection and retained target when repo casing differs", () => {
  const html = renderInspectRunViewerHtml({
    repo: "Owner/Repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
    scopeOptions: ["owner/repo", "other/repo"],
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 55 },
        title: "Selected PR",
        snapshot: makeSnapshot(),
      },
    ],
  });

  assert.match(html, /<option value="\/\?scope=owner%2Frepo&amp;repo=owner%2Frepo&amp;pr=55&amp;state=open&amp;mode=assignee" selected>owner\/repo<\/option>/);
  assert.match(html, /<option value="\/\?scope=other%2Frepo&amp;state=open&amp;mode=assignee" >other\/repo<\/option>/);
});


test("renderInspectRunViewerHtml de-dupes scope options case-insensitively", () => {
  const html = renderInspectRunViewerHtml({
    repo: "Owner/Repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
    scopeOptions: [" Owner/Repo ", "owner/repo", "other/repo"],
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 55 },
        title: "Selected PR",
        snapshot: makeSnapshot(),
      },
    ],
  });

  assert.equal(html.match(/<option[^>]*>Owner\/Repo<\/option>/g)?.length ?? 0, 1);
  assert.equal(html.match(/<option[^>]*>owner\/repo<\/option>/g)?.length ?? 0, 0);
  assert.match(html, /<option value="\/\?scope=other%2Frepo&amp;state=open&amp;mode=assignee" >other\/repo<\/option>/);
});

test("renderInspectRunViewerHtml keeps inbox selection stable when repo casing differs", () => {
  const html = renderInspectRunViewerHtml({
    repo: "Owner/Repo",
    target: { repo: "Owner/Repo", pr: 55 },
    snapshot: makeSnapshot(),
    scopeOptions: ["owner/repo"],
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 55 },
        title: "Selected PR",
        snapshot: makeSnapshot(),
      },
    ],
  });

  assert.match(html, /class="assigned-pr-row assigned-pr-row-waiting is-selected"/);
  assert.match(html, /href="\/\?scope=Owner%2FRepo&amp;repo=owner%2Frepo&amp;pr=55&amp;state=open&amp;mode=assignee" aria-current="page"/);
});

test("renderInspectRunViewerHtml hides pagination controls in the collapsed sidebar", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
    scopeOptions: ["owner/repo"],
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 55 },
        title: "Selected PR",
        snapshot: makeSnapshot(),
      },
    ],
    inboxTotalPages: 2,
  });

  assert.match(html, /\.assigned-pr-inbox\[data-sidebar-collapsed="true"\] \.assigned-pr-pagination \{ display: none; \}/);
});

test("renderInspectRunViewerHtml renders required top-level fields for authoritative snapshot and links to raw JSON", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 55 },
        title: "Selected PR",
        snapshot: makeSnapshot(),
      },
      {
        target: { repo: "other/repo", pr: 77 },
        title: "Waiting PR",
        snapshot: makeSnapshot({
          target: { repo: "other/repo", pr: 77 },
          statusClass: "blocked",
          needsAttention: true,
          layers: {
            copilot: {
              currentState: "unresolved_feedback_present",
              allowedTransitions: ["already_fixed_needs_reply_resolve"],
            },
            reviewer: {
              currentState: "waiting_for_author_followup",
              scope: { mode: "all_reviewers", reviewerLogin: null },
              allowedTransitions: ["waiting_for_re_request"],
            },
            steering: { status: "unavailable", reason: "no_steering_locator" },
          },
        }),
      },
    ],
    inboxPage: 1,
    inboxTotalPages: 2,
  });

  assert.match(html, /PR inspection dashboard/);
  assert.match(html, /Search PRs/);
  assert.match(html, /id="assigned-pr-mode-select"[^>]*aria-label="Assignment mode"/);
  assert.match(html, /<label class="assigned-pr-filter-label" for="assigned-pr-state-select">State<\/label>/);
  assert.match(html, /id="assigned-pr-updated-select"[^>]*aria-label="Updated window"/);
  assert.match(html, /grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(html, /\.assigned-pr-inbox \{[^}]*width: 22rem;[^}]*box-sizing: border-box;/);
  assert.match(html, /\.assigned-pr-row\.is-selected \.assigned-pr-link \{ box-shadow: inset 0 0 0 1px #1565c0; border-radius: 0\.3rem; \}/);
  assert.doesNotMatch(html, /\.assigned-pr-row\.is-selected \{[^}]*border-color:/);
  assert.match(html, /data-inbox-search/);
  assert.match(html, /inbox-collapse-toggle/);
  assert.match(html, />◀<\/button>/);
  assert.match(html, /\.inbox-collapse-toggle \{[^}]*background: #355061;[^}]*color: #fff;/);
  assert.match(html, /data-inbox-item/);
  assert.match(html, /data-empty-default="No assigned PRs are visible in this view\."/);
  assert.match(html, /data-empty-search="No assigned PRs match this search\."/);
  assert.match(html, /aria-current="page"/);
  assert.ok(html.indexOf('class="assigned-pr-list"') < html.indexOf('class="assigned-pr-pagination"'));
  assert.match(html, /aria-label="Previous page"/);
  assert.match(html, /aria-label="Next page"/);
  assert.doesNotMatch(html, /assigned-pr-title-indicator/);
  assert.match(html, /pr=77/);
  assert.match(html, /<a href="https:\/\/github\.com\/owner\/repo\/pull\/55">PR #55<\/a>/);
  assert.match(html, /<h1>Selected PR<\/h1>/);
  assert.match(html, /aria-label="PR #55"/);
  assert.match(html, /title="Waiting state"/);
  assert.match(html, /⏳/);
  assert.match(html, /Waiting for Copilot review/);
  assert.match(html, /Copilot review has been requested and the PR is waiting for new review activity/);
  assert.match(html, /These fields are shown directly from the loaded inspection snapshot/i);
  assert.match(html, /status class/);
  assert.match(html, /outer state/);
  assert.match(html, /outerAction \(compatibility\)/);
  assert.match(html, /current Copilot state/);
  assert.match(html, /current reviewer state/);
  assert.match(html, /reviewer verdict/);
  assert.match(html, /next action/);
  assert.match(html, /Graph guide and lane details/);
  assert.match(html, /Details/);
  assert.match(html, /target\.repo/);
  assert.match(html, /owner\/repo/);
  assert.match(html, /target\.pr/);
  assert.match(html, /55/);
  assert.match(html, /runId/);
  assert.match(html, /pr-55/);
  assert.match(html, /inspectedAt/);
  assert.match(html, /activeStateFamily/);
  assert.match(html, /outerAction/);
  assert.match(html, /activeFamilyState/);
  assert.match(html, /statusClass/);
  assert.match(html, /needsAttention/);
  assert.match(html, /sourceMode/);
  assert.match(html, /trust/);
  assert.match(html, /evidence\.summary/);
  assert.match(html, /markers\.missing/);
  assert.match(html, /markers\.stale/);
  assert.match(html, /markers\.conflicts/);
  assert.doesNotMatch(html, /authoritative graph view from the current inspection snapshot/i);
  assert.match(html, /class="state-graph-cues"/);
  assert.match(html, /class="mermaid-state-graph mermaid"/);
  assert.match(html, /data-graph-zoom-in/);
  assert.match(html, /data-graph-zoom-out/);
  assert.match(html, /data-graph-zoom-reset/);
  assert.match(html, /data-graph-fullscreen/);
  assert.match(html, /if \(!svg\) \{\s*resolve\(false\);\s*return;\s*\}/);
  assert.match(html, /if \(targetRects\.length === 0\) \{\s*resolve\(false\);\s*return;\s*\}/);
  assert.match(html, /const \[firstRect, \.\.\.remainingRects\] = targetRects;/);
  assert.match(html, /cursor: grab/);
  assert.match(html, /data-dragging="true"/);
  assert.match(html, /assets\/mermaid\.min\.js/);
  assert.match(html, /Start/);
  assert.match(html, /End/);
  assert.match(html, /Next/);
  assert.match(html, /🔁/);
  assert.match(html, /outer-loop family:[\s\S]*current <code>continue_current_wait<\/code>; continue_current_wait; full authoritative state machine shown; continue_current_wait, handoff_to_copilot_loop, handoff_to_reviewer_loop, stay_with_current_live_owner, stop_needs_human, done_terminal, needs_reconcile/);
  assert.match(html, /copilot layer:[\s\S]*full authoritative state machine shown; unresolved_feedback_present, ready_to_rerequest_review, waiting_for_ci/);
  assert.match(html, /reviewer layer:[\s\S]*full authoritative state machine shown; waiting_for_re_request, waiting_for_review_request/);
  assert.match(html, /Dimmed nodes are still part of the authoritative state machine/);
  assert.ok(html.indexOf('class="mermaid-state-graph mermaid"') < html.indexOf('class="state-graph-cues"'));
  assert.match(html, /outer lane now comes from the shared authoritative outer-loop graph contract/);
  assert.match(html, /outer-loop summary/);
  assert.match(html, /Copilot loop iterations/);
  assert.match(html, /4 completed, 1 pending/);
  assert.match(html, /fix commits: 3/);
  assert.match(html, /copilot layer/);
  assert.match(html, /reviewer layer/);
  assert.match(html, /steering summary/);
  assert.match(html, /href="\/snapshot\.json\?repo=owner%2Frepo&amp;pr=55"/);
  assert.match(html, /manual reload only/i);
  assert.doesNotMatch(html, /Connected state map/);
  assert.doesNotMatch(html, /"schemaVersion": 1/);
  assert.doesNotMatch(html, /"ok": true/);
});

test("renderInspectRunViewerHtml keeps selected handoff-to-copilot rows on the attention border", () => {
  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 3 },
    snapshot: makeSnapshot({
      target: { repo: "owner/repo", pr: 3 },
      outerState: "handoff_to_copilot_loop",
      outerAction: "reenter_copilot_loop",
      activeFamilyState: "reenter_copilot_loop",
      statusClass: "active",
      needsAttention: false,
      layers: {
        copilot: {
          currentState: "review_requested",
          allowedTransitions: ["determine_review_plan"],
        },
        reviewer: {
          currentState: "waiting_for_review_request",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["review_requested"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
    inboxItems: [
      { target: { repo: "owner/repo", pr: 3 }, title: "docs: add IAM policy guide", updatedAt: "2026-05-22T00:00:00Z" },
    ],
  });

  assert.match(html, /assigned-pr-row-attention/);
  assert.match(html, /is-selected/);
  assert.match(html, /Copilot loop needs action/);
  assert.match(html, /title="Active loop"/);
  assert.match(html, /🔁/);
});

test("renderInspectRunViewerHtml shows waiting inbox signal when outer routing hands off a waiting Copilot state", () => {
  const waitingSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 3 },
    outerState: "handoff_to_reviewer_loop",
    outerAction: "reenter_reviewer_loop",
    activeFamilyState: "reenter_reviewer_loop",
    statusClass: "active",
    needsAttention: false,
    layers: {
      copilot: {
        currentState: "waiting_for_copilot_review",
        allowedTransitions: ["unresolved_feedback_present", "ready_to_rerequest_review", "waiting_for_ci"],
      },
      reviewer: {
        currentState: "review_requested",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_author_followup"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });
  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 3 },
    snapshot: waitingSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 3 }, title: "fix: wait signal", updatedAt: "2026-05-22T00:00:00Z", snapshot: waitingSnapshot },
    ],
  });

  assert.match(html, /assigned-pr-row assigned-pr-row-waiting is-selected/);
  assert.match(html, /data-inbox-signal="waiting"/);
  assert.match(html, /<span class="assigned-pr-signal-emoji" aria-label="Waiting">⏳<\/span>/);
  assert.match(html, /title="Waiting state"/);
});

test("renderInspectRunViewerHtml does not headline waiting_for_ci when reviewer loop is the authoritative owner", () => {
  const reviewerActiveSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 7 },
    outerState: "handoff_to_reviewer_loop",
    outerAction: "reenter_reviewer_loop",
    activeFamilyState: "reenter_reviewer_loop",
    statusClass: "active",
    needsAttention: false,
    layers: {
      copilot: {
        currentState: "waiting_for_ci",
        allowedTransitions: ["ready_to_rerequest_review"],
      },
      reviewer: {
        currentState: "review_requested",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["determine_review_plan"],
        submittedReviewState: "APPROVED",
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });

  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 7 },
    snapshot: reviewerActiveSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 7 }, title: "fix: reviewer beats ci wait", updatedAt: "2026-05-22T00:00:00Z", snapshot: reviewerActiveSnapshot },
    ],
  });

  assert.match(html, /<p class="current-pr-state-summary-headline">Reviewer loop active<\/p>/);
  assert.match(html, /<span class="assigned-pr-headline">Reviewer loop active<\/span>/);
  assert.doesNotMatch(html, /<p class="current-pr-state-summary-headline">Waiting for CI<\/p>/);
  assert.doesNotMatch(html, /<span class="assigned-pr-headline">Waiting for CI<\/span>/);
});

test("renderInspectRunViewerHtml uses a gate inbox signal when clean convergence still needs gate evidence", () => {
  const gateSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 55 },
    outerState: "continue_current_wait",
    outerAction: "continue_wait",
    activeFamilyState: "continue_wait",
    statusClass: "waiting",
    needsAttention: false,
    layers: {
      copilot: {
        currentState: "ready_to_rerequest_review",
        allowedTransitions: ["waiting_for_copilot_review", "review_request_unavailable", "done"],
        sameHeadCleanConverged: true,
        loopDisposition: "clean_converged",
        terminal: true,
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        submittedReviewState: "APPROVED",
        approvedOnCurrentHead: true,
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });

  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 55 },
    snapshot: gateSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 55 }, title: "fix: gate signal", updatedAt: "2026-05-22T00:00:00Z", snapshot: gateSnapshot },
    ],
  });

  assert.match(html, /assigned-pr-row assigned-pr-row-gate is-selected/);
  assert.match(html, /data-inbox-signal="gate"/);
  assert.match(html, /<span class="assigned-pr-signal-emoji" aria-label="Gate review required">🛡️<\/span>/);
  assert.match(html, /Gate review required/);
});

test("renderInspectRunViewerHtml keeps hard attention ahead of waiting layer inbox signals", () => {
  const attentionSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 3 },
    outerState: "needs_reconcile",
    outerAction: "stop",
    activeFamilyState: "stop",
    statusClass: "blocked",
    needsAttention: true,
    layers: {
      copilot: {
        currentState: "waiting_for_copilot_review",
        allowedTransitions: ["unresolved_feedback_present", "ready_to_rerequest_review", "waiting_for_ci"],
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_re_request"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });
  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 3 },
    snapshot: attentionSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 3 }, title: "fix: attention signal", updatedAt: "2026-05-22T00:00:00Z", snapshot: attentionSnapshot },
    ],
  });

  assert.match(html, /assigned-pr-row assigned-pr-row-attention is-selected/);
  assert.match(html, /data-inbox-signal="attention"/);
  assert.match(html, /<span class="assigned-pr-signal-emoji" aria-label="Needs attention">🔴<\/span>/);
});

test("renderInspectRunViewerHtml keeps selected closed inbox rows on the closed border", () => {
  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 3 },
    snapshot: makeSnapshot({
      target: { repo: "owner/repo", pr: 3 },
      outerState: "continue_current_wait",
      outerAction: "continue_wait",
      activeFamilyState: "continue_wait",
      statusClass: "waiting",
      needsAttention: false,
    }),
    inboxItems: [
      {
        target: { repo: "owner/repo", pr: 3 },
        title: "docs: add IAM policy guide",
        updatedAt: "2026-05-22T00:00:00Z",
        signal: "closed",
        snapshot: makeSnapshot({
          target: { repo: "owner/repo", pr: 3 },
          outerState: "continue_current_wait",
          outerAction: "continue_wait",
          activeFamilyState: "continue_wait",
          statusClass: "waiting",
          needsAttention: false,
        }),
      },
    ],
  });

  assert.match(html, /assigned-pr-row-closed/);
  assert.match(html, /data-inbox-signal="closed"/);
  assert.match(html, /is-selected/);
  assert.match(html, /Waiting for Copilot review/);
});

test("renderInspectRunViewerHtml renders checkpoint-only \/ degraded cues and absent sections", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      sourceMode: "checkpoint-only",
      trust: "checkpoint",
      needsAttention: true,
      outerState: "unknown",
      allowedTransitions: undefined,
      outerAction: "unknown",
      activeFamilyState: "unknown",
      statusClass: "unknown",
      loopIterations: {
        available: false,
        source: "github_pr_timeline",
        reason: "no_copilot_review_history",
      },
      layers: {
        steering: { status: "unavailable", reason: "no_steering_file" },
      },
    }),
  });

  assert.match(html, /checkpoint-only/);
  assert.doesNotMatch(html, /checkpoint-only graph view[\s\S]*current and next highlights are advisory until live inspection is available\./i);
  assert.match(html, /Needs attention/);
  assert.match(html, /The current snapshot is not authoritative enough to collapse to one trusted outer state/);
  assert.match(html, /This is a checkpoint-only snapshot\. The current-state fields below are advisory, not live-confirmed\./i);
  assert.match(html, /class="mermaid-state-graph mermaid"/);
  assert.match(html, /current state unavailable/);
  assert.match(html, /not present \/ unavailable/);
  assert.match(html, /copilot layer:[\s\S]*full authoritative state machine shown; transition data unavailable in this snapshot/);
  assert.match(html, /reviewer layer:[\s\S]*full authoritative state machine shown; transition data unavailable in this snapshot/);
  assert.match(html, /no_copilot_review_history/);
  assert.match(html, /no_steering_file/);
});

test("renderInspectRunViewerHtml distinguishes empty transitions from unavailable transition data", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      layers: {
        copilot: {
          currentState: "waiting_for_copilot_review",
          allowedTransitions: [],
        },
        reviewer: {
          currentState: "waiting_for_author_followup",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["waiting_for_re_request"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(html, /copilot layer:[\s\S]*full authoritative state machine shown; no allowed transitions/);
  assert.doesNotMatch(html, /copilot layer:[\s\S]*full authoritative state machine shown; transition data unavailable in this snapshot/);
});

test("renderInspectRunViewerHtml highlights terminal merged states", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      outerState: "done_terminal",
      activeFamilyState: "done",
      outerAction: "done",
      statusClass: "done",
      layers: {
        copilot: {
          currentState: "done",
          allowedTransitions: [],
        },
        reviewer: {
          currentState: "waiting_for_review_request",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: [],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(html, /<a href="https:\/\/github\.com\/owner\/repo\/pull\/55">PR #55<\/a>/);
  assert.match(html, /PR complete/);
  assert.match(html, /The current inspection says this PR is in a terminal done state/);
  assert.match(html, /status class[\s\S]*<code>done<\/code>/);
  assert.match(html, /outerAction \(compatibility\)[\s\S]*<code>done<\/code>/);

  const graph = buildInspectionMermaidGraph(makeSnapshot({
    outerState: "done_terminal",
    activeFamilyState: "done",
    outerAction: "done",
    statusClass: "done",
    layers: {
      copilot: {
        currentState: "done",
        allowedTransitions: [],
      },
      reviewer: {
        currentState: "waiting_for_review_request",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: [],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  }));

  assert.ok(graph);
  assert.match(graph.definition, /class outer_loop_family_done_terminal,copilot_layer_done currentTerminal;/);
  assert.match(graph.definition, /copilot_layer_done --> copilot_layer_end/);
  assert.match(html, /copilot layer:[\s\S]*current <code>done<\/code>; done; full authoritative state machine shown; no allowed transitions/);
});

test("renderInspectRunViewerHtml keeps stale approved snapshots on waiting until Copilot is re-requested", () => {
  const staleApprovedSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 57 },
    outerState: "continue_current_wait",
    outerAction: "continue_wait",
    activeFamilyState: "continue_wait",
    statusClass: "waiting",
    needsAttention: false,
    layers: {
      copilot: {
        currentState: "ready_to_rerequest_review",
        allowedTransitions: ["waiting_for_copilot_review", "review_request_unavailable", "done"],
        sameHeadCleanConverged: false,
        loopDisposition: "pending",
        terminal: false,
      },
      reviewer: {
        currentState: "waiting_for_author_followup",
        submittedReviewState: "APPROVED",
        approvedOnCurrentHead: true,
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });

  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 57 },
    snapshot: staleApprovedSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 57 }, title: "fix: stale approved signal", updatedAt: "2026-05-22T00:00:00Z", snapshot: staleApprovedSnapshot },
    ],
  });

  assert.match(html, /assigned-pr-row assigned-pr-row-waiting is-selected/);
  assert.match(html, /data-inbox-signal="waiting"/);
  assert.doesNotMatch(html, /Gate review required/);
});

test("renderInspectRunViewerHtml keeps completed snapshots on the ready inbox signal", () => {
  const doneSnapshot = makeSnapshot({
    target: { repo: "owner/repo", pr: 56 },
    outerState: "done_terminal",
    outerAction: "done",
    activeFamilyState: "done",
    statusClass: "done",
    needsAttention: false,
    layers: {
      copilot: {
        currentState: "done",
        allowedTransitions: [],
        sameHeadCleanConverged: false,
        loopDisposition: "done",
        terminal: true,
      },
      reviewer: {
        currentState: "waiting_for_review_request",
        scope: { mode: "all_reviewers", reviewerLogin: null },
        allowedTransitions: [],
      },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  });

  const html = renderInspectRunViewerHtml({
    repo: null,
    target: { repo: "owner/repo", pr: 56 },
    snapshot: doneSnapshot,
    inboxItems: [
      { target: { repo: "owner/repo", pr: 56 }, title: "fix: done signal", updatedAt: "2026-05-22T00:00:00Z", snapshot: doneSnapshot },
    ],
  });

  assert.match(html, /assigned-pr-row assigned-pr-row-ready is-selected/);
  assert.match(html, /data-inbox-signal="ready"/);
  assert.doesNotMatch(html, /data-inbox-signal="gate"/);
});

test("renderInspectRunViewerHtml requires explicit gate evidence before framing clean convergence as approval-ready", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      outerState: "continue_current_wait",
      outerAction: "continue_wait",
      statusClass: "waiting",
      layers: {
        copilot: {
          currentState: "ready_to_rerequest_review",
          allowedTransitions: ["waiting_for_copilot_review", "review_request_unavailable", "done"],
          sameHeadCleanConverged: true,
          loopDisposition: "clean_converged",
          terminal: true,
        },
        reviewer: {
          currentState: "waiting_for_author_followup",
          submittedReviewState: "APPROVED",
          approvedOnCurrentHead: true,
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(html, /Clean reviews present; gate evidence still required/);
  assert.match(html, /clean submitted Copilot review and an approved human review, but approval or merge suggestions still require explicit current-head pre_approval_gate evidence/i);
  assert.match(html, /Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation/i);
  assert.match(html, /reviewer verdict[\s\S]*approved on current head/i);
  assert.doesNotMatch(html, /Approved current head/);
  assert.doesNotMatch(html, /Proceed to merge if authorized/i);
});

test("renderInspectRunViewerHtml blocks approval-oriented language for same-head clean Copilot reviews without gate evidence", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      outerState: "continue_current_wait",
      outerAction: "continue_wait",
      statusClass: "waiting",
      layers: {
        copilot: {
          currentState: "ready_to_rerequest_review",
          allowedTransitions: ["waiting_for_copilot_review", "review_request_unavailable", "done"],
          sameHeadCleanConverged: true,
          loopDisposition: "clean_converged",
          terminal: true,
        },
        reviewer: {
          currentState: "waiting_for_author_followup",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["waiting_for_re_request", "waiting_for_review_request"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(html, /Copilot pass complete; gate evidence still required/);
  assert.match(html, /current head already has a clean submitted Copilot review with no unresolved feedback, but that alone is not enough for an approval or merge suggestion/i);
  assert.match(html, /Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation, or wait for a meaningful remediation event before requesting another Copilot pass/i);
  assert.doesNotMatch(html, /Proceed to final human review or approval/i);
  assert.doesNotMatch(html, /Ready to re-request Copilot review/);
});

test("renderInspectRunViewerHtml preserves stay_with_current_live_owner and needs_reconcile in the banner", () => {
  const liveOwnerHtml = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      outerState: "stay_with_current_live_owner",
      outerAction: "continue_wait",
      layers: {
        copilot: {
          currentState: "ready_to_rerequest_review",
          allowedTransitions: ["waiting_for_copilot_review", "review_request_unavailable", "done"],
        },
        reviewer: {
          currentState: "review_requested",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["determine_review_plan", "blocked_needs_user_decision"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(liveOwnerHtml, /Live owner already active/);
  assert.match(liveOwnerHtml, /stay_with_current_live_owner/);
  assert.doesNotMatch(liveOwnerHtml, /Reviewer loop active/);

  const reconcileHtml = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      outerState: "needs_reconcile",
      outerAction: "stop",
      statusClass: "blocked",
      needsAttention: true,
      layers: {
        copilot: {
          currentState: "waiting_for_copilot_review",
          allowedTransitions: ["unresolved_feedback_present", "ready_to_rerequest_review", "waiting_for_ci"],
        },
        reviewer: {
          currentState: "waiting_for_review_request",
          scope: { mode: "all_reviewers", reviewerLogin: null },
          allowedTransitions: ["review_requested"],
        },
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(reconcileHtml, /Needs reconcile/);
  assert.match(reconcileHtml, /needs_reconcile/);
  assert.doesNotMatch(reconcileHtml, /The inspection found a blocked or stop-like state/);
});

test("renderInspectRunViewerHtml renders conflicting snapshot cues", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      needsAttention: true,
      markers: {
        missing: [],
        stale: [],
        conflicts: ["checkpoint outerAction 'continue_wait' differs from live-derived 'reenter_copilot_loop'"],
      },
    }),
  });

  assert.match(html, /Snapshot state:[\s\S]*conflicting/);
  assert.doesNotMatch(html, /Conflicting graph view[\s\S]*resolve the evidence conflict before trusting the highlights\./i);
  assert.match(html, /Conflicting evidence is present\. Treat the current-state fields below as advisory until the snapshot is reconciled\./i);
  assert.match(html, /checkpoint outerAction/);
});

test("renderInspectRunViewerHtml renders unavailable snapshot and malformed target load errors explicitly", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "bad target", pr: "x" },
    snapshot: null,
    error: new Error("target.pr must be a positive integer"),
  });

  assert.match(html, /Snapshot unavailable/);
  assert.match(html, /target\.pr must be a positive integer/);
  assert.match(html, /no state graph can be rendered yet/i);
  assert.match(html, /manual reload only/i);
  assert.match(html, /href="\/snapshot\.json\?repo=bad(?:\+|%20)target&amp;pr=x"/);
});


test("renderInspectRunViewerHtml treats undefined snapshots as unavailable", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: undefined,
  });

  assert.match(html, /Snapshot unavailable/);
  assert.match(html, /Unable to load inspect-run snapshot/);
});

test("buildInspectionMermaidGraph suppresses graph rendering for sourceMode unavailable even with conflicting markers", () => {
  const graph = buildInspectionMermaidGraph(makeSnapshot({
    sourceMode: "unavailable",
    trust: "unknown",
    markers: {
      missing: [],
      stale: [],
      conflicts: ["live and checkpoint disagree"],
    },
  }));

  assert.equal(graph, null);
});

test("renderInspectRunViewerHtml includes deterministic Mermaid asset fallback messaging", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
  });

  assert.match(html, /Mermaid browser asset unavailable\. Use the details below or open \/snapshot\.json\./);
});
test("renderInspectRunViewerHtml fail-closes the graph for unavailable snapshots", () => {
  const html = renderInspectRunViewerHtml({
    repo: "owner/repo",
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      sourceMode: "unavailable",
      trust: "unknown",
      activeFamilyState: "unknown",
      layers: {
        steering: { status: "unavailable", reason: "no_steering_locator" },
      },
    }),
  });

  assert.match(html, /Snapshot unavailable, so no state graph can be rendered yet/);
  assert.doesNotMatch(html, /class="mermaid-state-graph mermaid"/);
});

test("createInspectionViewerAdapter loadSnapshot validates target deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "owner/repo", pr: "nope" }),
    /positive integer/,
  );
  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "../../bad", pr: 55 }),
    /target\.repo must match <owner\/name>/,
  );
});

test("createInspectionViewerAdapter keeps normalized target authoritative over options", async () => {
  let inspectRunCall;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async (input) => {
      inspectRunCall = input;
      return { ok: true };
    },
  });

  await adapter.loadSnapshot(
    { repo: "owner/repo", pr: "55" },
    { repo: "other/repo", pr: 99, reviewerLogin: "reviewer" },
  );

  assert.deepEqual(inspectRunCall, {
    repo: "owner/repo",
    pr: 55,
    reviewerLogin: "reviewer",
  });
});

test("createInspectionViewerAdapter omits --updated when updatedWithinDays is null", async () => {
  const seenArgs = [];
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async (args) => {
      seenArgs.push(args);
      return [];
    },
  });

  await adapter.listAssignedPullRequests({ repo: "owner/repo", updatedWithinDays: null });

  assert.deepEqual(seenArgs[0], [
    "search",
    "prs",
    "--assignee",
    "@me",
    "--repo",
    "owner/repo",
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    "25",
    "--json",
    "number,title,repository,updatedAt,state,isDraft",
  ]);
  for (const args of seenArgs) {
    assert.equal(args.includes("--updated"), false);
  }
});

test("createInspectionViewerAdapter refreshes expired assigned PR cache entries", async () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  let ghCalls = 0;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    nowImpl: () => nowMs,
    runGhJsonImpl: async (args) => {
      ghCalls += 1;
      if (args.includes("changes_requested") || args.includes("failure") || args.includes("pending") || args.includes("approved")) {
        return [];
      }
      return [
        {
          number: 55,
          title: "Primary PR",
          repository: { nameWithOwner: "owner/repo" },
          state: "OPEN",
          isDraft: false,
        },
      ];
    },
  });

  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 5);

  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 5);

  nowMs += 16_000;
  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 10);
});

test("createInspectionViewerAdapter lists assigned open PRs for the current user", async () => {
  const seenArgs = [];
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    nowImpl: () => Date.parse("2026-05-21T00:00:00.000Z"),
    runGhJsonImpl: async (args) => {
      seenArgs.push(args);
      if (args.includes("changes_requested")) {
        return [
          { number: 77, repository: { owner: { login: "other" }, name: "repo" } },
        ];
      }
      if (args.includes("failure")) {
        return [];
      }
      if (args.includes("pending")) {
        return [];
      }
      if (args.includes("approved")) {
        return [
          { number: 55, repository: { nameWithOwner: "owner/repo" } },
        ];
      }
      return [
        {
          number: 77,
          title: "Needs attention PR",
          repository: { owner: { login: "other" }, name: "repo" },
          state: "OPEN",
          isDraft: false,
        },
        {
          number: 55,
          title: "Primary PR",
          repository: { nameWithOwner: "owner/repo" },
          state: "OPEN",
          isDraft: false,
        },
      ];
    },
  });

  const assigned = await adapter.listAssignedPullRequests({ repo: "owner/repo" });

  assert.deepEqual(seenArgs[0], [
    "search",
    "prs",
    "--assignee",
    "@me",
    "--repo",
    "owner/repo",
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--updated",
    ">=2026-05-14",
    "--limit",
    "25",
    "--json",
    "number,title,repository,updatedAt,state,isDraft",
  ]);
  assert.equal(seenArgs.length, 5);
  assert.deepEqual(assigned, [
    { target: { repo: "other/repo", pr: 77 }, title: "Needs attention PR", updatedAt: null, signal: "attention" },
    { target: { repo: "owner/repo", pr: 55 }, title: "Primary PR", updatedAt: null, signal: "ready" },
  ]);
});

test("parseGhJsonOutput wraps invalid gh JSON deterministically", () => {
  assert.throws(
    () => parseGhJsonOutput("not json\n"),
    /Invalid JSON from gh: not json/,
  );
});

test("createInspectionViewerAdapter listAssignedPullRequests reports invalid gh JSON deterministically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inspect-viewer-gh-"));

  try {
    const fakeGh = path.join(dir, "fake-gh.sh");
    await writeFile(fakeGh, "#!/bin/sh\nprintf 'not json\n'\n", "utf8");
    await chmod(fakeGh, 0o755);

    const adapter = createInspectionViewerAdapter({
      inspectRunImpl: async () => ({ ok: true }),
    });

    await assert.rejects(
      () => adapter.listAssignedPullRequests({ repo: "owner/repo", ghCommand: fakeGh }),
      /Invalid JSON from gh: not json/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("createInspectionViewerAdapter listAssignedPullRequests wraps malformed repo filters deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async () => {
      throw new Error("should not reach gh");
    },
  });

  await assert.rejects(
    () => adapter.listAssignedPullRequests({ repo: "owner" }),
    (error) => error?.code === "MALFORMED_TARGET" && /repo must match <owner\/name>/.test(String(error?.message)),
  );
});

test("createInspectionViewerAdapter listAssignedPullRequests skips malformed search rows", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async (args) => {
      if (args.includes("changes_requested") || args.includes("failure") || args.includes("pending") || args.includes("approved")) {
        return [];
      }
      return [
        { number: 0, repository: { nameWithOwner: "owner/repo" } },
        { number: 12, repository: null },
        { number: 44, repository: { owner: { login: "owner" }, name: "repo" }, state: "OPEN", isDraft: false },
      ];
    },
  });

  const assigned = await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.deepEqual(assigned, [
    { target: { repo: "owner/repo", pr: 44 }, title: null, updatedAt: null, signal: "waiting" },
  ]);
});

test("createInspectRunViewerServer serves browser html from adapter snapshot without inline full snapshot dump", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot({ sourceMode: "partial", trust: "degraded" });
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /<a href="https:\/\/github\.com\/owner\/repo\/pull\/55">PR #55<\/a>/);
    assert.match(response.body, /owner\/repo/);
    assert.match(response.body, /degraded/);
    assert.match(response.body, /manual reload only/i);
    assert.match(response.body, /href="\/snapshot\.json\?repo=owner%2Frepo&amp;pr=55"/);
    assert.doesNotMatch(response.body, /"schemaVersion": 1/);
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer does not eager-load non-selected sidebar snapshots", async () => {
  const seenTargets = [];
  const adapter = {
    async loadSnapshot(target) {
      seenTargets.push(`${target.repo}#${target.pr}`);
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests() {
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Current PR" },
        ...Array.from({ length: 15 }, (_, index) => ({
          target: { repo: `other/repo-${index + 1}`, pr: index + 1 },
          title: `PR ${index + 1}`,
        })),
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.equal(seenTargets.length, 1);
    assert.equal(seenTargets[0], "owner/repo#55");
    assert.match(response.body, /PR 15/);
    assert.doesNotMatch(response.body, /Snapshot unavailable/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer skips malformed assigned inbox entries instead of blanking the list", async () => {
  const adapter = {
    async loadSnapshot(target) {
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests() {
      return [
        { target: { repo: "../../bad", pr: 99 }, title: "Broken" },
        { target: { repo: "other/repo", pr: 77 }, title: "Still visible" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Still visible/);
    assert.doesNotMatch(response.body, /Broken/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer supports selecting another PR from query params", async () => {
  const seenTargets = [];
  const adapter = {
    async loadSnapshot(target) {
      seenTargets.push(target);
      return makeSnapshot({
        target,
        runId: `pr-${target.pr}`,
      });
    },
    async listAssignedPullRequests() {
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Default" },
        { target: { repo: "owner/repo", pr: 77 }, title: "Selected from inbox" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/?pr=77`);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /aria-label="PR #77"/);
    assert.match(response.body, /<h1>Selected from inbox<\/h1>/);
    assert.match(response.body, /Selected from inbox/);
    assert.match(response.body, /href="\/snapshot\.json\?repo=owner%2Frepo&amp;pr=77"/);
    assert.ok(seenTargets.some((target) => target.repo === "owner/repo" && target.pr === 77));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("resolveMermaidBrowserAssetPath prefers module resolution when available", () => {
  const resolvedPath = resolveMermaidBrowserAssetPath({
    resolveImpl: (specifier) => {
      assert.equal(specifier, "mermaid/dist/mermaid.min.js");
      return "/tmp/custom-mermaid/mermaid.min.js";
    },
  });

  assert.equal(resolvedPath, "/tmp/custom-mermaid/mermaid.min.js");
});

test("resolveMermaidBrowserAssetPath falls back to the repo-relative mermaid asset path", () => {
  const resolvedPath = resolveMermaidBrowserAssetPath({
    resolveImpl: () => {
      throw new Error("module resolution unavailable");
    },
  });

  assert.match(resolvedPath, /node_modules[\\/]mermaid[\\/]dist[\\/]mermaid\.min\.js$/);
});

test("createInspectRunViewerServer serves the Mermaid browser asset without loading a snapshot", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot();
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/assets/mermaid.min.js`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/javascript; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /mermaid/i);
    assert.equal(loadCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("loadMermaidBrowserScript clears failed cache entries so later retries can recover", async () => {
  let callCount = 0;
  resetMermaidBrowserScriptCache();

  try {
    await assert.rejects(
      () => loadMermaidBrowserScript({
        readFileImpl: async () => {
          callCount += 1;
          throw new Error("missing mermaid asset");
        },
      }),
      /missing mermaid asset/,
    );

    const firstSuccess = await loadMermaidBrowserScript({
      readFileImpl: async () => {
        callCount += 1;
        return "mermaid browser bundle";
      },
    });
    const secondSuccess = await loadMermaidBrowserScript({
      readFileImpl: async () => {
        callCount += 1;
        return "should stay cached";
      },
    });

    assert.equal(firstSuccess, "mermaid browser bundle");
    assert.equal(secondSuccess, "mermaid browser bundle");
    assert.equal(callCount, 2);
  } finally {
    resetMermaidBrowserScriptCache();
  }
});

test("createInspectRunViewerServer keeps Mermaid asset failures generic and path-free", async () => {
  let loadCount = 0;
  const loggedErrors = [];
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot();
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    {
      adapter,
      loadMermaidBrowserScriptImpl: async () => {
        throw new Error("ENOENT: open '/Users/tester/project/node_modules/mermaid/dist/mermaid.min.js'");
      },
      logErrorImpl: (error) => {
        loggedErrors.push(error instanceof Error ? error.message : String(error));
      },
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/assets/mermaid.min.js`);

    assert.equal(response.statusCode, 500);
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body, "Mermaid browser asset unavailable");
    assert.doesNotMatch(response.body, /Users\/tester/);
    assert.equal(loadCount, 0);
    assert.deepEqual(loggedErrors, ["ENOENT: open '/Users/tester/project/node_modules/mermaid/dist/mermaid.min.js'"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer serves authoritative snapshot JSON on /snapshot.json", async () => {
  let loadCount = 0;
  const snapshot = makeSnapshot({ sourceMode: "partial", trust: "degraded" });
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return snapshot;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), snapshot);
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer preserves cached authoritative inbox signals after another PR is selected", async () => {
  const adapter = {
    async loadSnapshot(target) {
      if (target.pr === 55) {
        return makeSnapshot({
          target,
          layers: {
            copilot: {
              currentState: "ready_to_rerequest_review",
              allowedTransitions: [],
              sameHeadCleanConverged: true,
              loopDisposition: "clean_converged",
              terminal: false,
            },
            reviewer: {
              currentState: "waiting_for_review_request",
              scope: { mode: "all_reviewers", reviewerLogin: null },
              allowedTransitions: [],
            },
            steering: { status: "unavailable", reason: "no_steering_locator" },
          },
        });
      }
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests() {
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Ready PR", signal: "waiting", updatedAt: "2026-05-21T00:00:00Z" },
        { target: { repo: "owner/repo", pr: 77 }, title: "Selected later", signal: "waiting", updatedAt: "2026-05-22T00:00:00Z" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const firstResponse = await requestOnce(`http://127.0.0.1:${address.port}/?repo=owner/repo&pr=55`);
    assert.equal(firstResponse.statusCode, 200);
    assert.match(firstResponse.body, /assigned-pr-row-gate/);

    const secondResponse = await requestOnce(`http://127.0.0.1:${address.port}/?repo=owner/repo&pr=77`);
    assert.equal(secondResponse.statusCode, 200);
    assert.match(secondResponse.body, /Ready PR/);
    assert.match(secondResponse.body, /assigned-pr-row-gate/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer honors an explicit inbox page even when a selected PR exists", async () => {
  const seenTargets = [];
  const adapter = {
    async loadSnapshot(target) {
      seenTargets.push(target);
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests() {
      return Array.from({ length: 30 }, (_, index) => ({
        target: { repo: "owner/repo", pr: index + 1 },
        title: `PR ${index + 1}`,
        updatedAt: `2026-05-${String((index % 9) + 10).padStart(2, "0")}T00:00:00Z`,
      }));
    },
  };

  const server = createInspectRunViewerServer(
    { host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/?repo=owner/repo&pr=1&page=2`);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /aria-label="PR #1"/);
    assert.match(response.body, /<h1>PR 1<\/h1>/);
    assert.match(response.body, /class="assigned-pr-page-status">2\/2</);
    assert.match(response.body, /PR 30/);
    assert.doesNotMatch(response.body, /aria-current="page"/);
    assert.ok(seenTargets.some((target) => target.repo === "owner/repo" && target.pr === 1));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer keeps explicit query targets even when they are not in the current inbox page", async () => {
  const seenTargets = [];
  const adapter = {
    async loadSnapshot(target) {
      seenTargets.push(target);
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests() {
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Primary PR", updatedAt: "2026-05-21T00:00:00Z" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const htmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/?repo=owner/repo&pr=77`);
    assert.equal(htmlResponse.statusCode, 200);
    assert.match(htmlResponse.body, /aria-label="PR #77"/);
    assert.match(htmlResponse.body, /<h1>PR #77<\/h1>/);
    assert.match(htmlResponse.body, /href="\/snapshot\.json\?repo=owner%2Frepo&amp;pr=77"/);
    assert.doesNotMatch(htmlResponse.body, /aria-current="page"/);
    assert.doesNotMatch(htmlResponse.body, /#77<\/span>/);

    const jsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json?repo=owner/repo&pr=77`);
    assert.equal(jsonResponse.statusCode, 200);
    const payload = JSON.parse(jsonResponse.body);
    assert.equal(payload.target.repo, "owner/repo");
    assert.equal(payload.target.pr, 77);
    assert.ok(seenTargets.some((target) => target.repo === "owner/repo" && target.pr === 77));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer resolves /snapshot.json target from query params", async () => {
  const seenTargets = [];
  const adapter = {
    async loadSnapshot(target) {
      seenTargets.push(target);
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json?pr=77`);

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.target.repo, "owner/repo");
    assert.equal(payload.target.pr, 77);
    assert.ok(seenTargets.some((target) => target.repo === "owner/repo" && target.pr === 77));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer treats missing JSON snapshots as machine-readable failures", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return undefined;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);

    assert.equal(response.statusCode, 500);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "inspection snapshot unavailable" },
    });
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer keeps JSON failures machine-readable and HTML failures browser-friendly", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      throw new Error("inspection snapshot unavailable");
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    const htmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/`);
    assert.equal(htmlResponse.statusCode, 200);
    assert.equal(htmlResponse.headers["content-type"], "text/html; charset=utf-8");
    assert.match(htmlResponse.body, /Snapshot unavailable/);
    assert.match(htmlResponse.body, /inspection snapshot unavailable/);

    const jsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);
    assert.equal(jsonResponse.statusCode, 500);
    assert.equal(jsonResponse.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(jsonResponse.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(jsonResponse.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "inspection snapshot unavailable" },
    });

    assert.equal(loadCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer keeps favicon, unsupported paths, and unsupported methods load-free", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot();
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    const faviconResponse = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}/favicon.ico`, (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers }));
      }).on("error", reject);
    });
    assert.equal(faviconResponse.statusCode, 204);
    assert.equal(loadCount, 0);

    const missingResponse = await requestOnce(`http://127.0.0.1:${address.port}/nope`);
    assert.equal(missingResponse.statusCode, 404);
    assert.equal(missingResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);

    const postHtmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/`, { method: "POST" });
    assert.equal(postHtmlResponse.statusCode, 405);
    assert.equal(postHtmlResponse.headers.allow, "GET");
    assert.equal(postHtmlResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);

    const postJsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`, { method: "POST" });
    assert.equal(postJsonResponse.statusCode, 405);
    assert.equal(postJsonResponse.headers.allow, "GET");
    assert.equal(postJsonResponse.headers["cache-control"], "no-store");

    const postMermaidResponse = await requestOnce(`http://127.0.0.1:${address.port}/assets/mermaid.min.js`, { method: "POST" });
    assert.equal(postMermaidResponse.statusCode, 405);
    assert.equal(postMermaidResponse.headers.allow, "GET");
    assert.equal(postMermaidResponse.headers["cache-control"], "no-store");

    const postMissingPathResponse = await requestOnce(`http://127.0.0.1:${address.port}/nope`, { method: "POST" });
    assert.equal(postMissingPathResponse.statusCode, 404);
    assert.equal(postMissingPathResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("createInspectRunViewerServer treats malformed repo slug query params as bad requests", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      throw new Error("should not load snapshot for malformed targets");
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const htmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/?repo=../../bad&pr=77`);
    assert.equal(htmlResponse.statusCode, 400);
    assert.equal(htmlResponse.body, "Bad Request");

    const jsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json?repo=../../bad&pr=77`);
    assert.equal(jsonResponse.statusCode, 400);
    assert.equal(jsonResponse.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(jsonResponse.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "target.repo must match <owner/name>" },
    });
    assert.equal(loadCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer reuses the all-repos inbox query for the default unscoped view", async () => {
  const listCalls = [];
  const adapter = {
    async loadSnapshot(target) {
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests(options = {}) {
      listCalls.push({
        repo: options.repo,
        updatedWithinDays: options.updatedWithinDays ?? null,
        state: options.state ?? null,
        mode: options.mode ?? null,
        limit: options.limit ?? null,
      });
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Inbox PR", updatedAt: "2026-05-21T00:00:00Z" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/?repo=owner/repo&pr=55`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(listCalls, [
      {
        repo: undefined,
        updatedWithinDays: 7,
        state: "open",
        mode: "assignee",
        limit: 100,
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer normalizes unsupported assigned inbox signals before rendering", async () => {
  const adapter = {
    async listAssignedPullRequests() {
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Primary PR", updatedAt: "2026-05-21T00:00:00Z" },
        { target: { repo: "owner/repo", pr: 55 }, title: null, updatedAt: null, signal: "mystery-state" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /assigned-pr-row-unknown/);
    assert.match(response.body, /data-inbox-signal="unknown"/);
    assert.doesNotMatch(response.body, /assigned-pr-row-mystery-state/);
    assert.doesNotMatch(response.body, /data-inbox-signal="mystery-state"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer constrains repo-scoped inbox discovery to the fixed repo", async () => {
  const listCalls = [];
  const adapter = {
    async loadSnapshot(target) {
      return makeSnapshot({ target, runId: `pr-${target.pr}` });
    },
    async listAssignedPullRequests(options = {}) {
      listCalls.push({
        repo: options.repo ?? null,
        updatedWithinDays: options.updatedWithinDays ?? null,
        state: options.state ?? null,
        mode: options.mode ?? null,
        limit: options.limit ?? null,
      });
      return [
        { target: { repo: "owner/repo", pr: 55 }, title: "Scoped PR", updatedAt: "2026-05-21T00:00:00Z" },
      ];
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(listCalls, [
      {
        repo: "owner/repo",
        updatedWithinDays: 7,
        state: "open",
        mode: "assignee",
        limit: 100,
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer returns JSON for malformed /snapshot.json repo/pr query params", async () => {
  const adapter = {
    async loadSnapshot() {
      throw new Error("should not load snapshot for malformed targets");
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json?repo=other/repo&pr=77`);

    assert.equal(response.statusCode, 400);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "repo query param must match the repo-scoped viewer" },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer treats malformed repo/pr query params as bad requests", async () => {
  const adapter = {
    async loadSnapshot() {
      throw new Error("should not load snapshot for malformed targets");
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/?repo=other/repo&pr=77`);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body, "Bad Request");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer guards malformed request URLs and undefined snapshots", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return undefined;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Snapshot unavailable/);
    assert.match(response.body, /href="\/snapshot\.json\?repo=owner%2Frepo&amp;pr=55"/);
    assert.equal(loadCount, 1);

    const malformedResponse = await new Promise((resolve) => {
      const fakeRequest = Object.defineProperty({}, "url", {
        enumerable: true,
        get() {
          throw new Error("URI malformed");
        },
      });
      const result = {
        statusCode: undefined,
        headers: {},
        body: "",
      };
      const fakeResponse = {
        statusCode: undefined,
        setHeader(name, value) {
          result.headers[name] = value;
        },
        end(body = "") {
          result.statusCode = this.statusCode;
          result.body = String(body);
          resolve(result);
        },
      };

      server.emit("request", fakeRequest, fakeResponse);
    });

    assert.equal(malformedResponse.statusCode, 400);
    assert.equal(malformedResponse.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(malformedResponse.headers["cache-control"], "no-store");
    assert.equal(malformedResponse.body, "Bad Request");
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runCli explains missing lsof when --restart is requested", async () => {
  await assert.rejects(
    () => runCli([
      "--repo",
      "owner/repo",
      "--restart",
    ], {
      stdout: { write() {} },
      restartExistingPortListenerImpl: async () => {
        const error = new Error("spawn lsof ENOENT");
        error.code = "ENOENT";
        error.path = "lsof";
        throw error;
      },
    }),
    (error) => {
      assert.match(error.message, /--restart requires lsof\/POSIX support/i);
      assert.equal(typeof error.usage, "string");
      assert.match(error.usage, /--restart/);
      return true;
    },
  );
});

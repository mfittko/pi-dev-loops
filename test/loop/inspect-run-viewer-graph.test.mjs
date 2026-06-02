import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInspectionMermaidGraph,
  loadMermaidBrowserScript,
  renderInspectRunViewerHtml,
  resetMermaidBrowserScriptCache,
} from "../../scripts/loop/inspect-run-viewer.mjs";
import {
  STATE as COPILOT_STATE,
  TRANSITIONS as COPILOT_TRANSITIONS,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  OUTER_STATE,
  OUTER_TRANSITIONS,
} from "../../packages/core/src/loop/conductor-routing.mjs";
import {
  REVIEWER_STATE,
  REVIEWER_TRANSITIONS,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";
import { resolveMermaidBrowserAssetPath } from "../../scripts/loop/inspect-run-viewer/constants.mjs";
import { makeSnapshot } from "./inspect-run-viewer-test-helpers.mjs";
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

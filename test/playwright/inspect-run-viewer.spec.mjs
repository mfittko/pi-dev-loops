import { test, expect } from "@playwright/test";

import { createInspectRunViewerServer } from "../../scripts/loop/inspect-run-viewer.mjs";
import { captureNamedUiState, startFixtureServer, stopFixtureServer } from "./harness/webkit-smoke-harness.mjs";
import { makeInspectionSnapshot } from "./fixtures/inspect-run-viewer-fixture.mjs";

async function startViewer(snapshot = makeInspectionSnapshot(), assignedPullRequests = []) {
  const normalizedAssignedPullRequests = assignedPullRequests.some((entry) => entry?.target?.repo === "owner/repo" && entry?.target?.pr === 55)
    ? assignedPullRequests
    : [{ target: { repo: "owner/repo", pr: 55 }, title: "Current PR" }, ...assignedPullRequests];

  return startFixtureServer(() => createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    {
      adapter: {
        async loadSnapshot() {
          return snapshot;
        },
        async loadHandoffEnvelope() {
          return {
            handoffVersion: 1,
            derivedAt: new Date().toISOString(),
            target: { kind: "pr", repo: "owner/repo", pr: 55 },
            currentGate: "draft",
            currentHeadSha: "abc1234",
            ciStatus: "success",
            unresolvedThreadCount: 0,
            copilotRoundCount: 0,
            maxCopilotRounds: 5,
            executionMode: "bounded_handoff",
            nextAction: "Run draft gate review",
            requiredReads: ["skills/docs/gate-review-comment-contract.md"],
            gateConfig: { angles: ["scope", "coverage"], blockCleanOnFindingSeverities: ["must-fix"], requireCi: true },
            stopRules: ["draft-pr", "merge"],
            asyncStartMode: "required",
            requireDraftFirst: true,
            cwd: "/tmp/worktrees/pr-55",
            worktreeRequired: true,
            acceptance: { criteria: [{ id: "ac", must: "Test", severity: "required" }], evidence: ["commands-run"], maxFinalizationTurns: 4 },
            control: { needsAttentionAfterMs: 300000, activeNoticeAfterMs: 300000 },
          };
        },
        async listAssignedPullRequests() {
          return normalizedAssignedPullRequests;
        },
      },
    },
  ));
}

async function waitForMermaidGraph(page) {
  const graph = page.locator(".mermaid-state-graph");
  await expect(graph).toHaveAttribute("data-rendered", "true");
  await expect(graph.locator("svg")).toBeVisible();
  return graph;
}

test("webkit renders the Mermaid-first inspect-run viewer and captures a screenshot", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot(), [
    { target: { repo: "other/repo", pr: 77 }, title: "Waiting PR", signal: "attention" },
    ...Array.from({ length: 26 }, (_, index) => ({
      target: { repo: `other/repo-${index + 1}`, pr: 200 + index },
      title: `Extra PR ${index + 1}`,
      signal: "waiting",
    })),
  ]);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "PR #55" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current PR" })).toBeVisible();
    const currentStateBanner = page.locator('section[aria-label="PR #55"]');
    await expect(currentStateBanner).toBeVisible();
    await expect(currentStateBanner.getByTitle("Waiting state")).toBeVisible();
    await expect(currentStateBanner.getByText("Waiting for Copilot review")).toBeVisible();
    await expect(page.locator("body")).toContainText(/These fields are shown directly from the loaded inspection snapshot/i);
    await expect(page.locator(".state-graph-intro")).toHaveCount(0);
    await expect(page.locator(".state-graph-cues")).toContainText(/Start/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Current/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Next/);
    await expect(page.locator(".state-graph-cues")).toContainText(/End/);
    await expect(page.locator(".state-graph-cues")).toContainText(/🔁/);
    const sidebar = page.locator(".assigned-pr-inbox");
    await expect(page.getByRole("heading", { name: "PR inspection dashboard" })).toBeVisible();
    await expect(page.getByLabel("Assignment mode")).toBeVisible();
    await expect(page.getByLabel("Updated window")).toBeVisible();
    const sidebarToggle = page.locator("[data-inbox-toggle]");
    await expect(sidebarToggle).toHaveText("◀");
    await sidebarToggle.click();
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "true");
    await expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebarToggle).toHaveText("▶");
    await sidebarToggle.click();
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");

    await expect(page.locator('.assigned-pr-title-indicator')).toHaveCount(0);
    const paginationAfterList = await page.locator('.assigned-pr-inbox').evaluate((node) => {
      const list = node.querySelector('.assigned-pr-list');
      const pagination = node.querySelector('.assigned-pr-pagination');
      return Boolean(list && pagination && (list.compareDocumentPosition(pagination) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(paginationAfterList).toBeTruthy();

    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page.locator('.assigned-pr-page-status')).toHaveText('2/2');
    await expect(page.getByRole('heading', { name: 'Current PR' })).toBeVisible();
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
    await page.getByRole('link', { name: 'Previous page' }).click();
    await expect(page.locator('.assigned-pr-page-status')).toHaveText('1/2');

    const inboxSearch = page.locator("[data-inbox-search]");
    const inboxList = page.locator('.assigned-pr-list');
    await inboxSearch.fill("other/repo");
    await expect(inboxList.getByRole("link", { name: /Waiting PR/ })).toBeVisible();
    await expect(inboxList.getByRole("link", { name: /Current PR/ })).toBeHidden();
    await inboxSearch.fill("no matches here");
    await expect(page.locator("[data-inbox-empty]")).toBeVisible();
    await inboxSearch.fill("");
    await expect(page.locator("[data-inbox-empty]")).toBeHidden();
    await expect(inboxList.getByRole("link", { name: /Current PR/ })).toBeVisible();

    const graphGuide = page.getByText(/Graph guide and lane details/);
    await expect(graphGuide).toBeVisible();
    await graphGuide.click();
    const graphBox = page.locator(".current-pr-state-visualization");
    await expect(graphBox.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Zoom out" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Reset zoom" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Open graph fullscreen" })).toBeVisible();
    const graph = await waitForMermaidGraph(page);
    await expect(graphBox.locator('[data-graph-zoom-value]')).toHaveText('300%');
    await expect(graph).toHaveCSS("cursor", "grab");
    await expect(graph).toContainText(/Start/);
    await expect(graph).toContainText(/continue current wait/);
    await expect(graph).toContainText(/waiting_for_copilot_review/);
    await expect(graph).toContainText(/review_requested/);
    await expect(page.getByText(/outer-loop family:\s*current\s*continue_current_wait; continue_current_wait; full authoritative state machine shown; continue_current_wait, handoff_to_copilot_loop, handoff_to_reviewer_loop, stay_with_current_live_owner, stop_needs_human, done_terminal, needs_reconcile/i)).toBeVisible();
    await expect(page.getByText(/copilot layer:\s*current\s*waiting_for_copilot_review; waiting_for_copilot_review; full authoritative state machine shown; unresolved_feedback_present, ready_to_rerequest_review, waiting_for_ci/i)).toBeVisible();

    await graphBox.getByRole("button", { name: "Zoom in" }).click();
    await graphBox.getByRole("button", { name: "Zoom in" }).click();
    const scroller = page.locator(".mermaid-state-graph");
    const scrollRoom = await scroller.evaluate((node) => ({
      maxLeft: Math.max(0, node.scrollWidth - node.clientWidth),
      maxTop: Math.max(0, node.scrollHeight - node.clientHeight),
    }));
    expect(scrollRoom.maxLeft > 0 || scrollRoom.maxTop > 0).toBeTruthy();
    await scroller.evaluate((node) => {
      node.scrollLeft = 0;
      node.scrollTop = 0;
    });
    const beforeScroll = await scroller.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    // Dispatch pointer events directly to bypass Playwright mouse routing
    // issues with the nested zoom wrapper in WebKit.
    await scroller.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.7;
      const startY = rect.top + rect.height * 0.5;
      const endX = rect.left + rect.width * 0.3;
      const endY = rect.top + rect.height * 0.5;
      node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: startX, clientY: startY }));
      node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: endX, clientY: endY }));
      node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: endX, clientY: endY }));
    });
    const afterScroll = await scroller.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    expect(afterScroll.left !== beforeScroll.left || afterScroll.top !== beforeScroll.top).toBeTruthy();

    await graphBox.getByRole("button", { name: "Reset zoom" }).click();
    await expect(graphBox.locator("[data-graph-zoom-value]")).toHaveText("100%");
    await scroller.evaluate((node) => {
      node.scrollLeft = 0;
      node.scrollTop = 0;
    });
    await scroller.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const clientX = rect.left + (rect.width * 0.8);
      const clientY = rect.top + (rect.height * 0.75);
      node.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }));
    });
    await expect(graphBox.locator("[data-graph-zoom-value]")).toHaveText("125%");

    await page.locator(".inspection-details").first().locator("summary").click();
    await expect(page.getByRole("link", { name: /\/snapshot\.json\?repo=owner%2Frepo&pr=55/ })).toBeVisible();

    await captureNamedUiState({
      page,
      testInfo,
      sliceId: "inspect-run-viewer",
      stateName: "Current PR dashboard",
      metadata: {
        fixture: "makeInspectionSnapshot",
        route: "/",
        reviewHint: "Use this state for the reusable dashboard smoke baseline.",
      },
    });
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit shows checkpoint-only graph uncertainty without guessing missing transitions", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot({
    sourceMode: "checkpoint-only",
    trust: "checkpoint",
    needsAttention: true,
    statusClass: "unknown",
    outerState: "unknown",
    allowedTransitions: undefined,
    outerAction: "unknown",
    layers: {
      steering: { status: "unavailable", reason: "no_steering_file" },
    },
  }));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Current PR" })).toBeVisible();
    await expect(page.locator(".current-pr-state-summary-headline")).toContainText(/Needs attention/);
    await expect(page.locator(".current-pr-state-detail").last()).toContainText(/checkpoint-only snapshot/i);
    await expect(page.locator(".state-graph-intro")).toHaveCount(0);
    await page.getByText(/Graph guide and lane details/).click();
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/current state unavailable/);
    await expect(page.getByText(/copilot layer:\s*current\s*current state unavailable; current state unavailable; full authoritative state machine shown; transition data unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/reviewer layer:\s*current\s*current state unavailable; current state unavailable; full authoritative state machine shown; transition data unavailable in this snapshot/i)).toBeVisible();

    await captureNamedUiState({
      page,
      testInfo,
      sliceId: "inspect-run-viewer",
      stateName: "Checkpoint only graph uncertainty",
      metadata: {
        fixture: "makeInspectionSnapshot",
        route: "/",
        reviewHint: "Confirms the harness can capture an uncertainty state without inferred transitions.",
      },
    });
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit shows degraded graph messaging when snapshot trust is partial", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot({
    sourceMode: "partial",
    trust: "degraded",
  }));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".state-graph-intro")).toHaveCount(0);
    await waitForMermaidGraph(page);

    await captureNamedUiState({
      page,
      testInfo,
      sliceId: "inspect-run-viewer",
      stateName: "Degraded graph messaging",
      metadata: {
        fixture: "makeInspectionSnapshot",
        route: "/",
        reviewHint: "Demonstrates the partial-trust path for reusable smoke coverage.",
      },
    });
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit shows terminal merged states clearly in the Mermaid graph", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot({
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

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const currentStateBanner = page.locator('section[aria-label="PR #55"]');
    await expect(currentStateBanner.getByRole("heading", { name: "Current PR" })).toBeVisible();
    await expect(currentStateBanner.getByText("PR complete")).toBeVisible();
    await expect(page.locator(".current-pr-state-grid")).toContainText(/status class/);
    await expect(page.locator(".current-pr-state-grid")).toContainText(/done/);
    await page.getByText(/Graph guide and lane details/).click();
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/End/);
    await expect(graph).toContainText(/done/);
    await expect(page.getByText(/copilot layer:\s*current\s*done; done; full authoritative state machine shown; no allowed transitions/i)).toBeVisible();

    await captureNamedUiState({
      page,
      testInfo,
      sliceId: "inspect-run-viewer",
      stateName: "Terminal merged state",
      metadata: {
        fixture: "makeInspectionSnapshot",
        route: "/",
        reviewHint: "Confirms the terminal merged state remains reviewable in WebKit.",
      },
    });
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit shows the unavailable-state fallback for unavailable snapshots", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot({
    sourceMode: "unavailable",
    trust: "unknown",
    activeFamilyState: "unknown",
    layers: {
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
  }));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".mermaid-state-graph")).toHaveCount(0);
    await expect(page.getByText(/Snapshot unavailable, so no state graph can be rendered yet/i)).toBeVisible();

    await captureNamedUiState({
      page,
      testInfo,
      sliceId: "inspect-run-viewer",
      stateName: "Unavailable snapshot fallback",
      metadata: {
        fixture: "makeInspectionSnapshot",
        route: "/",
        reviewHint: "Captures the no-graph fallback for unavailable snapshots.",
      },
    });
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit renders the Agent handoff tab and validates unavailable-state fallback", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(makeInspectionSnapshot());

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Tab navigation is visible
    const handoffTab = page.locator('.viewer-tab[data-tab="handoff"]');
    await expect(handoffTab).toBeVisible();
    await expect(handoffTab).toHaveText("Agent handoff");

    // Live view tab is visible and active by default
    const liveTab = page.locator('.viewer-tab[data-tab="live"]');
    await expect(liveTab).toBeVisible();
    await expect(liveTab).toHaveClass(/active/);

    // Handoff tab content is present (may show "Envelope unavailable" if resolver unavailable)
    await handoffTab.click();
    await expect(handoffTab).toHaveClass(/active/);
    await expect(liveTab).not.toHaveClass(/active/);

    // Handoff content section is visible
    const handoffSection = page.locator("#handoff-envelope-section");
    await expect(handoffSection).toBeVisible();

    // Verify envelope content renders with key fields
    await expect(handoffSection).toContainText(/Agent handoff/);
    await expect(handoffSection).not.toContainText(/Envelope unavailable/);
    await expect(handoffSection).toContainText(/Target/);
    await expect(handoffSection).toContainText(/Current state/);
    await expect(page.locator("#handoff-envelope-section dt:has-text('currentGate') + dd")).toHaveText("draft");
    await expect(handoffSection).toContainText(/Policy/);
    await expect(handoffSection).toContainText(/Acceptance/);

    // Switch back to live view
    await liveTab.click();
    await expect(liveTab).toHaveClass(/active/);
  } finally {
    await stopFixtureServer(server);
  }
});

test("webkit renders envelope unavailable fallback when adapter has no loadHandoffEnvelope", async ({ page }) => {
  const { server, url } = await startFixtureServer(() => createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    {
      adapter: {
        async loadSnapshot() {
          return makeInspectionSnapshot();
        },
        // no loadHandoffEnvelope — exercises the unavailable fallback path
        async listAssignedPullRequests() {
          return [{ target: { repo: "owner/repo", pr: 55 }, title: "Current PR" }];
        },
      },
    },
  ));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const handoffTab = page.locator('.viewer-tab[data-tab="handoff"]');
    await handoffTab.click();

    const handoffSection = page.locator("#handoff-envelope-section");
    await expect(handoffSection).toBeVisible();
    await expect(handoffSection).toContainText(/Envelope unavailable/);
    await expect(handoffSection).toContainText(/buildDevLoopHandoffEnvelope/);
  } finally {
    await stopFixtureServer(server);
  }
});

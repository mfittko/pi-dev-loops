import { once } from "node:events";

import { test, expect } from "@playwright/test";

import { createInspectRunViewerServer } from "../../scripts/loop/inspect-run-viewer.mjs";
import { makeInspectionSnapshot } from "./fixtures/inspect-run-viewer-fixture.mjs";

async function startViewer(snapshot = makeInspectionSnapshot()) {
  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    {
      adapter: {
        async loadSnapshot() {
          return snapshot;
        },
      },
    },
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function waitForMermaidGraph(page) {
  const graph = page.locator(".mermaid-state-graph");
  await expect(graph).toHaveAttribute("data-rendered", "true");
  await expect(graph.locator("svg")).toBeVisible();
  return graph;
}

test("webkit renders the Mermaid-first inspect-run viewer and captures a screenshot", async ({ page }, testInfo) => {
  const { server, url } = await startViewer();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "PR #55 State" })).toBeVisible();
    await expect(page.getByLabel("PR #55 State").getByText("Waiting for Copilot review")).toBeVisible();
    await expect(page.locator("body")).toContainText(/These fields are shown directly from the loaded inspection snapshot/i);
    await expect(page.locator(".state-graph-intro")).toHaveCount(0);
    await expect(page.locator(".state-graph-cues")).toContainText(/Start/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Current/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Next/);
    await expect(page.locator(".state-graph-cues")).toContainText(/End/);
    await expect(page.locator(".state-graph-cues")).toContainText(/🔁/);
    const graphGuide = page.getByText(/Graph guide and lane details/);
    await expect(graphGuide).toBeVisible();
    await graphGuide.click();
    const graphBox = page.locator(".current-pr-state-visualization");
    await expect(graphBox.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Zoom out" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Reset zoom" })).toBeVisible();
    await expect(graphBox.getByRole("button", { name: "Open graph fullscreen" })).toBeVisible();
    const graph = await waitForMermaidGraph(page);
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
    const beforeScroll = await scroller.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    const box = await scroller.boundingBox();
    if (!box) throw new Error("graph scroller bounding box unavailable");
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 8 });
    await page.mouse.up();
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

    await page.locator(".inspection-details > summary").click();
    await expect(page.getByRole("link", { name: /\/snapshot\.json\?repo=owner%2Frepo&pr=55/ })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

    await expect(page.getByRole("heading", { name: "PR #55 State" })).toBeVisible();
    await expect(page.locator(".current-pr-state-summary-headline")).toContainText(/Needs attention/);
    await expect(page.locator(".current-pr-state-detail").last()).toContainText(/checkpoint-only snapshot/i);
    await expect(page.locator(".state-graph-intro")).toHaveCount(0);
    await page.getByText(/Graph guide and lane details/).click();
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/current state unavailable/);
    await expect(page.getByText(/copilot layer:\s*current\s*current state unavailable; current state unavailable; full authoritative state machine shown; transition data unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/reviewer layer:\s*current\s*current state unavailable; current state unavailable; full authoritative state machine shown; transition data unavailable in this snapshot/i)).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-checkpoint-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-degraded-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

    await expect(page.getByRole("heading", { name: "PR #55 State" })).toBeVisible();
    await expect(page.getByLabel("PR #55 State").getByText("PR complete")).toBeVisible();
    await expect(page.locator(".current-pr-state-grid")).toContainText(/status class/);
    await expect(page.locator(".current-pr-state-grid")).toContainText(/done/);
    await page.getByText(/Graph guide and lane details/).click();
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/End/);
    await expect(graph).toContainText(/done/);
    await expect(page.getByText(/copilot layer:\s*current\s*done; done; full authoritative state machine shown; no allowed transitions/i)).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-merged-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-unavailable-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

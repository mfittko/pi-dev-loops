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

    await expect(page.getByRole("heading", { name: "PR #55 inspection" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "State visualization" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current PR state" })).toBeVisible();
    await expect(page.locator("body")).toContainText(/These fields are shown directly from the loaded inspection snapshot/i);
    await expect(page.locator(".state-graph-intro")).toContainText(/full authoritative copilot and reviewer state machines/i);
    await expect(page.locator(".state-graph-cues")).toContainText(/Start/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Current/);
    await expect(page.locator(".state-graph-cues")).toContainText(/Next/);
    await expect(page.locator(".state-graph-cues")).toContainText(/End/);
    await expect(page.locator(".state-graph-cues")).toContainText(/🔁/);
    await expect(page.locator(".state-graph-help")).toContainText(/Dimmed nodes are still part of the authoritative state machine/i);
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/Start/);
    await expect(graph).toContainText(/continue_wait/);
    await expect(graph).toContainText(/waiting_for_copilot_review/);
    await expect(graph).toContainText(/review_requested/);
    await expect(page.getByText(/outer-loop family:\s*current\s*continue_wait; known outer actions shown, but authoritative full transitions are not exported; transition data unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/copilot layer:\s*current\s*waiting_for_copilot_review; full authoritative state machine shown; validated next states: unresolved_feedback_present, ready_to_rerequest_review, waiting_for_ci/i)).toBeVisible();
    await expect(page.locator('a[href="/snapshot.json"]')).toBeVisible();

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
    layers: {
      steering: { status: "unavailable", reason: "no_steering_file" },
    },
  }));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Current PR state" })).toBeVisible();
    await expect(page.locator(".current-pr-state-detail")).toContainText(/checkpoint-only snapshot/i);
    await expect(page.locator(".state-graph-intro")).toContainText(/checkpoint-only inspection snapshot/i);
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/current state unavailable/);
    await expect(page.getByText(/copilot layer:\s*current\s*current state unavailable; full authoritative state machine shown; next transitions unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/reviewer layer:\s*current\s*current state unavailable; full authoritative state machine shown; next transitions unavailable in this snapshot/i)).toBeVisible();

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

    await expect(page.locator(".state-graph-intro")).toContainText(/degraded inspection snapshot/i);
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

    await expect(page.getByRole("heading", { name: "Current PR state" })).toBeVisible();
    await expect(page.locator(".current-pr-state-grid")).toContainText(/status class/);
    await expect(page.locator(".current-pr-state-grid")).toContainText(/done/);
    const graph = await waitForMermaidGraph(page);
    await expect(graph).toContainText(/End/);
    await expect(graph).toContainText(/done/);
    await expect(page.getByText(/copilot layer:\s*current\s*done; full authoritative state machine shown; no allowed transitions/i)).toBeVisible();

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

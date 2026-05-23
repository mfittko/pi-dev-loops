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

test("webkit renders the state-graph-first inspect-run viewer and captures a screenshot", async ({ page }, testInfo) => {
  const { server, url } = await startViewer();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "PR #55 inspection" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "State visualization" })).toBeVisible();
    await expect(page.locator(".state-graph-intro")).toContainText(/authoritative inspection snapshot/i);
    await expect(page.locator(".state-map-legend")).toContainText(/Start/);
    await expect(page.locator(".state-map-legend")).toContainText(/End/);
    await expect(page.locator(".state-map-legend")).toContainText(/🔁/);
    await expect(page.locator(".state-map-svg")).toBeVisible();
    await expect(page.locator(".state-map-lane-label")).toHaveCount(3);
    await expect(page.locator(".state-map-node-current")).toHaveCount(3);
    await expect(page.getByText(/outer-loop family:\s*current\s*continue_wait; transition data unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/copilot layer:\s*current\s*waiting_for_copilot_review; unresolved_feedback_present, ready_to_rerequest_review, waiting_for_ci/i)).toBeVisible();
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

    await expect(page.locator(".state-graph-intro")).toContainText(/checkpoint-only inspection snapshot/i);
    await expect(page.locator(".state-map-svg")).toBeVisible();
    await expect(page.getByText(/copilot layer:\s*current\s*current state unavailable; transition data unavailable in this snapshot/i)).toBeVisible();
    await expect(page.getByText(/reviewer layer:\s*current\s*current state unavailable; transition data unavailable in this snapshot/i)).toBeVisible();

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
    await expect(page.locator(".state-map-svg")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-degraded-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("webkit shows terminal merged states clearly in the map", async ({ page }, testInfo) => {
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

    await expect(page.locator(".state-map-node-terminal")).toHaveCount(2);
    await expect(page.getByText(/copilot layer:\s*current\s*done; no allowed transitions/i)).toBeVisible();

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

    await expect(page.locator(".state-map-svg")).toHaveCount(0);
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

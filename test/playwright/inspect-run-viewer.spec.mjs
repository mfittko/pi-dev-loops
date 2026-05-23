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
    await expect(page.locator(".state-graph-card")).toHaveCount(3);
    await expect(page.locator(".state-graph-card").nth(0)).toContainText("outer-loop family");
    await expect(page.locator(".state-graph-card").nth(1)).toContainText("waiting_for_copilot_review");
    await expect(page.locator(".state-graph-card").nth(2)).toContainText("waiting_for_author_followup");
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

test("webkit shows the unavailable-state fallback when no snapshot is present", async ({ page }, testInfo) => {
  const { server, url } = await startViewer(null);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
    await expect(page.getByText(/no state graph can be rendered yet/i)).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("inspect-run-viewer-unavailable-webkit.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/playwright",
  testMatch: ["inspect-run-viewer.spec.mjs"],
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  outputDir: "test-results/playwright",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/inspect-run-viewer" }]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "webkit",
      use: {
        browserName: "webkit",
      },
    },
  ],
});

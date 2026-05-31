import { defineConfig } from "@playwright/test";

import { createWebkitSmokeConfig } from "./test/playwright/harness/webkit-smoke-harness.mjs";

export default defineConfig(createWebkitSmokeConfig({
  sliceId: "inspect-run-viewer",
  testMatch: ["inspect-run-viewer.spec.mjs"],
}));

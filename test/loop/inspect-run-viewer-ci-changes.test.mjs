import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  classifyInspectRunViewerCiChanges,
  isInspectRunViewerRelevantPath,
  runCli,
} from "../../scripts/loop/inspect-run-viewer-ci-changes.mjs";

test("isInspectRunViewerRelevantPath matches the bounded inspect-run viewer smoke surface", () => {
  assert.equal(isInspectRunViewerRelevantPath(".github/workflows/ci.yml"), true);
  assert.equal(isInspectRunViewerRelevantPath("package.json"), true);
  assert.equal(isInspectRunViewerRelevantPath("scripts/loop/inspect-run-viewer/rendering.mjs"), true);
  assert.equal(isInspectRunViewerRelevantPath("scripts/loop/inspect-run-viewer-ci-changes.mjs"), true);
  assert.equal(isInspectRunViewerRelevantPath("test/playwright/inspect-run-viewer.spec.mjs"), true);
  assert.equal(isInspectRunViewerRelevantPath("test/playwright/some-other-ui.spec.mjs"), false);

  assert.equal(isInspectRunViewerRelevantPath("README.md"), false);
  assert.equal(isInspectRunViewerRelevantPath("docs/index.md"), false);
  assert.equal(isInspectRunViewerRelevantPath("test/loop/inspect-run-viewer.test.mjs"), false);
});

test("classifyInspectRunViewerCiChanges only requests browser smoke when relevant paths changed", () => {
  const relevant = classifyInspectRunViewerCiChanges([
    "README.md",
    "scripts/loop/inspect-run-viewer/server.mjs",
    "docs/index.md",
  ]);
  assert.equal(relevant.shouldRun, true);
  assert.deepEqual(relevant.relevantPaths, ["scripts/loop/inspect-run-viewer/server.mjs"]);
  const irrelevant = classifyInspectRunViewerCiChanges([
    "README.md",
    "docs/IMPLEMENTATION_WORKFLOW.md",
  ]);
  assert.equal(irrelevant.shouldRun, false);
  assert.deepEqual(irrelevant.relevantPaths, []);
});

test("runCli emits github output entries for inspect-run viewer smoke gating", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inspect-run-viewer-ci-changes-"));
  const pathsFile = path.join(tempDir, "changed-files.txt");
  const githubOutputFile = path.join(tempDir, "github-output.txt");
  const writes = [];

  try {
    await writeFile(pathsFile, [
      "README.md",
      "playwright.inspect-run-viewer.config.mjs",
    ].join("\n"), "utf8");

    const result = await runCli([
      pathsFile,
    ], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: githubOutputFile,
      },
      stdout: {
        write(chunk) {
          writes.push(String(chunk));
        },
      },
    });

    assert.equal(result.shouldRun, true);
    assert.deepEqual(result.relevantPaths, ["playwright.inspect-run-viewer.config.mjs"]);

    const payload = JSON.parse(writes.join(""));
    assert.equal(payload.ok, true);
    assert.equal(payload.shouldRun, true);

    const githubOutput = await readFile(githubOutputFile, "utf8");
    assert.match(githubOutput, /^inspect_run_viewer=true$/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initializePhase, parseCliArgs } from "../skills/dev-loop/scripts/init-phase.mjs";

test("init-phase parses cli args via the shared phase-file parser", () => {
  assert.deepEqual(
    parseCliArgs(["--project-root", "/repo", "--phase", "phase-2", "--patch", '{"status":"planning"}']),
    {
      projectRoot: "/repo",
      phase: "phase-2",
      patch: { status: "planning" },
    },
  );
});

test("init-phase materializes DoD-enabled planning artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-init-phase-"));
  const skillDir = path.join(tempDir, ".pi", "skills", "dev-loop");

  try {
    await rm(skillDir, { recursive: true, force: true });
    await initializePhase(tempDir, "phase-2", {
      status: "planning",
      notes: ["created by root smoke test"],
    });

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "manifest.json"), "utf8"),
    );
    const phaseDoc = await readFile(path.join(tempDir, "docs", "phases", "phase-2.md"), "utf8");
    const variantA = await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "variant-a.md"), "utf8");
    const mergedPlan = await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "merged-plan.md"), "utf8");
    const review = await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "review.md"), "utf8");

    assert.equal(manifest.status, "planning");
    assert.deepEqual(manifest.artifacts, [
      "../../../docs/phases/phase-2.md",
      "manifest.json",
      "merged-plan.md",
      "review.md",
      "variant-a.md",
      "variant-b.md",
    ]);
    assert.match(phaseDoc, /# phase-2 durable plan/);
    assert.match(phaseDoc, /## Definition of done/);
    assert.match(variantA, /# Phase phase-2 variant a/);
    assert.match(mergedPlan, /# Phase phase-2 merged plan/);
    assert.match(mergedPlan, /## Definition of done/);
    assert.match(review, /## Definition-of-done clarity check/);
    assert.match(review, /review-surface completeness/);
    assert.match(review, /RFC-escalation sanity/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

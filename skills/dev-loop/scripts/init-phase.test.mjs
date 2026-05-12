import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initializePhase, parseCliArgs } from "./init-phase.mjs";

describe("init-phase helper", () => {
  test("parses cli args via the shared phase-file parser", () => {
    expect(parseCliArgs(["--project-root", "/repo", "--phase", "phase-2", "--patch", '{"status":"planning"}']))
      .toEqual({
        projectRoot: "/repo",
        phase: "phase-2",
        patch: { status: "planning" },
      });
  });

  test("initializes manifest, index, and template files for a phase", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-init-phase-"));
    const skillDir = path.join(tempDir, ".pi", "skills", "dev-loop");

    try {
      await rm(skillDir, { recursive: true, force: true });
      await initializePhase(tempDir, "phase-2", {
        status: "planning",
        notes: ["created by test"],
      });

      const manifest = JSON.parse(
        await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "manifest.json"), "utf8"),
      );
      const variantA = await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "variant-a.md"), "utf8");
      const mergedPlan = await readFile(path.join(tempDir, "tmp", "phases", "phase-2", "merged-plan.md"), "utf8");

      expect(manifest.status).toBe("planning");
      expect(manifest.artifacts).toEqual([
        "manifest.json",
        "merged-plan.md",
        "review.md",
        "variant-a.md",
        "variant-b.md",
        "variant-c.md",
      ]);
      expect(variantA).toContain("# Phase phase-2 variant a");
      expect(mergedPlan).toContain("# Phase phase-2 merged plan");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

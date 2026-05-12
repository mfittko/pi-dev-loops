import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectDevModeContext,
  parseCliArgs,
  parseJsonLines,
  writeDevModeContext,
} from "./dev-mode-context.mjs";

describe("dev-mode-context helper", () => {
  test("parses json lines deterministically", () => {
    expect(parseJsonLines('{"command":"npm test"}\n{"command":"npm run check"}\n')).toEqual([
      { command: "npm test" },
      { command: "npm run check" },
    ]);
    expect(parseJsonLines("")).toEqual([]);
  });

  test("collects context for an existing phase directory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-dev-mode-"));
    const phaseDir = path.join(tempDir, "tmp", "phases", "phase-3");

    try {
      await mkdir(phaseDir, { recursive: true });
      await writeFile(path.join(phaseDir, "manifest.json"), JSON.stringify({ phase: "phase-3", status: "completed" }), { encoding: "utf8", flag: "w" });
      await writeFile(path.join(phaseDir, "summary.md"), "# Summary\nline\n", { encoding: "utf8", flag: "w" });
      await writeFile(path.join(phaseDir, "retrospective.md"), "# Retro\n", { encoding: "utf8", flag: "w" });
      await writeFile(path.join(phaseDir, "review.md"), "# Review\n", { encoding: "utf8", flag: "w" });
      await writeFile(path.join(phaseDir, "merged-plan.md"), "# Plan\n", { encoding: "utf8", flag: "w" });
      await writeFile(
        path.join(phaseDir, "bash-exit-1.jsonl"),
        '{"command":"npm test","exitCode":1}\n{"command":"npm run test:coverage","exitCode":1}\n',
        { encoding: "utf8", flag: "w" },
      );

      const context = await collectDevModeContext(tempDir, "phase-3");

      expect(context.phase).toBe("phase-3");
      expect(context.manifest).toEqual({ phase: "phase-3", status: "completed" });
      expect(context.artifactPresence).toEqual({
        summary: true,
        retrospective: true,
        review: true,
        mergedPlan: true,
        bashExitOneLog: true,
      });
      expect(context.bashExitOne.count).toBe(2);
      expect(context.bashExitOne.commands).toEqual(["npm run test:coverage", "npm test"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("writes collected context to disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-dev-mode-write-"));
    const outputPath = path.join(tempDir, "dev-mode-context.json");

    try {
      await writeDevModeContext(outputPath, { phase: "phase-1", ok: true });
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written).toEqual({ phase: "phase-1", ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parses cli args", () => {
    expect(parseCliArgs(["--project-root", "/repo", "--phase", "phase-4", "--output", "tmp/x.json"]))
      .toEqual({
        projectRoot: "/repo",
        phase: "phase-4",
        output: "tmp/x.json",
      });
  });

  test("requires phase arg", () => {
    expect(() => parseCliArgs(["--output", "tmp/x.json"])) .toThrow(/missing required --phase/i);
  });
});

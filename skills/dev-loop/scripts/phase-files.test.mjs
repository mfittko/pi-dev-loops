import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyManifestPatch,
  buildPhasePaths,
  createDefaultPhaseIndex,
  createDefaultPhaseManifest,
  ensurePhaseFiles,
  normalizePhaseName,
  parseCliArgs,
  uniqueSortedStrings,
  upsertPhaseIndex,
} from "./phase-files.mjs";

describe("phase-files helper", () => {
  test("normalizes valid phase names", () => {
    expect(normalizePhaseName("phase-0")).toBe("phase-0");
    expect(() => normalizePhaseName("phase-zero")).toThrow(/phase must match/i);
  });

  test("deduplicates and sorts strings", () => {
    expect(uniqueSortedStrings(["b", "a", "b", ""])) .toEqual(["a", "b"]);
  });

  test("creates default manifest", () => {
    expect(createDefaultPhaseManifest("phase-0")).toEqual({
      phase: "phase-0",
      status: "not-started",
      startedAt: "",
      completedAt: "",
      nextPhase: "",
      validation: {
        check: "not-run",
        test: "not-run",
        coverage: "not-run",
      },
      artifacts: [],
      subagents: [],
      decisions: [],
      notes: [],
    });
  });

  test("applies manifest patch deterministically", () => {
    const manifest = createDefaultPhaseManifest("phase-0");
    const next = applyManifestPatch(manifest, {
      status: "planning",
      artifacts: ["b.md", "a.md", "b.md"],
      validation: { check: "passed" },
      notes: ["note-b", "note-a"],
    });

    expect(next).toEqual({
      ...manifest,
      status: "planning",
      artifacts: ["a.md", "b.md"],
      subagents: [],
      decisions: [],
      notes: ["note-a", "note-b"],
      validation: {
        check: "passed",
        test: "not-run",
        coverage: "not-run",
      },
    });
  });

  test("upserts a phase in the index", () => {
    const index = createDefaultPhaseIndex();
    const next = upsertPhaseIndex(index, {
      phase: "phase-1",
      status: "planning",
      manifestPath: "tmp/phases/phase-1/manifest.json",
      updatedAt: "2026-05-12T10:00:00Z",
    });

    expect(next).toEqual({
      phases: [
        {
          phase: "phase-1",
          status: "planning",
          manifestPath: "tmp/phases/phase-1/manifest.json",
          updatedAt: "2026-05-12T10:00:00Z",
        },
      ],
    });
  });

  test("builds deterministic phase paths", () => {
    const paths = buildPhasePaths("/repo", "phase-2");

    expect(paths).toEqual({
      projectRoot: "/repo",
      phasesRoot: "/repo/tmp/phases",
      phase: "phase-2",
      phaseDir: "/repo/tmp/phases/phase-2",
      manifestPath: "/repo/tmp/phases/phase-2/manifest.json",
      indexPath: "/repo/tmp/phases/index.json",
      bashExitOnePath: "/repo/tmp/phases/phase-2/bash-exit-1.jsonl",
    });
  });

  test("ensures manifest and index files on disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-phase-files-"));

    try {
      const result = await ensurePhaseFiles(tempDir, "phase-0", {
        status: "planning",
        artifacts: ["variant-a.md", "review.md"],
        notes: ["first note"],
      });

      expect(result.manifest.status).toBe("planning");
      expect(result.manifest.artifacts).toEqual(["review.md", "variant-a.md"]);
      expect(result.index.phases).toHaveLength(1);

      const manifestOnDisk = JSON.parse(await readFile(result.paths.manifestPath, "utf8"));
      const indexOnDisk = JSON.parse(await readFile(result.paths.indexPath, "utf8"));

      expect(manifestOnDisk.status).toBe("planning");
      expect(indexOnDisk.phases[0].phase).toBe("phase-0");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parses cli args", () => {
    expect(parseCliArgs(["--project-root", "/repo", "--phase", "phase-3", "--patch", '{"status":"planning"}']))
      .toEqual({
        projectRoot: "/repo",
        phase: "phase-3",
        patch: { status: "planning" },
      });
  });

  test("requires phase arg", () => {
    expect(() => parseCliArgs([])).toThrow(/missing required --phase/i);
  });
});

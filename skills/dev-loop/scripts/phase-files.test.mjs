import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as corePhaseFiles from "../../../packages/core/src/loop/phase-files.mjs";
import {
  createDefaultPhaseManifest,
  ensurePhaseFiles,
  parseCliArgs,
} from "./phase-files.mjs";

describe("phase-files wrapper", () => {
  test("re-exports the shared package implementation", () => {
    expect(createDefaultPhaseManifest).toBe(corePhaseFiles.createDefaultPhaseManifest);
    expect(ensurePhaseFiles).toBe(corePhaseFiles.ensurePhaseFiles);
    expect(parseCliArgs).toBe(corePhaseFiles.parseCliArgs);
  });

  test("continues to create manifest and index files through the shared boundary", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-phase-files-wrapper-"));

    try {
      const result = await ensurePhaseFiles(tempDir, "phase-0", {
        status: "planning",
        artifacts: ["variant-a.md", "review.md"],
      });

      const manifestOnDisk = JSON.parse(await readFile(result.paths.manifestPath, "utf8"));
      const indexOnDisk = JSON.parse(await readFile(result.paths.indexPath, "utf8"));

      expect(manifestOnDisk.artifacts).toEqual(["review.md", "variant-a.md"]);
      expect(indexOnDisk.phases[0].manifestPath).toBe("tmp/phases/phase-0/manifest.json");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

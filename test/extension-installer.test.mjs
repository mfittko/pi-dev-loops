import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";

import { resolveSystemSkillsRoot, syncPackagedSkills } from "../extension/installer.ts";

async function seedPackagedSupport(tempDir) {
  const scriptsRoot = path.join(tempDir, "scripts-source");
  const coreSourceRoot = path.join(tempDir, "core-src-source");
  const docsRoot = path.join(tempDir, "docs-source");

  await mkdir(path.join(scriptsRoot, "github"), { recursive: true });
  await mkdir(path.join(scriptsRoot, "loop"), { recursive: true });
  await mkdir(path.join(coreSourceRoot, "loop"), { recursive: true });
  await mkdir(docsRoot, { recursive: true });

  await writeFile(path.join(scriptsRoot, "_core-helpers.mjs"), "export const helper = true;\n");
  await writeFile(path.join(scriptsRoot, "README.md"), "scripts readme\n");
  await writeFile(path.join(scriptsRoot, "github", "request-copilot-review.mjs"), "#!/usr/bin/env node\n");
  await writeFile(path.join(scriptsRoot, "loop", "detect-copilot-loop-state.mjs"), "#!/usr/bin/env node\n");
  await writeFile(path.join(coreSourceRoot, "loop", "copilot-loop-state.mjs"), "export const state = true;\n");
  await writeFile(path.join(docsRoot, "copilot-loop-state-graph.md"), "copilot graph\n");
  await writeFile(path.join(docsRoot, "reviewer-loop-state-graph.md"), "reviewer graph\n");

  return { scriptsRoot, coreSourceRoot, docsRoot };
}

test("resolveSystemSkillsRoot targets ~/.pi/agent/skills", () => {
  assert.equal(resolveSystemSkillsRoot("/tmp/home"), path.join("/tmp/home", ".pi", "agent", "skills"));
});

test("install copies packaged skills and bundled copilot runtime support without overwriting existing targets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-install-"));
  const sourceRoot = path.join(tempDir, "source");
  const targetRoot = path.join(tempDir, "target");
  const { scriptsRoot, coreSourceRoot, docsRoot } = await seedPackagedSupport(tempDir);

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v1\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v1\n");

  const first = await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    sourceRoot,
    scriptsRoot,
    coreSourceRoot,
    docsRoot,
    targetRoot,
  });

  assert.deepEqual(
    first.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "installed"],
      ["copilot-dev-loop", "installed"],
    ],
  );

  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "scripts", "github", "request-copilot-review.mjs"), "utf8"),
    "#!/usr/bin/env node\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "scripts", "_core-helpers.mjs"), "utf8"),
    "export const helper = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "packages", "core", "src", "loop", "copilot-loop-state.mjs"), "utf8"),
    "export const state = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "docs", "copilot-loop-state-graph.md"), "utf8"),
    "copilot graph\n",
  );

  await writeFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "repo override\n");

  const second = await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    sourceRoot,
    scriptsRoot,
    coreSourceRoot,
    docsRoot,
    targetRoot,
  });

  assert.deepEqual(
    second.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "already-installed"],
      ["copilot-dev-loop", "already-installed"],
    ],
  );
  assert.equal(await readFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "utf8"), "repo override\n");
});

test("update refreshes existing target directories from the packaged source and skips missing targets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-update-"));
  const sourceRoot = path.join(tempDir, "source");
  const targetRoot = path.join(tempDir, "target");
  const { scriptsRoot, coreSourceRoot, docsRoot } = await seedPackagedSupport(tempDir);

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await mkdir(path.join(targetRoot, "dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v2\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v2\n");
  await writeFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "stale local copy\n");

  const result = await syncPackagedSkills({
    mode: "update",
    scope: "system",
    sourceRoot,
    scriptsRoot,
    coreSourceRoot,
    docsRoot,
    targetRoot,
  });

  assert.deepEqual(
    result.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "updated"],
      ["copilot-dev-loop", "missing"],
    ],
  );
  assert.equal(await readFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "utf8"), "dev-loop v2\n");
  await assert.rejects(readFile(path.join(targetRoot, "copilot-dev-loop", "SKILL.md"), "utf8"));
});

test("install refuses symlinked roots, symlinked ancestors, and skill targets to avoid mutating the symlink source unexpectedly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-symlink-"));
  const sourceRoot = path.join(tempDir, "source");
  const realRoot = path.join(tempDir, "real-root");
  const linkedRoot = path.join(tempDir, "linked-root");
  const { scriptsRoot, coreSourceRoot, docsRoot } = await seedPackagedSupport(tempDir);

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v1\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v1\n");

  await mkdir(realRoot, { recursive: true });
  await symlink(realRoot, linkedRoot);

  await assert.rejects(
    syncPackagedSkills({
      mode: "install",
      scope: "repo",
      sourceRoot,
      scriptsRoot,
      coreSourceRoot,
      docsRoot,
      targetRoot: linkedRoot,
    }),
    /symlinked skill root/i,
  );

  const symlinkedAncestorRoot = path.join(tempDir, "repo-root");
  const realPiRoot = path.join(tempDir, "real-pi-root");
  await mkdir(symlinkedAncestorRoot, { recursive: true });
  await mkdir(realPiRoot, { recursive: true });
  await symlink(realPiRoot, path.join(symlinkedAncestorRoot, ".pi"));

  await assert.rejects(
    syncPackagedSkills({
      mode: "install",
      scope: "repo",
      sourceRoot,
      scriptsRoot,
      coreSourceRoot,
      docsRoot,
      targetRoot: path.join(symlinkedAncestorRoot, ".pi", "skills"),
    }),
    /Ancestor path is a symlink/i,
  );

  await mkdir(path.join(realPiRoot, "skills"), { recursive: true });

  await assert.rejects(
    syncPackagedSkills({
      mode: "update",
      scope: "repo",
      sourceRoot,
      scriptsRoot,
      coreSourceRoot,
      docsRoot,
      targetRoot: path.join(symlinkedAncestorRoot, ".pi", "skills"),
    }),
    /Ancestor path is a symlink/i,
  );

  const realRepoRoot = path.join(tempDir, "real-repo-root");
  const linkedRepoRoot = path.join(tempDir, "linked-repo-root");
  await mkdir(path.join(realRepoRoot, ".pi"), { recursive: true });
  await symlink(realRepoRoot, linkedRepoRoot);

  await assert.rejects(
    syncPackagedSkills({
      mode: "install",
      scope: "repo",
      sourceRoot,
      scriptsRoot,
      coreSourceRoot,
      docsRoot,
      targetRoot: path.join(linkedRepoRoot, ".pi", "skills"),
    }),
    /Ancestor path is a symlink/i,
  );

  const targetRoot = path.join(tempDir, "target");
  await mkdir(path.join(targetRoot, "copilot-dev-loop"), { recursive: true });
  await symlink(path.join(targetRoot, "copilot-dev-loop"), path.join(targetRoot, "dev-loop"));

  await assert.rejects(
    syncPackagedSkills({
      mode: "update",
      scope: "repo",
      sourceRoot,
      scriptsRoot,
      coreSourceRoot,
      docsRoot,
      targetRoot,
    }),
    /symlinked skill target/i,
  );
});

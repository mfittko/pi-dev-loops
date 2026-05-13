import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";

import { resolveSystemSkillsRoot, syncPackagedSkills } from "../extension/installer.ts";

test("resolveSystemSkillsRoot targets ~/.pi/agent/skills", () => {
  assert.equal(resolveSystemSkillsRoot("/tmp/home"), path.join("/tmp/home", ".pi", "agent", "skills"));
});

test("install copies packaged skills without overwriting existing targets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-install-"));
  const sourceRoot = path.join(tempDir, "source");
  const targetRoot = path.join(tempDir, "target");

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v1\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v1\n");

  const first = await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    sourceRoot,
    targetRoot,
  });

  assert.deepEqual(
    first.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "installed"],
      ["copilot-dev-loop", "installed"],
    ],
  );

  await writeFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "repo override\n");

  const second = await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    sourceRoot,
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

test("update refreshes existing target directories from the packaged source", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-update-"));
  const sourceRoot = path.join(tempDir, "source");
  const targetRoot = path.join(tempDir, "target");

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await mkdir(path.join(targetRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(targetRoot, "copilot-dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v2\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v2\n");
  await writeFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "stale local copy\n");
  await writeFile(path.join(targetRoot, "copilot-dev-loop", "SKILL.md"), "stale local copy\n");

  const result = await syncPackagedSkills({
    mode: "update",
    scope: "system",
    sourceRoot,
    targetRoot,
  });

  assert.deepEqual(
    result.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "updated"],
      ["copilot-dev-loop", "updated"],
    ],
  );
  assert.equal(await readFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "utf8"), "dev-loop v2\n");
  assert.equal(await readFile(path.join(targetRoot, "copilot-dev-loop", "SKILL.md"), "utf8"), "copilot v2\n");
});

test("install refuses symlinked roots and skill targets to avoid mutating the symlink source unexpectedly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-symlink-"));
  const sourceRoot = path.join(tempDir, "source");
  const realRoot = path.join(tempDir, "real-root");
  const linkedRoot = path.join(tempDir, "linked-root");

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
      targetRoot: linkedRoot,
    }),
    /symlinked skill root/i,
  );

  const targetRoot = path.join(tempDir, "target");
  await mkdir(path.join(targetRoot, "copilot-dev-loop"), { recursive: true });
  await symlink(path.join(targetRoot, "copilot-dev-loop"), path.join(targetRoot, "dev-loop"));

  await assert.rejects(
    syncPackagedSkills({
      mode: "update",
      scope: "repo",
      sourceRoot,
      targetRoot,
    }),
    /symlinked skill target/i,
  );
});

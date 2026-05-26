import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";

import { resolveSystemSkillsRoot, syncPackagedSkills } from "../extension/installer.ts";

async function seedFiles(rootPath, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(rootPath, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }
}

async function seedPackagedSupport(tempDir) {
  const scriptsRoot = path.join(tempDir, "scripts-source");
  const coreSourceRoot = path.join(tempDir, "core-src-source");
  const docsRoot = path.join(tempDir, "docs-source");

  await seedFiles(scriptsRoot, {
    "_core-helpers.mjs": "export const helper = true;\n",
    "github/_github-helpers.mjs": "export const repoHelper = true;\n",
    "github/capture-review-threads.mjs": "export const capture = true;\n",
    "github/detect-linked-issue-pr.mjs": "export const linkedPr = true;\n",
    "github/reply-resolve-review-thread.mjs": "export const reply = true;\n",
    "github/request-copilot-review.mjs": "#!/usr/bin/env node\n",
    "github/stage-reviewer-draft.mjs": "export const stage = true;\n",
    "github/watch-copilot-review.mjs": "export const watch = true;\n",
    "loop/copilot-pr-handoff.mjs": "export const handoff = true;\n",
    "loop/run-copilot-watch-cycle.mjs": "export const watchCycle = true;\n",
    "loop/_steering-state-file.mjs": "export const steeringFile = true;\n",
    "loop/detect-initial-copilot-pr-state.mjs": "export const initialState = true;\n",
    "loop/detect-copilot-loop-state.mjs": "#!/usr/bin/env node\n",
    "loop/detect-reviewer-loop-state.mjs": "export const reviewer = true;\n",
    "README.md": "scripts readme\n",
    "github/extra-helper.mjs": "export const extra = true;\n",
  });

  await seedFiles(coreSourceRoot, {
    "github/repo-slug.mjs": "export const normalizeRepoSlug = (repo) => repo;\nexport const parseRepoSlugParts = (repo) => ({ owner: repo, name: repo });\n",
    "github/review-threads.mjs": "export const reviewThreads = true;\n",
    "loop/copilot-loop-state.mjs": "export const copilotState = true;\n",
    "loop/conductor-routing.mjs": "export const ROUTING_OUTCOME = { CONTINUE_CURRENT_WAIT: 'continue_current_wait' };\n",
    "loop/outer-loop-state.mjs": "import { ROUTING_OUTCOME } from './conductor-routing.mjs';\nexport const outerLoopState = ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT;\n",
    "loop/phase-files.mjs": "export const phaseFiles = true;\n",
    "loop/reviewer-loop-state.mjs": "export const reviewerState = true;\n",
    "loop/steering.mjs": "export const steeringState = true;\n",
    "other/not-needed.mjs": "export const notNeeded = true;\n",
  });

  await seedFiles(docsRoot, {
    "copilot-loop-state-graph.md": "copilot graph\n",
    "reviewer-loop-state-graph.md": "reviewer graph\n",
    "outer-loop-state-graph.md": "outer graph\n",
    "tracker-first-mvp-state-graph.md": "tracker graph\n",
    "IMPLEMENTATION_STATE.md": "not bundled\n",
  });

  return { scriptsRoot, coreSourceRoot, docsRoot };
}

async function runNodeScript(scriptPath, args = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runNodeInline(code) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", code], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function assertInstalledCopilotHelpersExecute(targetRoot, skillName = "copilot-autopilot") {
  const detectScriptPath = path.join(targetRoot, skillName, "scripts", "loop", "detect-copilot-loop-state.mjs");
  const detectResult = await runNodeScript(detectScriptPath, ["--help"]);
  assert.equal(detectResult.code, 0);
  assert.match(detectResult.stdout, /Usage:/);
  assert.doesNotMatch(detectResult.stderr, /ERR_MODULE_NOT_FOUND/);

  const linkedIssuePrScriptPath = path.join(targetRoot, skillName, "scripts", "github", "detect-linked-issue-pr.mjs");
  const linkedIssuePrResult = await runNodeScript(linkedIssuePrScriptPath, ["--help"]);
  assert.equal(linkedIssuePrResult.code, 0);
  assert.match(linkedIssuePrResult.stdout, /Usage: detect-linked-issue-pr\.mjs/);
  assert.doesNotMatch(linkedIssuePrResult.stderr, /ERR_MODULE_NOT_FOUND/);

  const handoffScriptPath = path.join(targetRoot, skillName, "scripts", "loop", "copilot-pr-handoff.mjs");
  const handoffResult = await runNodeScript(handoffScriptPath, ["--help"]);
  assert.equal(handoffResult.code, 0);
  assert.match(handoffResult.stdout, /Usage:/);
  assert.doesNotMatch(handoffResult.stderr, /ERR_MODULE_NOT_FOUND/);

  const watchCycleScriptPath = path.join(targetRoot, skillName, "scripts", "loop", "run-copilot-watch-cycle.mjs");
  const watchCycleResult = await runNodeScript(watchCycleScriptPath, ["--help"]);
  assert.equal(watchCycleResult.code, 0);
  assert.match(watchCycleResult.stdout, /Usage:/);
  assert.doesNotMatch(watchCycleResult.stderr, /ERR_MODULE_NOT_FOUND/);
}

async function assertInstalledOuterLoopContractImports(targetRoot, skillName = "copilot-autopilot") {
  const outerLoopStatePath = path.join(targetRoot, skillName, "packages", "core", "src", "loop", "outer-loop-state.mjs");
  const result = await runNodeInline(`
    const mod = await import(${JSON.stringify(`file://${outerLoopStatePath}`)});
    process.stdout.write(String(mod.outerLoopState ?? mod.OUTER_STATE?.CONTINUE_CURRENT_WAIT ?? 'missing'));
  `);
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(result.stdout, /continue_current_wait/);
}

test("resolveSystemSkillsRoot targets ~/.pi/agent/skills", () => {
  assert.equal(resolveSystemSkillsRoot("/tmp/home"), path.join("/tmp/home", ".pi", "agent", "skills"));
});

test("install copies packaged skills and only the allow-listed copilot runtime support without overwriting existing targets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-install-"));
  const sourceRoot = path.join(tempDir, "source");
  const targetRoot = path.join(tempDir, "target");
  const { scriptsRoot, coreSourceRoot, docsRoot } = await seedPackagedSupport(tempDir);

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-autopilot"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v1\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v1\n");
  await writeFile(path.join(sourceRoot, "copilot-autopilot", "SKILL.md"), "autopilot v1\n");

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
      ["copilot-autopilot", "installed"],
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
    "export const copilotState = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "packages", "core", "src", "loop", "outer-loop-state.mjs"), "utf8"),
    "import { ROUTING_OUTCOME } from './conductor-routing.mjs';\nexport const outerLoopState = ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "docs", "copilot-loop-state-graph.md"), "utf8"),
    "copilot graph\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "docs", "outer-loop-state-graph.md"), "utf8"),
    "outer graph\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-dev-loop", "docs", "tracker-first-mvp-state-graph.md"), "utf8"),
    "tracker graph\n",
  );

  await assert.rejects(access(path.join(targetRoot, "copilot-dev-loop", "scripts", "README.md")));
  await assert.rejects(access(path.join(targetRoot, "copilot-dev-loop", "scripts", "github", "extra-helper.mjs")));
  await assert.rejects(access(path.join(targetRoot, "copilot-dev-loop", "packages", "core", "src", "other", "not-needed.mjs")));
  await assert.rejects(access(path.join(targetRoot, "copilot-dev-loop", "docs", "IMPLEMENTATION_STATE.md")));
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "loop", "copilot-pr-handoff.mjs"), "utf8"),
    "export const handoff = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "loop", "run-copilot-watch-cycle.mjs"), "utf8"),
    "export const watchCycle = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "github", "detect-linked-issue-pr.mjs"), "utf8"),
    "export const linkedPr = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "loop", "detect-initial-copilot-pr-state.mjs"), "utf8"),
    "export const initialState = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "loop", "_steering-state-file.mjs"), "utf8"),
    "export const steeringFile = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "scripts", "github", "_github-helpers.mjs"), "utf8"),
    "export const repoHelper = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "packages", "core", "src", "loop", "copilot-loop-state.mjs"), "utf8"),
    "export const copilotState = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "packages", "core", "src", "loop", "outer-loop-state.mjs"), "utf8"),
    "import { ROUTING_OUTCOME } from './conductor-routing.mjs';\nexport const outerLoopState = ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "packages", "core", "src", "loop", "steering.mjs"), "utf8"),
    "export const steeringState = true;\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "packages", "core", "src", "github", "repo-slug.mjs"), "utf8"),
    "export const normalizeRepoSlug = (repo) => repo;\nexport const parseRepoSlugParts = (repo) => ({ owner: repo, name: repo });\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "docs", "copilot-loop-state-graph.md"), "utf8"),
    "copilot graph\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "docs", "outer-loop-state-graph.md"), "utf8"),
    "outer graph\n",
  );
  assert.equal(
    await readFile(path.join(targetRoot, "copilot-autopilot", "docs", "tracker-first-mvp-state-graph.md"), "utf8"),
    "tracker graph\n",
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
      ["copilot-autopilot", "already-installed"],
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
  await mkdir(path.join(sourceRoot, "copilot-autopilot"), { recursive: true });
  await mkdir(path.join(targetRoot, "dev-loop"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v2\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v2\n");
  await writeFile(path.join(sourceRoot, "copilot-autopilot", "SKILL.md"), "autopilot v2\n");
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
      ["copilot-autopilot", "missing"],
    ],
  );
  assert.equal(await readFile(path.join(targetRoot, "dev-loop", "SKILL.md"), "utf8"), "dev-loop v2\n");
  await assert.rejects(readFile(path.join(targetRoot, "copilot-dev-loop", "SKILL.md"), "utf8"));
  await assert.rejects(readFile(path.join(targetRoot, "copilot-autopilot", "SKILL.md"), "utf8"));
});

test("install supports executing packaged copilot helper entrypoints from installed layout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-installed-exec-"));
  const targetRoot = path.join(tempDir, "target");

  await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    targetRoot,
  });

  await assertInstalledCopilotHelpersExecute(targetRoot);
  await assertInstalledOuterLoopContractImports(targetRoot);
});

test("install supports executing packaged copilot helper entrypoints through a symlinked path alias", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-installed-alias-"));
  const targetRoot = path.join(tempDir, "target");
  const aliasRoot = path.join(tempDir, "target-alias");

  await syncPackagedSkills({
    mode: "install",
    scope: "repo",
    targetRoot,
  });
  await symlink(targetRoot, aliasRoot);

  await assertInstalledCopilotHelpersExecute(aliasRoot);
  await assertInstalledOuterLoopContractImports(aliasRoot);
});

test("update refreshes packaged copilot helper entrypoints for existing installed targets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-update-exec-"));
  const targetRoot = path.join(tempDir, "target");

  await mkdir(path.join(targetRoot, "copilot-autopilot"), { recursive: true });
  await writeFile(path.join(targetRoot, "copilot-autopilot", "SKILL.md"), "stale local copy\n");

  const result = await syncPackagedSkills({
    mode: "update",
    scope: "repo",
    targetRoot,
  });

  assert.deepEqual(
    result.results.map((entry) => [entry.skillName, entry.status]),
    [
      ["dev-loop", "missing"],
      ["copilot-dev-loop", "missing"],
      ["copilot-autopilot", "updated"],
    ],
  );
  await assertInstalledCopilotHelpersExecute(targetRoot);
  await assertInstalledOuterLoopContractImports(targetRoot);
});

test("install refuses symlinked roots, symlinked ancestors, and skill targets to avoid mutating the symlink source unexpectedly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-extension-symlink-"));
  const sourceRoot = path.join(tempDir, "source");
  const realRoot = path.join(tempDir, "real-root");
  const linkedRoot = path.join(tempDir, "linked-root");
  const { scriptsRoot, coreSourceRoot, docsRoot } = await seedPackagedSupport(tempDir);

  await mkdir(path.join(sourceRoot, "dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-dev-loop"), { recursive: true });
  await mkdir(path.join(sourceRoot, "copilot-autopilot"), { recursive: true });
  await writeFile(path.join(sourceRoot, "dev-loop", "SKILL.md"), "dev-loop v1\n");
  await writeFile(path.join(sourceRoot, "copilot-dev-loop", "SKILL.md"), "copilot v1\n");
  await writeFile(path.join(sourceRoot, "copilot-autopilot", "SKILL.md"), "autopilot v1\n");

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

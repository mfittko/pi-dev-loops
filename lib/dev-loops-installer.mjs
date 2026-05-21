import { cp, lstat, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Authoritative packaged skill directory names used by the shared dev-loops
 * core, the Pi extension wrapper, the shell CLI wrapper, and the colocated
 * TypeScript declaration file. Treat this list as immutable.
 */
export const PACKAGED_SKILL_NAMES = ["dev-loop", "copilot-dev-loop", "copilot-autopilot"];
const COPILOT_RUNTIME_SCRIPT_FILES = [
  "_core-helpers.mjs",
  "github/_github-helpers.mjs",
  "github/capture-review-threads.mjs",
  "github/detect-linked-issue-pr.mjs",
  "github/reply-resolve-review-thread.mjs",
  "github/request-copilot-review.mjs",
  "github/stage-reviewer-draft.mjs",
  "github/watch-copilot-review.mjs",
  "loop/copilot-pr-handoff.mjs",
  "loop/detect-initial-copilot-pr-state.mjs",
  "loop/detect-copilot-loop-state.mjs",
  "loop/detect-reviewer-loop-state.mjs",
];
const COPILOT_RUNTIME_CORE_FILES = [
  "github/review-threads.mjs",
  "loop/copilot-loop-state.mjs",
  "loop/phase-files.mjs",
  "loop/reviewer-loop-state.mjs",
];
const COPILOT_RUNTIME_DOCS = [
  "copilot-loop-state-graph.md",
  "reviewer-loop-state-graph.md",
  "tracker-first-mvp-state-graph.md",
];

function repoRootFromInstaller() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolvePackagedSkillsRoot() {
  return path.join(repoRootFromInstaller(), "skills");
}

export function resolvePackagedScriptsRoot() {
  return path.join(repoRootFromInstaller(), "scripts");
}

export function resolvePackagedCoreSourceRoot() {
  return path.join(repoRootFromInstaller(), "packages", "core", "src");
}

export function resolvePackagedDocsRoot() {
  return path.join(repoRootFromInstaller(), "docs");
}

export function resolveSystemSkillsRoot(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".pi", "agent", "skills");
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathKind(targetPath) {
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      return "symlink";
    }

    if (stats.isDirectory()) {
      return "directory";
    }

    return "other";
  } catch {
    return "missing";
  }
}

async function findSymlinkedAncestor(targetPath, anchorPath) {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedAnchorPath = path.resolve(anchorPath);
  const relativePath = path.relative(resolvedAnchorPath, resolvedTargetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Target path is outside the expected skill root anchor: ${targetPath}`);
  }

  let currentPath = resolvedAnchorPath;

  for (const segment of [".", ...relativePath.split(path.sep).filter(Boolean)]) {
    if (segment !== ".") {
      currentPath = path.join(currentPath, segment);
    }

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        return currentPath;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function resolveSymlinkCheckAnchor(scope, targetRoot) {
  if (scope === "system") {
    return path.resolve(targetRoot, "..", "..", "..");
  }

  return path.resolve(targetRoot, "..", "..");
}

async function assertWritableSkillRoot(scope, targetRoot) {
  const symlinkPath = await findSymlinkedAncestor(targetRoot, resolveSymlinkCheckAnchor(scope, targetRoot));

  if (symlinkPath) {
    throw new Error(
      `Refusing to install into symlinked skill root: ${targetRoot}. Ancestor path is a symlink: ${symlinkPath}. Use a real directory target or manage the symlink source directly.`,
    );
  }

  const kind = await pathKind(targetRoot);

  if (kind === "other") {
    throw new Error(`Skill root exists but is not a directory: ${targetRoot}`);
  }
}

async function assertWritableSkillTarget(targetPath) {
  const kind = await pathKind(targetPath);

  if (kind === "symlink") {
    throw new Error(
      `Refusing to overwrite symlinked skill target: ${targetPath}. Use a real directory target or manage the symlink source directly.`,
    );
  }

  if (kind === "other") {
    throw new Error(`Skill target exists but is not a directory: ${targetPath}`);
  }
}

async function copyRelativeFiles({ sourceRoot, targetRoot, relativePaths }) {
  for (const relativePath of relativePaths) {
    const targetFilePath = path.join(targetRoot, relativePath);
    await mkdir(path.dirname(targetFilePath), { recursive: true });
    await cp(path.join(sourceRoot, relativePath), targetFilePath);
  }
}

async function copyCopilotRuntimeSupport({ targetPath, scriptsRoot, coreSourceRoot, docsRoot }) {
  await copyRelativeFiles({
    sourceRoot: scriptsRoot,
    targetRoot: path.join(targetPath, "scripts"),
    relativePaths: COPILOT_RUNTIME_SCRIPT_FILES,
  });
  await copyRelativeFiles({
    sourceRoot: coreSourceRoot,
    targetRoot: path.join(targetPath, "packages", "core", "src"),
    relativePaths: COPILOT_RUNTIME_CORE_FILES,
  });
  await copyRelativeFiles({
    sourceRoot: docsRoot,
    targetRoot: path.join(targetPath, "docs"),
    relativePaths: COPILOT_RUNTIME_DOCS,
  });
}

export async function syncPackagedSkills({
  mode,
  scope,
  targetRoot,
  sourceRoot = resolvePackagedSkillsRoot(),
  scriptsRoot = resolvePackagedScriptsRoot(),
  coreSourceRoot = resolvePackagedCoreSourceRoot(),
  docsRoot = resolvePackagedDocsRoot(),
}) {
  await assertWritableSkillRoot(scope, targetRoot);
  await mkdir(targetRoot, { recursive: true });

  const results = [];

  for (const skillName of PACKAGED_SKILL_NAMES) {
    const sourcePath = path.join(sourceRoot, skillName);
    const targetPath = path.join(targetRoot, skillName);
    await assertWritableSkillTarget(targetPath);
    const exists = await pathExists(targetPath);

    if (mode === "install" && exists) {
      results.push({
        skillName,
        status: "already-installed",
        targetPath,
      });
      continue;
    }

    if (mode === "update") {
      if (!exists) {
        results.push({
          skillName,
          status: "missing",
          targetPath,
        });
        continue;
      }

      await rm(targetPath, { recursive: true, force: true });
    }

    await cp(sourcePath, targetPath, { recursive: true });

    if (skillName === "copilot-dev-loop" || skillName === "copilot-autopilot") {
      await copyCopilotRuntimeSupport({
        targetPath,
        scriptsRoot,
        coreSourceRoot,
        docsRoot,
      });
    }

    results.push({
      skillName,
      status: mode === "update" ? "updated" : "installed",
      targetPath,
    });
  }

  return {
    mode,
    scope,
    targetRoot,
    results,
  };
}

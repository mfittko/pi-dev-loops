import { cp, lstat, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGED_SKILL_NAMES = ["dev-loop", "copilot-dev-loop"] as const;

export type InstallScope = "repo" | "system";
export type InstallMode = "install" | "update";
export type InstallStatus = "installed" | "updated" | "already-installed";

export type SkillInstallResult = {
  skillName: (typeof PACKAGED_SKILL_NAMES)[number];
  status: InstallStatus;
  targetPath: string;
};

export type InstallResult = {
  mode: InstallMode;
  scope: InstallScope;
  targetRoot: string;
  results: SkillInstallResult[];
};

function repoRootFromInstaller() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolvePackagedSkillsRoot() {
  return path.join(repoRootFromInstaller(), "skills");
}

export function resolveSystemSkillsRoot(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".pi", "agent", "skills");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathKind(targetPath: string): Promise<"missing" | "directory" | "symlink" | "other"> {
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

async function findSymlinkedAncestor(targetPath: string): Promise<string | undefined> {
  let currentPath = path.resolve(targetPath);

  while (true) {
    try {
      const stats = await lstat(currentPath);
      return stats.isSymbolicLink() ? currentPath : undefined;
    } catch {
      // Missing path segments are fine here; keep walking upward until the first existing ancestor.
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

async function assertWritableSkillRoot(targetRoot: string) {
  const symlinkPath = await findSymlinkedAncestor(targetRoot);

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

async function assertWritableSkillTarget(targetPath: string) {
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

export async function syncPackagedSkills({
  mode,
  scope,
  targetRoot,
  sourceRoot = resolvePackagedSkillsRoot(),
}: {
  mode: InstallMode;
  scope: InstallScope;
  targetRoot: string;
  sourceRoot?: string;
}): Promise<InstallResult> {
  await assertWritableSkillRoot(targetRoot);
  await mkdir(targetRoot, { recursive: true });

  const results: SkillInstallResult[] = [];

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

    if (mode === "update" && exists) {
      await rm(targetPath, { recursive: true, force: true });
    }

    await cp(sourcePath, targetPath, { recursive: true });

    results.push({
      skillName,
      status: mode === "update" && exists ? "updated" : "installed",
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

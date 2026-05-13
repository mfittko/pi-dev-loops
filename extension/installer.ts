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
  await mkdir(targetRoot, { recursive: true });

  const results: SkillInstallResult[] = [];

  for (const skillName of PACKAGED_SKILL_NAMES) {
    const sourcePath = path.join(sourceRoot, skillName);
    const targetPath = path.join(targetRoot, skillName);
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

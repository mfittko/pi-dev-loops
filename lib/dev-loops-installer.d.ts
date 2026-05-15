export const PACKAGED_SKILL_NAMES: readonly ["dev-loop", "copilot-dev-loop", "copilot-autopilot"];

export type InstallScope = "repo" | "system";
export type InstallMode = "install" | "update";
export type InstallStatus = "installed" | "updated" | "already-installed" | "missing";

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

export function resolvePackagedSkillsRoot(): string;
export function resolvePackagedScriptsRoot(): string;
export function resolvePackagedCoreSourceRoot(): string;
export function resolvePackagedDocsRoot(): string;
export function resolveSystemSkillsRoot(homeDirectory?: string): string;

export function syncPackagedSkills(options: {
  mode: InstallMode;
  scope: InstallScope;
  targetRoot: string;
  sourceRoot?: string;
  scriptsRoot?: string;
  coreSourceRoot?: string;
  docsRoot?: string;
}): Promise<InstallResult>;

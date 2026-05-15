export {
  PACKAGED_SKILL_NAMES,
  resolvePackagedCoreSourceRoot,
  resolvePackagedDocsRoot,
  resolvePackagedScriptsRoot,
  resolvePackagedSkillsRoot,
  resolveSystemSkillsRoot,
  syncPackagedSkills,
} from "../lib/dev-loops-installer.mjs";

export type InstallScope = "repo" | "system";
export type InstallMode = "install" | "update";
export type InstallStatus = "installed" | "updated" | "already-installed" | "missing";

export type SkillInstallResult = {
  skillName: "dev-loop" | "copilot-dev-loop" | "copilot-autopilot";
  status: InstallStatus;
  targetPath: string;
};

export type InstallResult = {
  mode: InstallMode;
  scope: InstallScope;
  targetRoot: string;
  results: SkillInstallResult[];
};

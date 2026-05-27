import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

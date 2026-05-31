#!/usr/bin/env node
import path from "node:path";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { formatCliError } from "../_core-helpers.mjs";

export const INSPECT_RUN_VIEWER_RELEVANT_EXACT_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  "playwright.inspect-run-viewer.config.mjs",
  "scripts/loop/_inspect-run-viewer-adapter.mjs",
  "scripts/loop/inspect-run-viewer.mjs",
  "scripts/loop/inspect-run-viewer-ci-changes.mjs",
]);

export const INSPECT_RUN_VIEWER_RELEVANT_PREFIXES = Object.freeze([
  "scripts/loop/inspect-run-viewer/",
  "test/playwright/",
]);

export function normalizeInspectRunViewerPath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replace(/^\.\/+/u, "");
}

export function isInspectRunViewerRelevantPath(filePath) {
  const normalizedPath = normalizeInspectRunViewerPath(filePath);
  if (!normalizedPath) {
    return false;
  }

  return INSPECT_RUN_VIEWER_RELEVANT_EXACT_PATHS.includes(normalizedPath)
    || INSPECT_RUN_VIEWER_RELEVANT_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

export function classifyInspectRunViewerCiChanges(changedPaths = []) {
  const normalizedPaths = changedPaths
    .map((entry) => normalizeInspectRunViewerPath(entry))
    .filter(Boolean);

  const relevantPaths = [...new Set(normalizedPaths.filter((entry) => isInspectRunViewerRelevantPath(entry)))].sort();
  const ignoredPaths = [...new Set(normalizedPaths.filter((entry) => !isInspectRunViewerRelevantPath(entry)))].sort();

  return {
    shouldRun: relevantPaths.length > 0,
    relevantPaths,
    ignoredPaths,
  };
}

function parseCliArgs(argv) {
  const options = {
    githubOutput: null,
    pathsFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--paths-file") {
      options.pathsFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (argument === "--github-output") {
      options.githubOutput = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (argument === "--help") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.help && !options.pathsFile) {
    throw new Error("Missing required --paths-file <file>");
  }

  return options;
}

const USAGE = `Usage: inspect-run-viewer-ci-changes.mjs --paths-file <file> [--github-output <file>]`;

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const options = parseCliArgs(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return null;
  }

  const rawPaths = await readFile(options.pathsFile, "utf8");
  const changedPaths = rawPaths
    .split(/\r?\n/u)
    .filter(Boolean);
  const result = classifyInspectRunViewerCiChanges(changedPaths);

  if (options.githubOutput) {
    await appendFile(
      options.githubOutput,
      [
        `inspect_run_viewer=${result.shouldRun}`,
        `inspect_run_viewer_relevant_paths_json=${JSON.stringify(result.relevantPaths)}`,
      ].join("\n") + "\n",
      "utf8",
    );
  }

  stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCli().catch((error) => {
    const cliError = new Error(error?.message ?? String(error));
    cliError.usage = USAGE;
    process.stderr.write(`${formatCliError(cliError)}\n`);
    process.exitCode = 1;
  });
}

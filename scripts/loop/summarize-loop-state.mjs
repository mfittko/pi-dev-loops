#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPhasePaths, formatCliError, readJsonIfExists } from "../_core-helpers.mjs";

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function parseSummarizeCliArgs(argv) {
  const args = [...argv];
  const options = {
    projectRoot: process.cwd(),
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--project-root") {
      options.projectRoot = requireOptionValue(args, "--project-root");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function comparePhases(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function normalizeValidation(manifest) {
  if (!manifest) {
    return {
      check: "missing",
      test: "missing",
      coverage: "missing",
    };
  }

  return {
    check: manifest.validation?.check ?? "not-run",
    test: manifest.validation?.test ?? "not-run",
    coverage: manifest.validation?.coverage ?? "not-run",
  };
}

export async function summarizeLoopState(projectRoot) {
  const indexPath = path.join(projectRoot, "tmp", "phases", "index.json");
  const index = await readJsonIfExists(indexPath);
  const phaseEntries = Array.isArray(index?.phases)
    ? [...index.phases].sort((left, right) => comparePhases(left.phase, right.phase))
    : [];

  const phases = await Promise.all(phaseEntries.map(async (entry) => {
    const paths = buildPhasePaths(projectRoot, entry.phase);
    const manifestPath = entry.manifestPath ? path.resolve(projectRoot, entry.manifestPath) : paths.manifestPath;
    const manifest = await readJsonIfExists(manifestPath);

    return {
      phase: entry.phase,
      status: manifest?.status ?? entry.status ?? "missing",
      manifestPath,
      manifestExists: Boolean(manifest),
      validation: normalizeValidation(manifest),
      artifactPresence: {
        phasePlan: await pathExists(paths.phasePlanPath),
        bashExitOne: await pathExists(paths.bashExitOnePath),
      },
      artifactCounts: {
        artifacts: normalizeCount(manifest?.artifacts),
        subagents: normalizeCount(manifest?.subagents),
        decisions: normalizeCount(manifest?.decisions),
        notes: normalizeCount(manifest?.notes),
      },
    };
  }));

  return {
    ok: true,
    projectRoot,
    index: {
      path: indexPath,
      exists: Boolean(index),
      phaseCount: phases.length,
    },
    phases,
  };
}

export async function runCli(argv = process.argv.slice(2), stdout = process.stdout) {
  const options = parseSummarizeCliArgs(argv);
  const summary = await summarizeLoopState(options.projectRoot);
  stdout.write(`${JSON.stringify(summary)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

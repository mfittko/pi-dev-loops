import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildPhasePaths } from "./phase-files.mjs";

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function countLines(text) {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  return text.trimEnd().split("\n").length;
}

export function parseJsonLines(text) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export async function collectDevModeContext(projectRoot, phase) {
  const paths = buildPhasePaths(projectRoot, phase);
  const summaryPath = path.join(paths.phaseDir, "summary.md");
  const retrospectivePath = path.join(paths.phaseDir, "retrospective.md");
  const reviewPath = path.join(paths.phaseDir, "review.md");
  const mergedPlanPath = path.join(paths.phaseDir, "merged-plan.md");

  const [manifestText, summaryText, retrospectiveText, reviewText, mergedPlanText, bashExitOneText] = await Promise.all([
    readTextIfExists(paths.manifestPath),
    readTextIfExists(summaryPath),
    readTextIfExists(retrospectivePath),
    readTextIfExists(reviewPath),
    readTextIfExists(mergedPlanPath),
    readTextIfExists(paths.bashExitOnePath),
  ]);

  const manifest = manifestText ? JSON.parse(manifestText) : undefined;
  const bashExitOneRecords = parseJsonLines(bashExitOneText);

  return {
    phase: paths.phase,
    projectRoot,
    paths: {
      manifestPath: path.relative(projectRoot, paths.manifestPath),
      bashExitOnePath: path.relative(projectRoot, paths.bashExitOnePath),
      summaryPath: path.relative(projectRoot, summaryPath),
      retrospectivePath: path.relative(projectRoot, retrospectivePath),
      reviewPath: path.relative(projectRoot, reviewPath),
      mergedPlanPath: path.relative(projectRoot, mergedPlanPath),
      devModeContextPath: path.relative(projectRoot, path.join(paths.phaseDir, "dev-mode-context.json")),
    },
    manifest,
    artifactPresence: {
      summary: Boolean(summaryText),
      retrospective: Boolean(retrospectiveText),
      review: Boolean(reviewText),
      mergedPlan: Boolean(mergedPlanText),
      bashExitOneLog: Boolean(bashExitOneText),
    },
    lineCounts: {
      summary: countLines(summaryText),
      retrospective: countLines(retrospectiveText),
      review: countLines(reviewText),
      mergedPlan: countLines(mergedPlanText),
      bashExitOneLog: countLines(bashExitOneText),
    },
    bashExitOne: {
      count: bashExitOneRecords.length,
      commands: [...new Set(bashExitOneRecords.map((record) => record.command))].sort(),
      records: bashExitOneRecords,
    },
  };
}

export async function writeDevModeContext(outputPath, context) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  return outputPath;
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    projectRoot: process.cwd(),
    phase: undefined,
    output: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--project-root") {
      options.projectRoot = args.shift();
      continue;
    }

    if (token === "--phase") {
      options.phase = args.shift();
      continue;
    }

    if (token === "--output") {
      options.output = args.shift();
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.phase) {
    throw new Error("Missing required --phase <phase-name> argument");
  }

  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const context = await collectDevModeContext(options.projectRoot, options.phase);
  const outputPath = options.output ?? path.join(options.projectRoot, "tmp", "phases", options.phase, "dev-mode-context.json");
  await writeDevModeContext(outputPath, context);
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, phase: context.phase })}\n`);
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

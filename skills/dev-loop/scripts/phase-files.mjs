import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createDefaultPhaseManifest(phase) {
  return {
    phase,
    status: "not-started",
    startedAt: "",
    completedAt: "",
    nextPhase: "",
    validation: {
      check: "not-run",
      test: "not-run",
      coverage: "not-run",
    },
    artifacts: [],
    subagents: [],
    decisions: [],
    notes: [],
  };
}

export function createDefaultPhaseIndex() {
  return {
    phases: [],
  };
}

export function normalizePhaseName(phase) {
  if (typeof phase !== "string" || !/^phase-\d+$/.test(phase)) {
    throw new Error(`phase must match phase-<number>, received ${phase}`);
  }

  return phase;
}

export function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

export async function readJsonIfExists(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildPhasePaths(projectRoot, phase) {
  const normalizedPhase = normalizePhaseName(phase);
  const phasesRoot = path.join(projectRoot, "tmp", "phases");
  const phaseDir = path.join(phasesRoot, normalizedPhase);
  const docsPhasesRoot = path.join(projectRoot, "docs", "phases");

  return {
    projectRoot,
    phasesRoot,
    phase: normalizedPhase,
    phaseDir,
    docsPhasesRoot,
    phasePlanPath: path.join(docsPhasesRoot, `${normalizedPhase}.md`),
    manifestPath: path.join(phaseDir, "manifest.json"),
    indexPath: path.join(phasesRoot, "index.json"),
    bashExitOnePath: path.join(phaseDir, "bash-exit-1.jsonl"),
  };
}

export function applyManifestPatch(manifest, patch = {}) {
  const next = {
    ...manifest,
    ...patch,
    validation: {
      ...manifest.validation,
      ...(patch.validation ?? {}),
    },
  };

  next.artifacts = uniqueSortedStrings([...(manifest.artifacts ?? []), ...(patch.artifacts ?? [])]);
  next.subagents = uniqueSortedStrings([...(manifest.subagents ?? []), ...(patch.subagents ?? [])]);
  next.decisions = uniqueSortedStrings([...(manifest.decisions ?? []), ...(patch.decisions ?? [])]);
  next.notes = uniqueSortedStrings([...(manifest.notes ?? []), ...(patch.notes ?? [])]);

  return next;
}

export function upsertPhaseIndex(index, phaseEntry) {
  const phases = Array.isArray(index?.phases) ? [...index.phases] : [];
  const existingIndex = phases.findIndex((entry) => entry.phase === phaseEntry.phase);

  if (existingIndex >= 0) {
    phases[existingIndex] = {
      ...phases[existingIndex],
      ...phaseEntry,
    };
  } else {
    phases.push(phaseEntry);
  }

  phases.sort((left, right) => left.phase.localeCompare(right.phase, undefined, { numeric: true }));
  return { phases };
}

export async function ensurePhaseFiles(projectRoot, phase, patch = {}) {
  const paths = buildPhasePaths(projectRoot, phase);
  await mkdir(paths.phaseDir, { recursive: true });

  const currentManifest = (await readJsonIfExists(paths.manifestPath)) ?? createDefaultPhaseManifest(paths.phase);
  const nextManifest = applyManifestPatch(currentManifest, patch);
  await writeJson(paths.manifestPath, nextManifest);

  const currentIndex = (await readJsonIfExists(paths.indexPath)) ?? createDefaultPhaseIndex();
  const nextIndex = upsertPhaseIndex(currentIndex, {
    phase: paths.phase,
    status: nextManifest.status,
    manifestPath: path.relative(projectRoot, paths.manifestPath),
    updatedAt: new Date().toISOString(),
  });
  await writeJson(paths.indexPath, nextIndex);

  return {
    paths,
    manifest: nextManifest,
    index: nextIndex,
  };
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    projectRoot: process.cwd(),
    phase: undefined,
    patch: {},
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

    if (token === "--patch") {
      options.patch = JSON.parse(args.shift() ?? "{}");
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
  const result = await ensurePhaseFiles(options.projectRoot, options.phase, options.patch);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result.paths })}\n`);
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

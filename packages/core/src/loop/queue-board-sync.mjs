import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { main as moveQueueItemMain } from "../../../../scripts/projects/move-queue-item.mjs";
import { main as ensureQueueBoardMain } from "../../../../scripts/projects/ensure-queue-board.mjs";

const DEFAULT_NON_SUCCESS_COLUMN = "Backlog";

function readDevloopsSettings(repoRoot) {
  const base = path.join(repoRoot, ".devloops");
  const extensions = ["", ".yaml", ".yml", ".json"];
  for (const ext of extensions) {
    try {
      const raw = readFileSync(base + ext, "utf8");
      const settings = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
      return settings?.queue ?? null;
    } catch {
      // try next extension
    }
  }
  return null;
}

export function loadBoardConfig(repoRoot) {
  const queue = readDevloopsSettings(repoRoot);
  if (!queue) return { enabled: false };
  if (typeof queue.projectNumber === "number" && queue.projectNumber > 0) {
    return { enabled: true, projectNumber: queue.projectNumber };
  }
  if (typeof queue.boardTitle === "string" && queue.boardTitle.trim().length > 0) {
    return { enabled: true, boardTitle: queue.boardTitle.trim() };
  }
  return { enabled: false };
}

async function resolveProjectNumber(repo, config, env, runChild) {
  if (config.projectNumber) return config.projectNumber;
  if (config.boardTitle) {
    const result = await ensureQueueBoardMain(
      { repo, title: config.boardTitle },
      { env, runChild },
    );
    return result?.project?.number ?? null;
  }
  return null;
}

export async function syncBoardStatus(
  repo,
  repoRoot,
  itemNumber,
  targetColumn,
  env = process.env,
  dependencies = {},
) {
  const config = loadBoardConfig(repoRoot);
  if (!config.enabled) {
    return { ok: true, skipped: true, reason: "board not configured" };
  }

  const projectNumber = await resolveProjectNumber(repo, config, env, dependencies.runChild);
  if (!projectNumber) {
    return { ok: true, skipped: true, reason: "could not resolve board project" };
  }

  const moveItem = dependencies.moveQueueItem ?? moveQueueItemMain;
  try {
    const result = await moveItem(
      { repo, project: projectNumber, item: itemNumber, toColumn: targetColumn },
      { env, runChild: dependencies.runChild },
    );
    return { ok: true, skipped: false, result };
  } catch (err) {
    // Fail-open: log the problem but do not block the queue.
    return { ok: true, skipped: true, reason: err.message ?? "board sync failed" };
  }
}

export function nonSuccessBoardColumn(repoRoot, fallback = DEFAULT_NON_SUCCESS_COLUMN) {
  const queue = readDevloopsSettings(repoRoot);
  const configured = queue?.nonSuccessStatus;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : fallback;
}

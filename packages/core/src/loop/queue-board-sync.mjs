import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { runChild as coreRunChild } from "../cli/primitives.mjs";
import { main as moveQueueItemMain } from "../../../../scripts/projects/move-queue-item.mjs";

const DEFAULT_NON_SUCCESS_COLUMN = "Backlog";

// ── Local config loader ─────────────────────────────────────────────────

function readDevloopsSettings(repoRoot) {
  const base = path.join(repoRoot, ".devloops");
  const extensions = ["", ".yaml", ".yml", ".json"];
  let foundError = null;
  for (const ext of extensions) {
    try {
      const raw = readFileSync(base + ext, "utf8");
      const settings = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
      return { settings: settings?.queue ?? null };
    } catch (err) {
      if (err?.code === "ENOENT") {
        // try next extension
      } else if (!foundError) {
        foundError = err;
      }
    }
  }
  if (foundError) {
    return { error: foundError.message };
  }
  return { settings: null };
}

export function loadBoardConfig(repoRoot) {
  const { settings: queue, error } = readDevloopsSettings(repoRoot);
  if (error) {
    return { enabled: false, reason: `config read/parse error: ${error}` };
  }
  if (!queue) return { enabled: false };
  if (typeof queue.projectNumber === "number" && queue.projectNumber > 0) {
    return { enabled: true, projectNumber: queue.projectNumber };
  }
  if (typeof queue.boardTitle === "string" && queue.boardTitle.trim().length > 0) {
    return { enabled: true, boardTitle: queue.boardTitle.trim() };
  }
  return { enabled: false };
}

// ── Minimal project lookup (read-only, no create/repair) ────────────────

const GET_USER_ID = [
  "query($login:String!) {",
  "  user(login:$login) { id }",
  "}"
].join("\n");

const GET_ORG_ID = [
  "query($login:String!) {",
  "  organization(login:$login) { id }",
  "}"
].join("\n");

const LIST_USER_PROJECTS = [
  "query($login:String!, $after:String) {",
  "  user(login:$login) {",
  "    projectsV2(first:50, after:$after) {",
  "      pageInfo { hasNextPage endCursor }",
  "      nodes { id number title url }",
  "    }",
  "  }",
  "}"
].join("\n");

const LIST_ORG_PROJECTS = [
  "query($login:String!, $after:String) {",
  "  organization(login:$login) {",
  "    projectsV2(first:50, after:$after) {",
  "      pageInfo { hasNextPage endCursor }",
  "      nodes { id number title url }",
  "    }",
  "  }",
  "}"
].join("\n");

async function ghGraphql(query, vars, env, runChild) {
  const child = runChild ?? coreRunChild;
  const fieldArgs = [];
  for (const [key, value] of Object.entries(vars)) {
    fieldArgs.push("--field", `${key}=${value}`);
  }
  const result = await child(
    "gh",
    ["api", "graphql", "--field", `query=${query}`, ...fieldArgs],
    env,
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw Object.assign(new Error(`gh api graphql failed: ${detail}`), { code: "GH_API_ERROR" });
  }
  const payload = JSON.parse(result.stdout);
  if (payload.errors && payload.errors.length > 0) {
    throw Object.assign(
      new Error(`GraphQL errors: ${payload.errors.map((e) => e.message).join("; ")}`),
      { code: "GRAPHQL_ERROR" },
    );
  }
  return payload;
}

async function resolveOwner(login, env, runChild) {
  const userPayload = await ghGraphql(GET_USER_ID, { login }, env, runChild);
  if (userPayload?.data?.user?.id) {
    return { id: userPayload.data.user.id, kind: "user" };
  }
  const orgPayload = await ghGraphql(GET_ORG_ID, { login }, env, runChild);
  if (orgPayload?.data?.organization?.id) {
    return { id: orgPayload.data.organization.id, kind: "org" };
  }
  throw Object.assign(
    new Error(`Could not resolve owner ID for "${login}"`),
    { code: "NO_USER_ID" },
  );
}

async function listAllProjects(login, kind, env, runChild) {
  const query = kind === "org" ? LIST_ORG_PROJECTS : LIST_USER_PROJECTS;
  const projects = [];
  let after = null;
  while (true) {
    const vars = { login };
    if (after) vars.after = after;
    const payload = await ghGraphql(query, vars, env, runChild);
    const connection = kind === "org"
      ? payload?.data?.organization?.projectsV2
      : payload?.data?.user?.projectsV2;
    const nodes = connection?.nodes ?? [];
    projects.push(...nodes);
    const pageInfo = connection?.pageInfo ?? {};
    if (!pageInfo.hasNextPage) break;
    if (!pageInfo.endCursor) {
      throw Object.assign(
        new Error("Invalid projects list payload: hasNextPage is true but endCursor is missing"),
        { code: "GH_API_ERROR" },
      );
    }
    after = pageInfo.endCursor;
  }
  return projects;
}

const projectNumberCache = new Map();

function projectCacheKey(repo, boardTitle) {
  return `${repo}::${boardTitle}`;
}

async function resolveProjectNumber(repo, config, env, runChild) {
  if (config.projectNumber) return config.projectNumber;
  if (config.boardTitle) {
    const key = projectCacheKey(repo, config.boardTitle);
    const cached = projectNumberCache.get(key);
    if (cached) return cached;

    const [owner] = repo.split("/");
    const { kind } = await resolveOwner(owner, env, runChild);
    const projects = await listAllProjects(owner, kind, env, runChild);
    const match = projects.find((p) => p.title === config.boardTitle);
    if (!match) {
      throw Object.assign(
        new Error(`Board title "${config.boardTitle}" not found under "${owner}"`),
        { code: "BOARD_NOT_FOUND" },
      );
    }
    projectNumberCache.set(key, match.number);
    return match.number;
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────

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
    return { ok: true, skipped: true, reason: config.reason ?? "board not configured" };
  }

  let projectNumber;
  try {
    projectNumber = await resolveProjectNumber(repo, config, env, dependencies.runChild);
  } catch (err) {
    return { ok: true, skipped: true, reason: err.message ?? "board lookup failed" };
  }
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
    return { ok: true, skipped: true, reason: err.message ?? "board sync failed" };
  }
}

export function nonSuccessBoardColumn(repoRoot, fallback = DEFAULT_NON_SUCCESS_COLUMN) {
  const { settings: queue } = readDevloopsSettings(repoRoot);
  const configured = queue?.nonSuccessStatus;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : fallback;
}

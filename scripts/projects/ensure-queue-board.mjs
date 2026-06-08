#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { runChild as _runChild } from "../_cli-primitives.mjs";

const USAGE = `Usage: node scripts/projects/ensure-queue-board.mjs --repo <owner/name> [--project <number>] [--title <title>] [--link-repo <owner/name>]

Idempotent bootstrap for a GitHub Projects V2 board used as the dev-loop queue.

Creates the project board if it doesn't exist, ensures a Status field with
standard columns (Backlog, Next Up, In Progress, Done). Exits clean if the
board and Status field already exist.

When --link-repo is provided, links the project to the given repository after creation.

When --project is not provided, resolves from .pi/dev-loop/settings.yaml
queue.projectNumber or queue.boardTitle.

Output (stdout):
  JSON: { ok: true, project: { id, number, title, url, statusFieldId, linkedRepo } }

Exit codes:
  0 — board exists or was created successfully (idempotent)
  1 — usage or argument error
  2 — GitHub API error
  3 — board schema/config mismatch (manual reconciliation needed)
`;

const VALID_ARGS = new Set(["--repo", "--project", "--title", "--link-repo", "--help", "-h"]);

function parseArgs(argv) {
  const args = { title: "Dev Loop Queue" };
  const consumed = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (consumed.has(i)) continue;
    const arg = argv[i];
    if (!VALID_ARGS.has(arg) && arg.startsWith("-")) {
      throw Object.assign(
        new Error(`Unknown flag: ${arg}`),
        { code: "INVALID_REPO", usage: USAGE },
      );
    }
    if (arg === "--repo") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw Object.assign(
          new Error("--repo requires a value (owner/name)"),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      args.repo = argv[++i];
      consumed.add(i);
    } else if (arg === "--project") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw Object.assign(
          new Error("--project requires a numeric value"),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      const num = Number(argv[++i]);
      if (!Number.isInteger(num) || num <= 0) {
        throw Object.assign(
          new Error(`--project must be a positive integer, got "${argv[i]}"`),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      args.project = num;
    } else if (arg === "--title") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw Object.assign(
          new Error("--title requires a value"),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      args.title = argv[++i];
      consumed.add(i);
    } else if (arg === "--link-repo") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw Object.assign(
          new Error("--link-repo requires a value (owner/name)"),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      args.linkRepo = argv[++i];
      consumed.add(i);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw Object.assign(
        new Error(`Unexpected argument: ${arg}`),
        { code: "INVALID_REPO", usage: USAGE },
      );
    }
  }
  return args;
}

// ── Validation ───────────────────────────────────────────────────────────

// GitHub slug rules: owner 1-39 chars (alnum/dash, no leading/trailing dash,
// no consecutive dashes); repo name similar but also allows dots/underscores.
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const REPO_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/;

function validateRepo(repo) {
  if (!repo || typeof repo !== "string") {
    throw Object.assign(new Error("--repo is required"), { code: "INVALID_REPO", usage: USAGE });
  }
  const trimmed = repo.trim();
  if (trimmed !== repo) {
    throw Object.assign(
      new Error(`--repo must not have leading/trailing whitespace, got "${repo}"`),
      { code: "INVALID_REPO", usage: USAGE },
    );
  }
  const slashIdx = repo.indexOf("/");
  if (slashIdx === -1) {
    throw Object.assign(
      new Error(`--repo must be exactly owner/name, got "${repo}"`),
      { code: "INVALID_REPO", usage: USAGE },
    );
  }
  const owner = repo.slice(0, slashIdx);
  const name = repo.slice(slashIdx + 1);
  if (!owner || !name) {
    throw Object.assign(
      new Error(`--repo must be exactly owner/name, got "${repo}"`),
      { code: "INVALID_REPO", usage: USAGE },
    );
  }
  if (!OWNER_RE.test(owner) || !REPO_NAME_RE.test(name)) {
    throw Object.assign(
      new Error(`--repo must be exactly owner/name, got "${repo}"`),
      { code: "INVALID_REPO", usage: USAGE },
    );
  }
  return repo;
}

// ── Settings fallback ────────────────────────────────────────────────────

function resolveSettings(cwd) {
  try {
    const settingsPath = path.join(cwd, ".pi", "dev-loop", "settings.yaml");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = parseYaml(raw);
    const queue = settings?.queue;
    if (queue) {
      if (typeof queue.projectNumber === "number" && Number.isInteger(queue.projectNumber) && queue.projectNumber > 0) {
        return { project: queue.projectNumber };
      }
      if (typeof queue.boardTitle === "string" && queue.boardTitle.trim().length > 0) {
        return { title: queue.boardTitle.trim() };
      }
    }
  } catch {
    // settings file missing or unparseable — no fallback
  }
  return null;
}

// ── API helpers ──────────────────────────────────────────────────────────

async function ghGraphql(query, vars, env, runChild = _runChild) {
  const fieldArgs = [];
  for (const [key, value] of Object.entries(vars)) {
    fieldArgs.push("--field", `${key}=${value}`);
  }
  const result = await runChild(
    "gh",
    ["api", "graphql", "--field", `query=${query}`, ...fieldArgs],
    env,
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw Object.assign(new Error(`gh api graphql failed: ${detail}`), { code: "GH_API_ERROR" });
  }
  const payload = parseJsonText(result.stdout);
  if (payload.errors && payload.errors.length > 0) {
    throw Object.assign(
      new Error(`GraphQL errors: ${payload.errors.map((e) => e.message).join("; ")}`),
      { code: "GRAPHQL_ERROR" },
    );
  }
  return payload;
}

// ── Query/mutation fragments ────────────────────────────────────────────

const GET_USER_ID = [
  "query($login:String!) {",
  "  user(login:$login) {",
  "    id",
  "  }",
  "}"
].join("\n");

const GET_ORG_ID = [
  "query($login:String!) {",
  "  organization(login:$login) {",
  "    id",
  "  }",
  "}"
].join("\n");

const LIST_USER_PROJECTS = [
  "query($login:String!, $after:String) {",
  "  user(login:$login) {",
  "    projectsV2(first:50, after:$after) {",
  "      pageInfo {",
  "        hasNextPage",
  "        endCursor",
  "      }",
  "      nodes {",
  "        id",
  "        number",
  "        title",
  "        url",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

const LIST_ORG_PROJECTS = [
  "query($login:String!, $after:String) {",
  "  organization(login:$login) {",
  "    projectsV2(first:50, after:$after) {",
  "      pageInfo {",
  "        hasNextPage",
  "        endCursor",
  "      }",
  "      nodes {",
  "        id",
  "        number",
  "        title",
  "        url",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

const CREATE_PROJECT = [
  "mutation($ownerId:ID!, $title:String!) {",
  "  createProjectV2(input:{ownerId:$ownerId, title:$title}) {",
  "    projectV2 {",
  "      id",
  "      number",
  "      title",
  "      url",
  "    }",
  "  }",
  "}"
].join("\n");

const GET_PROJECT_FIELDS = [
  "query($projectId:ID!, $after:String) {",
  "  node(id:$projectId) {",
  "    ... on ProjectV2 {",
  "      fields(first:50, after:$after) {",
  "        pageInfo {",
  "          hasNextPage",
  "          endCursor",
  "        }",
  "        nodes {",
  "          ... on ProjectV2SingleSelectField {",
  "            id",
  "            name",
  "            options {",
  "              id",
  "              name",
  "            }",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

const CREATE_SINGLE_SELECT_FIELD = [
  "mutation($projectId:ID!) {",
  "  createProjectV2Field(input:{projectId:$projectId, dataType:SINGLE_SELECT, name:\"Status\", singleSelectOptions:[",
  "    {name:\"Backlog\",color:GRAY,description:\"\"},",
  "    {name:\"Next Up\",color:BLUE,description:\"\"},",
  "    {name:\"In Progress\",color:YELLOW,description:\"\"},",
  "    {name:\"Done\",color:GREEN,description:\"\"}",
  "  ]}) {",
  "    projectV2Field {",
  "      ... on ProjectV2SingleSelectField {",
  "        id",
  "        name",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

const LINK_PROJECT_TO_REPO = [
  "mutation($projectId:ID!, $repositoryId:ID!) {",
  "  linkProjectV2ToRepository(input:{projectId:$projectId, repositoryId:$repositoryId}) {",
  "    clientMutationId",
  "  }",
  "}"
].join("\n");

const UPDATE_PROJECT_FIELD = [
  "mutation($fieldId:ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {",
  "  updateProjectV2Field(input:{fieldId:$fieldId, singleSelectOptions:$options}) {",
  "    projectV2Field {",
  "      ... on ProjectV2SingleSelectField {",
  "        id",
  "        name",
  "        options {",
  "          id",
  "          name",
  "        }",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

const GET_REPO_ID = [
  "query($owner:String!, $name:String!) {",
  "  repository(owner:$owner, name:$name) {",
  "    id",
  "  }",
  "}"
].join("\n");

// ── Owner resolution ────────────────────────────────────────────────────

async function resolveOwner(login, env, runChild) {
  // Try user first
  const userPayload = await ghGraphql(GET_USER_ID, { login }, env, runChild);
  if (userPayload?.data?.user?.id) {
    return { id: userPayload.data.user.id, kind: "user" };
  }
  // Try organization (only if user returned null — not for API errors)
  const orgPayload = await ghGraphql(GET_ORG_ID, { login }, env, runChild);
  if (orgPayload?.data?.organization?.id) {
    return { id: orgPayload.data.organization.id, kind: "org" };
  }
  throw Object.assign(
    new Error(`Could not resolve owner ID for "${login}" (not a user or organization)`),
    { code: "NO_USER_ID" },
  );
}

// ── Repository ID resolution ─────────────────────────────────────────────

async function resolveRepoId(slug, env, runChild) {
  const [owner, name] = slug.split("/");
  const payload = await ghGraphql(GET_REPO_ID, { owner, name }, env, runChild);
  if (!payload?.data?.repository?.id) {
    throw Object.assign(
      new Error(`Could not resolve repository ID for "${slug}"`),
      { code: "NO_REPO_ID" },
    );
  }
  return payload.data.repository.id;
}

// ── Paginated project listing ────────────────────────────────────────────

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

// ── Paginated field listing ──────────────────────────────────────────────

async function listAllFields(projectId, env, runChild) {
  const fields = [];
  let after = null;
  while (true) {
    const vars = { projectId };
    if (after) vars.after = after;
    const payload = await ghGraphql(GET_PROJECT_FIELDS, vars, env, runChild);
    const connection = payload?.data?.node?.fields;
    const nodes = connection?.nodes ?? [];
    fields.push(...nodes);
    const pageInfo = connection?.pageInfo ?? {};
    if (!pageInfo.hasNextPage) break;
    if (!pageInfo.endCursor) {
      throw Object.assign(
        new Error("Invalid fields payload: hasNextPage is true but endCursor is missing"),
        { code: "GH_API_ERROR" },
      );
    }
    after = pageInfo.endCursor;
  }
  return fields;
}

// ── Column auto-repair ───────────────────────────────────────────────────

const STANDARD_COLUMNS = [
  { name: "Backlog", color: "GRAY", description: "" },
  { name: "Next Up", color: "BLUE", description: "" },
  { name: "In Progress", color: "YELLOW", description: "" },
  { name: "Done", color: "GREEN", description: "" },
];

const STANDARD_COLUMN_NAMES = STANDARD_COLUMNS.map((c) => c.name);

/**
 * Auto-repair a Status field that is missing standard columns.
 *
 * Calls updateProjectV2Field to add missing columns while preserving
 * any existing (non-standard) columns in their current order.
 *
 * Returns the updated field options (with IDs from the mutation response).
 */
async function autoRepairColumns(
  fieldId,
  existingOptions,
  env,
  runChild,
) {
  const existingNames = new Set(existingOptions.map((o) => o.name));
  const missingColumns = STANDARD_COLUMNS.filter(
    (c) => !existingNames.has(c.name),
  );

  if (missingColumns.length === 0) {
    // Nothing to repair — should not be called in this case
    return existingOptions;
  }

  // Build full option list: existing options + missing standard columns appended
  const fullOptions = [
    ...existingOptions.map((o) => ({ name: o.name, color: o.color ?? "GRAY", description: o.description ?? "" })),
    ...missingColumns,
  ];

  const payload = await ghGraphql(UPDATE_PROJECT_FIELD, {
    fieldId,
    options: JSON.stringify(fullOptions),
  }, env, runChild);

  const updatedField = payload?.data?.updateProjectV2Field?.projectV2Field;
  if (!updatedField) {
    throw Object.assign(
      new Error("Failed to update Status field with missing columns"),
      { code: "UPDATE_FIELD_FAILED" },
    );
  }

  return updatedField.options ?? fullOptions;
}

// ── Exit code classification ────────────────────────────────────────────

function classifyExitCode(err) {
  if (err.code === "INVALID_REPO") return 1;
  if (err.code === "MISSING_COLUMNS") return 3;
  return 2;
}

// ── Main logic ──────────────────────────────────────────────────────────

async function main(args, { env = process.env, runChild } = {}) {
  const child = runChild ?? _runChild;
  const repo = validateRepo(args.repo);
  const [owner] = repo.split("/");
  const title = args.title || "Dev Loop Queue";
  const linkRepo = args.linkRepo || null;
  if (linkRepo) validateRepo(linkRepo); // validate format early

  // 1. Resolve owner (user or org)
  const { id: ownerId, kind: ownerKind } = await resolveOwner(owner, env, child);

  // 2. Look for existing project by title (paginated)
  const projects = await listAllProjects(owner, ownerKind, env, child);
  let project = projects.find((p) => p.title === title);

  if (project) {
    // Project exists — verify Status field (paginated)
    const fieldNodes = await listAllFields(project.id, env, child);
    const statusField = fieldNodes.find(
      (f) => f.name === "Status" && f.options,
    );

    const existingColumns = statusField?.options?.map((o) => o.name) ?? [];
    const missingColumns = STANDARD_COLUMN_NAMES.filter((c) => !existingColumns.includes(c));

    if (statusField && missingColumns.length === 0) {
      // All columns present — check repo link if requested
      let linkedRepo = null;
      if (linkRepo) {
        const repoId = await resolveRepoId(linkRepo, env, child);
        await ghGraphql(LINK_PROJECT_TO_REPO, {
          projectId: project.id,
          repositoryId: repoId,
        }, env, child);
        linkedRepo = linkRepo;
      }
      return {
        ok: true,
        project: {
          id: project.id,
          number: project.number,
          title: project.title,
          url: project.url,
          statusFieldId: statusField.id,
          ...(linkedRepo ? { linkedRepo } : {}),
        },
      };
    }

    if (statusField) {
      // Auto-repair: add missing columns instead of throwing
      await autoRepairColumns(statusField.id, statusField.options, env, child);

      let linkedRepo = null;
      if (linkRepo) {
        const repoId = await resolveRepoId(linkRepo, env, child);
        await ghGraphql(LINK_PROJECT_TO_REPO, {
          projectId: project.id,
          repositoryId: repoId,
        }, env, child);
        linkedRepo = linkRepo;
      }
      return {
        ok: true,
        project: {
          id: project.id,
          number: project.number,
          title: project.title,
          url: project.url,
          statusFieldId: statusField.id,
          ...(linkedRepo ? { linkedRepo } : {}),
        },
      };
    }

    // No Status field — create it
    const createFieldPayload = await ghGraphql(CREATE_SINGLE_SELECT_FIELD, {
      projectId: project.id,
    }, env, child);
    const newField = createFieldPayload?.data?.createProjectV2Field?.projectV2Field;
    if (!newField) {
      throw Object.assign(new Error("Failed to create Status field"), { code: "CREATE_FIELD_FAILED" });
    }

    let linkedRepo = null;
    if (linkRepo) {
      const repoId = await resolveRepoId(linkRepo, env, child);
      await ghGraphql(LINK_PROJECT_TO_REPO, {
        projectId: project.id,
        repositoryId: repoId,
      }, env, child);
      linkedRepo = linkRepo;
    }
    return {
      ok: true,
      project: {
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        statusFieldId: newField.id,
        ...(linkedRepo ? { linkedRepo } : {}),
      },
    };
  }

  // 3. Create project
  const createPayload = await ghGraphql(CREATE_PROJECT, {
    ownerId,
    title,
  }, env, child);
  project = createPayload?.data?.createProjectV2?.projectV2;
  if (!project) {
    throw Object.assign(new Error("Failed to create project board"), { code: "CREATE_PROJECT_FAILED" });
  }

  // 4. Link to repo if --link-repo provided
  let linkedRepo = null;
  if (linkRepo) {
    const repoId = await resolveRepoId(linkRepo, env, child);
    await ghGraphql(LINK_PROJECT_TO_REPO, {
      projectId: project.id,
      repositoryId: repoId,
    }, env, child);
    linkedRepo = linkRepo;
  }

  // 5. Create Status field on new project
  const createFieldPayload = await ghGraphql(CREATE_SINGLE_SELECT_FIELD, {
    projectId: project.id,
  }, env, child);
  const newField = createFieldPayload?.data?.createProjectV2Field?.projectV2Field;
  if (!newField) {
    throw Object.assign(new Error("Failed to create Status field on new project"), { code: "CREATE_FIELD_FAILED" });
  }

  return {
    ok: true,
    project: {
      id: project.id,
      number: project.number,
      title: project.title,
      url: project.url,
      statusFieldId: newField.id,
      ...(linkedRepo ? { linkedRepo } : {}),
    },
  };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────

async function runCli(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${formatCliError(err)}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    stdout.write(USAGE);
    return;
  }

  // Settings-based fallback for --project
  if (args.project === undefined) {
    const settings = resolveSettings(cwd);
    if (settings?.project) {
      args.project = settings.project;
    } else if (settings?.title) {
      args.title = args.title || settings.title;
    }
  }

  try {
    const result = await main(args, { env });
    stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    stderr.write(`${formatCliError(err)}\n`);
    process.exitCode = classifyExitCode(err);
  }
}

if (isDirectCliRun(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 2;
  });
}

export { main, autoRepairColumns, resolveSettings, STANDARD_COLUMNS, STANDARD_COLUMN_NAMES };

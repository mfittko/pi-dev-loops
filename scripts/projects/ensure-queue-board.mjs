#!/usr/bin/env node
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { runChild as _runChild } from "../_cli-primitives.mjs";

const USAGE = `Usage: node scripts/projects/ensure-queue-board.mjs --repo <owner/name> [--title <title>]

Idempotent bootstrap for a GitHub Projects V2 board used as the dev-loop queue.

Creates the project board if it doesn't exist, ensures a Status field with
standard columns (Backlog, Next Up, In Progress, Done). Exits clean if the
board and Status field already exist.

Output (stdout):
  JSON: { ok: true, project: { id, number, title, url, statusFieldId } }

Exit codes:
  0 — board exists or was created successfully (idempotent)
  1 — usage or argument error
  2 — GitHub API error
  3 — board schema/config mismatch (manual reconciliation needed)
`;

const VALID_ARGS = new Set(["--repo", "--title", "--help", "-h"]);

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
    } else if (arg === "--title") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw Object.assign(
          new Error("--title requires a value"),
          { code: "INVALID_REPO", usage: USAGE },
        );
      }
      args.title = argv[++i];
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
// no leading/trailing dash, no consecutive dashes.
// Single-char owner/repo names are valid (e.g. a/b).
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
  "mutation($input:CreateProjectV2Input!) {",
  "  createProjectV2(input:$input) {",
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
  "mutation($input:CreateProjectV2FieldInput!) {",
  "  createProjectV2Field(input:$input) {",
  "    projectV2Field {",
  "      ... on ProjectV2SingleSelectField {",
  "        id",
  "        name",
  "      }",
  "    }",
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

    const expectedColumns = ["Backlog", "Next Up", "In Progress", "Done"];
    const existingColumns = statusField?.options?.map((o) => o.name) ?? [];
    const missingColumns = expectedColumns.filter((c) => !existingColumns.includes(c));

    if (statusField && missingColumns.length === 0) {
      return {
        ok: true,
        project: {
          id: project.id,
          number: project.number,
          title: project.title,
          url: project.url,
          statusFieldId: statusField.id,
        },
      };
    }

    if (statusField) {
      throw Object.assign(
        new Error(
          `Project "${title}" (number ${project.number}) exists but Status field missing columns: ${missingColumns.join(", ")}. ` +
          "Add missing columns via GitHub UI or reconcile manually.",
        ),
        { code: "MISSING_COLUMNS" },
      );
    }

    // No Status field — create it
    const createFieldPayload = await ghGraphql(CREATE_SINGLE_SELECT_FIELD, {
      input: JSON.stringify({
        projectId: project.id,
        dataType: "SINGLE_SELECT",
        name: "Status",
        singleSelectOptions: [
          { name: "Backlog", color: "GRAY" },
          { name: "Next Up", color: "BLUE" },
          { name: "In Progress", color: "YELLOW" },
          { name: "Done", color: "GREEN" },
        ],
      }),
    }, env, child);
    const newField = createFieldPayload?.data?.createProjectV2Field?.projectV2Field;
    if (!newField) {
      throw Object.assign(new Error("Failed to create Status field"), { code: "CREATE_FIELD_FAILED" });
    }
    return {
      ok: true,
      project: {
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        statusFieldId: newField.id,
      },
    };
  }

  // 3. Create project
  const createPayload = await ghGraphql(CREATE_PROJECT, {
    input: JSON.stringify({ ownerId, title }),
  }, env, child);
  project = createPayload?.data?.createProjectV2?.projectV2;
  if (!project) {
    throw Object.assign(new Error("Failed to create project board"), { code: "CREATE_PROJECT_FAILED" });
  }

  // 4. Create Status field on new project
  const createFieldPayload = await ghGraphql(CREATE_SINGLE_SELECT_FIELD, {
    input: JSON.stringify({
      projectId: project.id,
      dataType: "SINGLE_SELECT",
      name: "Status",
      singleSelectOptions: [
        { name: "Backlog", color: "GRAY" },
        { name: "Next Up", color: "BLUE" },
        { name: "In Progress", color: "YELLOW" },
        { name: "Done", color: "GREEN" },
      ],
    }),
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
    },
  };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────

async function runCli(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
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

export { main };

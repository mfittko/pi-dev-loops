#!/usr/bin/env node
import { buildParseError, formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
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
`;

function parseArgs(argv) {
  const args = { title: "Dev Loop Queue" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      args.repo = argv[++i];
    } else if (argv[i] === "--title" && i + 1 < argv.length) {
      args.title = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    }
  }
  return args;
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

const LIST_PROJECTS = [
  "query($login:String!) {",
  "  user(login:$login) {",
  "    projectsV2(first:50) {",
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
  "query($projectId:ID!) {",
  "  node(id:$projectId) {",
  "    ... on ProjectV2 {",
  "      fields(first:50) {",
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

// ── Main logic ──────────────────────────────────────────────────────────

async function main(args, { env = process.env, runChild } = {}) {
  const child = runChild ?? _runChild;
  const repo = args.repo;
  if (!repo || typeof repo !== "string" || !repo.includes("/")) {
    throw Object.assign(
      new Error(`--repo is required and must be owner/name, got "${repo}"`),
      { code: "INVALID_REPO" },
    );
  }
  const [owner] = repo.split("/");
  const title = args.title || "Dev Loop Queue";

  // 1. Resolve owner ID
  const userIdPayload = await ghGraphql(GET_USER_ID, { login: owner }, env, child);
  const ownerId = userIdPayload?.data?.user?.id;
  if (!ownerId) {
    throw Object.assign(
      new Error(`Could not resolve user ID for "${owner}"`),
      { code: "NO_USER_ID" },
    );
  }

  // 2. Look for existing project by title
  const listPayload = await ghGraphql(LIST_PROJECTS, { login: owner }, env, child);
  const projects = listPayload?.data?.user?.projectsV2?.nodes ?? [];
  let project = projects.find((p) => p.title === title);

  if (project) {
    // Project exists — verify Status field
    const fieldsPayload = await ghGraphql(GET_PROJECT_FIELDS, { projectId: project.id }, env, child);
    const fieldNodes = fieldsPayload?.data?.node?.fields?.nodes ?? [];
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
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(USAGE);
    return;
  }
  try {
    const result = await main(args, { env });
    stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    if (err.code === "INVALID_REPO") {
      stderr.write(`${formatCliError(err)}\n`);
      process.exitCode = 1;
      return;
    }
    stderr.write(`${formatCliError(err)}\n`);
    process.exitCode = 2;
  }
}

if (isDirectCliRun(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 2;
  });
}

export { main };

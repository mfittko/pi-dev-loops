#!/usr/bin/env node
import { spawn } from "node:child_process";

import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";

const INSPECT_QUERY = [
  "query($owner:String!, $name:String!, $parent:Int!, $after:String) {",
  "  repository(owner:$owner, name:$name) {",
  "    issue(number:$parent) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      subIssues(first:100, after:$after) {",
  "        pageInfo {",
  "          hasNextPage",
  "          endCursor",
  "        }",
  "        nodes {",
  "          id",
  "          number",
  "          title",
  "          url",
  "          state",
  "          repository { nameWithOwner }",
  "          parent { number }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

const RESOLVE_ADD_QUERY = [
  "query($owner:String!, $name:String!, $parent:Int!, $child:Int!) {",
  "  repository(owner:$owner, name:$name) {",
  "    parentIssue: issue(number:$parent) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "    }",
  "    childIssue: issue(number:$child) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      repository { nameWithOwner }",
  "      parent { number }",
  "    }",
  "  }",
  "}",
].join("\n");

const RESOLVE_REPRIORITIZE_BEFORE_QUERY = [
  "query($owner:String!, $name:String!, $parent:Int!, $child:Int!, $before:Int!) {",
  "  repository(owner:$owner, name:$name) {",
  "    parentIssue: issue(number:$parent) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "    }",
  "    childIssue: issue(number:$child) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      repository { nameWithOwner }",
  "      parent { number }",
  "    }",
  "    beforeIssue: issue(number:$before) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      repository { nameWithOwner }",
  "      parent { number }",
  "    }",
  "  }",
  "}",
].join("\n");

const RESOLVE_REPRIORITIZE_AFTER_QUERY = [
  "query($owner:String!, $name:String!, $parent:Int!, $child:Int!, $after:Int!) {",
  "  repository(owner:$owner, name:$name) {",
  "    parentIssue: issue(number:$parent) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "    }",
  "    childIssue: issue(number:$child) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      repository { nameWithOwner }",
  "      parent { number }",
  "    }",
  "    afterIssue: issue(number:$after) {",
  "      id",
  "      number",
  "      title",
  "      url",
  "      state",
  "      repository { nameWithOwner }",
  "      parent { number }",
  "    }",
  "  }",
  "}",
].join("\n");

const ADD_SUB_ISSUE_MUTATION = [
  "mutation($issueId:ID!, $subIssueId:ID!, $replaceParent:Boolean) {",
  "  addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: $replaceParent }) {",
  "    clientMutationId",
  "  }",
  "}",
].join("\n");

const REPRIORITIZE_SUB_ISSUE_BEFORE_MUTATION = [
  "mutation($issueId:ID!, $subIssueId:ID!, $beforeId:ID!) {",
  "  reprioritizeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, beforeId: $beforeId }) {",
  "    clientMutationId",
  "  }",
  "}",
].join("\n");

const REPRIORITIZE_SUB_ISSUE_AFTER_MUTATION = [
  "mutation($issueId:ID!, $subIssueId:ID!, $afterId:ID!) {",
  "  reprioritizeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, afterId: $afterId }) {",
  "    clientMutationId",
  "  }",
  "}",
].join("\n");

const USAGE = `Usage:
  sub-issue-tree.mjs inspect --repo <owner/name> --issue <number>
  sub-issue-tree.mjs add --repo <owner/name> --parent <number> --child <number> [--replace-parent]
  sub-issue-tree.mjs reprioritize --repo <owner/name> --parent <number> --child <number> (--after <number> | --before <number>)
  sub-issue-tree.mjs verify --repo <owner/name> --parent <number> --expect-children <n1,n2,...>

Read, mutate, and verify a GitHub sub-issue tree through thin deterministic helpers.
Keep issue creation on existing \`gh issue create\`; use this helper for tree ownership.

Commands:
  inspect         Print the current parent/sub-issue tree as JSON.
  add             Attach an existing child issue to a parent issue.
  reprioritize    Move an attached sub-issue before or after another attached sub-issue.
  verify          Compare the current tree order to an expected exact child order.

Required:
  --repo <owner/name>         Repository slug (e.g. owner/repo)

inspect:
  --issue <number>            Parent issue number to inspect

add:
  --parent <number>           Parent issue number
  --child <number>            Existing child issue number
  --replace-parent            Allow replacing an existing different parent

reprioritize:
  --parent <number>           Parent issue number
  --child <number>            Existing attached child issue number
  --after <number>            Move child after this attached sibling
  --before <number>           Move child before this attached sibling

verify:
  --parent <number>           Parent issue number
  --expect-children <list>    Exact expected child order, e.g. 123,124,125

Success output (stdout, JSON):
  inspect:
    {
      "ok": true,
      "repo": "owner/name",
      "parent": { "number": 97, "title": "...", "url": "...", "state": "OPEN" },
      "subIssues": [
        { "number": 123, "title": "...", "url": "...", "state": "OPEN", "parentNumber": 97, "position": 1 }
      ],
      "summary": { "total": 1, "completed": 0, "percentCompleted": 0 }
    }
  add / reprioritize:
    { "ok": true, "action": "add|reprioritize", ...inspect output }
  verify:
    {
      "ok": true,
      "action": "verify",
      "repo": "owner/name",
      "parent": { "number": 97, "title": "...", "url": "...", "state": "OPEN" },
      "matches": true|false,
      "expectedOrder": [123, 124],
      "actualOrder": [123, 124],
      "missing": [],
      "unexpected": [],
      "misordered": []
    }

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw parseError(`Missing value for ${flag}`);
  }

  return value;
}

function parsePositiveInt(flag, value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw parseError(`${flag} must be a positive integer`);
  }

  return Number(value);
}

function parseCommaSeparatedIssueNumbers(value) {
  const tokens = value.split(",").map((entry) => entry.trim()).filter(Boolean);

  if (tokens.length === 0) {
    throw parseError("--expect-children must include at least one issue number");
  }

  return tokens.map((token) => parsePositiveInt("--expect-children", token));
}

export function parseSubIssueTreeCliArgs(argv) {
  const args = [...argv];
  const command = args.shift();

  if (command === undefined || command === "--help" || command === "-h") {
    return { help: true };
  }

  if (!["inspect", "add", "reprioritize", "verify"].includes(command)) {
    throw parseError(`Unknown command: ${command}`);
  }

  const options = {
    help: false,
    command,
    repo: undefined,
    issue: undefined,
    parent: undefined,
    child: undefined,
    replaceParent: false,
    before: undefined,
    after: undefined,
    expectChildren: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo").trim();
      continue;
    }

    if (token === "--issue") {
      options.issue = parsePositiveInt("--issue", requireOptionValue(args, "--issue"));
      continue;
    }

    if (token === "--parent") {
      options.parent = parsePositiveInt("--parent", requireOptionValue(args, "--parent"));
      continue;
    }

    if (token === "--child") {
      options.child = parsePositiveInt("--child", requireOptionValue(args, "--child"));
      continue;
    }

    if (token === "--before") {
      options.before = parsePositiveInt("--before", requireOptionValue(args, "--before"));
      continue;
    }

    if (token === "--after") {
      options.after = parsePositiveInt("--after", requireOptionValue(args, "--after"));
      continue;
    }

    if (token === "--expect-children") {
      options.expectChildren = parseCommaSeparatedIssueNumbers(requireOptionValue(args, "--expect-children"));
      continue;
    }

    if (token === "--replace-parent") {
      options.replaceParent = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (typeof options.repo !== "string") {
    throw parseError(`${command} requires --repo <owner/name>`);
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  if (command === "inspect") {
    if (options.issue === undefined) {
      throw parseError("inspect requires --issue <number>");
    }

    return {
      help: false,
      command,
      repo: options.repo,
      issue: options.issue,
    };
  }

  if (command === "add") {
    if (options.parent === undefined || options.child === undefined) {
      throw parseError("add requires --parent <number> and --child <number>");
    }

    return {
      help: false,
      command,
      repo: options.repo,
      parent: options.parent,
      child: options.child,
      replaceParent: options.replaceParent,
    };
  }

  if (command === "reprioritize") {
    if (options.parent === undefined || options.child === undefined) {
      throw parseError("reprioritize requires --parent <number> and --child <number>");
    }

    if ((options.before === undefined) === (options.after === undefined)) {
      throw parseError("reprioritize requires exactly one of --after <number> or --before <number>");
    }

    return {
      help: false,
      command,
      repo: options.repo,
      parent: options.parent,
      child: options.child,
      before: options.before,
      after: options.after,
    };
  }

  if (options.parent === undefined || options.expectChildren === undefined) {
    throw parseError("verify requires --parent <number> and --expect-children <n1,n2,...>");
  }

  return {
    help: false,
    command,
    repo: options.repo,
    parent: options.parent,
    expectChildren: options.expectChildren,
  };
}

function runChild(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function buildGraphqlArgs(query, fields = []) {
  const args = [
    "api",
    "graphql",
    "--field",
    `query=${query}`,
  ];

  for (const field of fields) {
    if (!field || typeof field !== "object") {
      continue;
    }

    const { mode = "field", name, value } = field;
    if (typeof name !== "string" || name.length === 0) {
      continue;
    }

    const flag = mode === "typed" ? "-F" : "--field";
    args.push(flag, `${name}=${value}`);
  }

  return args;
}

async function runGhJson(args, env) {
  const result = await runChild("gh", args, env);

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr.length > 0 ? stderr : `gh exited with code ${result.code}`);
  }

  return parseJsonText(result.stdout);
}

function readIssueNode(payload, pathDescription) {
  const issue = payload?.data?.repository?.issue;

  if (!issue || typeof issue !== "object") {
    throw new Error(`Invalid sub-issue-tree GraphQL payload: missing ${pathDescription}`);
  }

  return issue;
}

function readAliasedIssueNode(payload, alias) {
  const issue = payload?.data?.repository?.[alias];

  if (issue === null) {
    return null;
  }

  if (!issue || typeof issue !== "object") {
    throw new Error(`Invalid sub-issue-tree GraphQL payload: missing data.repository.${alias}`);
  }

  return issue;
}

function normalizeIssueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
  };
}

function normalizeSubIssue(issue, index) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    parentNumber: issue?.parent?.number ?? null,
    position: index + 1,
  };
}

function readInspectConnection(payload) {
  const issue = readIssueNode(payload, "data.repository.issue");
  const connection = issue?.subIssues;

  if (!connection || typeof connection !== "object") {
    throw new Error("Invalid sub-issue-tree GraphQL payload: missing data.repository.issue.subIssues");
  }

  const pageInfo = connection.pageInfo ?? {};

  return {
    issue,
    nodes: Array.isArray(connection.nodes) ? connection.nodes : [],
    hasNextPage: Boolean(pageInfo.hasNextPage),
    endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
  };
}

async function inspectSubIssueTree({ repo, parent, env }) {
  const { owner, name } = parseRepoSlug(repo);
  const nodes = [];
  let parentIssue = null;
  let after = null;

  for (;;) {
    const payload = await runGhJson(buildGraphqlArgs(INSPECT_QUERY, [
      { name: "owner", value: owner },
      { name: "name", value: name },
      { mode: "typed", name: "parent", value: parent },
      ...(after ? [{ name: "after", value: after }] : []),
    ]), env);
    const connection = readInspectConnection(payload);

    if (parentIssue === null) {
      parentIssue = connection.issue;
    }

    nodes.push(...connection.nodes);

    if (!connection.hasNextPage) {
      break;
    }

    if (connection.endCursor === null) {
      throw new Error("Invalid sub-issue-tree GraphQL payload: missing endCursor for next page");
    }

    after = connection.endCursor;
  }

  if (parentIssue === null) {
    throw new Error(`Could not resolve issue #${parent} in ${repo}`);
  }

  const normalizedSubIssues = nodes.map((node, index) => normalizeSubIssue(node, index));
  const completed = normalizedSubIssues.filter((entry) => entry.state === "CLOSED").length;
  const total = normalizedSubIssues.length;

  return {
    ok: true,
    repo,
    parent: normalizeIssueSummary(parentIssue),
    subIssues: normalizedSubIssues,
    summary: {
      total,
      completed,
      percentCompleted: total === 0 ? 0 : Math.round((completed / total) * 100),
    },
  };
}

function ensureIssueResolved(issue, number, role, repo) {
  if (!issue) {
    throw new Error(`Could not resolve ${role} issue #${number} in ${repo}`);
  }

  return issue;
}

async function resolveAddTargets({ repo, parent, child, env }) {
  const { owner, name } = parseRepoSlug(repo);
  const payload = await runGhJson(buildGraphqlArgs(RESOLVE_ADD_QUERY, [
    { name: "owner", value: owner },
    { name: "name", value: name },
    { mode: "typed", name: "parent", value: parent },
    { mode: "typed", name: "child", value: child },
  ]), env);

  return {
    parentIssue: ensureIssueResolved(readAliasedIssueNode(payload, "parentIssue"), parent, "parent", repo),
    childIssue: ensureIssueResolved(readAliasedIssueNode(payload, "childIssue"), child, "child", repo),
  };
}

async function resolveReprioritizeTargets({ repo, parent, child, before, after, env }) {
  const { owner, name } = parseRepoSlug(repo);
  const usesBefore = before !== undefined;
  const payload = await runGhJson(buildGraphqlArgs(
    usesBefore ? RESOLVE_REPRIORITIZE_BEFORE_QUERY : RESOLVE_REPRIORITIZE_AFTER_QUERY,
    [
      { name: "owner", value: owner },
      { name: "name", value: name },
      { mode: "typed", name: "parent", value: parent },
      { mode: "typed", name: "child", value: child },
      usesBefore
        ? { mode: "typed", name: "before", value: before }
        : { mode: "typed", name: "after", value: after },
    ],
  ), env);

  return {
    parentIssue: ensureIssueResolved(readAliasedIssueNode(payload, "parentIssue"), parent, "parent", repo),
    childIssue: ensureIssueResolved(readAliasedIssueNode(payload, "childIssue"), child, "child", repo),
    referenceIssue: ensureIssueResolved(
      readAliasedIssueNode(payload, usesBefore ? "beforeIssue" : "afterIssue"),
      usesBefore ? before : after,
      usesBefore ? "before" : "after",
      repo,
    ),
    referenceKey: usesBefore ? "beforeId" : "afterId",
  };
}

function ensureAttachedToParent(issue, parent, role) {
  if (issue?.parent?.number !== parent) {
    throw new Error(`Issue #${issue?.number ?? "?"} must already be attached to parent #${parent} for ${role}`);
  }
}

async function addSubIssue({ repo, parent, child, replaceParent, env }) {
  const { parentIssue, childIssue } = await resolveAddTargets({ repo, parent, child, env });
  const currentParent = childIssue?.parent?.number ?? null;

  if (currentParent !== null && currentParent !== parent && !replaceParent) {
    throw new Error(`Issue #${child} already has parent #${currentParent}; rerun with --replace-parent to move it under #${parent}`);
  }

  if (currentParent !== parent) {
    await runGhJson(buildGraphqlArgs(ADD_SUB_ISSUE_MUTATION, [
      { name: "issueId", value: parentIssue.id },
      { name: "subIssueId", value: childIssue.id },
      { mode: "typed", name: "replaceParent", value: replaceParent ? "true" : "false" },
    ]), env);
  }

  const tree = await inspectSubIssueTree({ repo, parent, env });

  return {
    ...tree,
    action: "add",
  };
}

async function reprioritizeSubIssue({ repo, parent, child, before, after, env }) {
  const { parentIssue, childIssue, referenceIssue, referenceKey } = await resolveReprioritizeTargets({
    repo,
    parent,
    child,
    before,
    after,
    env,
  });

  ensureAttachedToParent(childIssue, parent, "reprioritize");
  ensureAttachedToParent(referenceIssue, parent, "reprioritize reference");

  if (childIssue.number === referenceIssue.number) {
    throw new Error("reprioritize requires the child and reference issue numbers to differ");
  }

  await runGhJson(buildGraphqlArgs(
    referenceKey === "beforeId"
      ? REPRIORITIZE_SUB_ISSUE_BEFORE_MUTATION
      : REPRIORITIZE_SUB_ISSUE_AFTER_MUTATION,
    [
      { name: "issueId", value: parentIssue.id },
      { name: "subIssueId", value: childIssue.id },
      { name: referenceKey, value: referenceIssue.id },
    ],
  ), env);

  const tree = await inspectSubIssueTree({ repo, parent, env });

  return {
    ...tree,
    action: "reprioritize",
  };
}

export function compareExpectedSubIssueTree(tree, expectedOrder) {
  const actualOrder = Array.isArray(tree?.subIssues)
    ? tree.subIssues.map((entry) => entry.number)
    : [];
  const expectedSet = new Set(expectedOrder);
  const actualSet = new Set(actualOrder);
  const missing = expectedOrder.filter((number) => !actualSet.has(number));
  const unexpected = actualOrder.filter((number) => !expectedSet.has(number));
  const misordered = [];

  for (const number of expectedOrder) {
    if (!actualSet.has(number)) {
      continue;
    }

    const expectedIndex = expectedOrder.indexOf(number) + 1;
    const actualIndex = actualOrder.indexOf(number) + 1;

    if (expectedIndex !== actualIndex) {
      misordered.push({ number, expectedIndex, actualIndex });
    }
  }

  return {
    matches: missing.length === 0 && unexpected.length === 0 && misordered.length === 0,
    expectedOrder: [...expectedOrder],
    actualOrder,
    missing,
    unexpected,
    misordered,
  };
}

async function verifySubIssueTree({ repo, parent, expectChildren, env }) {
  const tree = await inspectSubIssueTree({ repo, parent, env });
  const comparison = compareExpectedSubIssueTree(tree, expectChildren);

  return {
    ok: true,
    action: "verify",
    repo,
    parent: tree.parent,
    ...comparison,
  };
}

export async function runSubIssueTreeCli(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout } = {}) {
  const options = parseSubIssueTreeCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  let result;
  if (options.command === "inspect") {
    result = await inspectSubIssueTree({ repo: options.repo, parent: options.issue, env });
  } else if (options.command === "add") {
    result = await addSubIssue({ ...options, env });
  } else if (options.command === "reprioritize") {
    result = await reprioritizeSubIssue({ ...options, env });
  } else {
    result = await verifySubIssueTree({ ...options, env });
  }

  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runSubIssueTreeCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

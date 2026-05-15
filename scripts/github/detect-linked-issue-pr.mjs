#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "./capture-review-threads.mjs";

export const LINKED_ISSUE_PR_QUERY = [
  "query($owner:String!, $name:String!, $issue:Int!, $after:String) {",
  "  repository(owner:$owner, name:$name) {",
  "    issue(number:$issue) {",
  "      timelineItems(first:100, after:$after, itemTypes:[CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {",
  "        pageInfo {",
  "          hasNextPage",
  "          endCursor",
  "        }",
  "        nodes {",
  "          __typename",
  "          ... on ConnectedEvent {",
  "            createdAt",
  "            subject {",
  "              __typename",
  "              ... on PullRequest {",
  "                number",
  "                state",
  "                url",
  "                repository { nameWithOwner }",
  "              }",
  "            }",
  "          }",
  "          ... on CrossReferencedEvent {",
  "            createdAt",
  "            source {",
  "              __typename",
  "              ... on PullRequest {",
  "                number",
  "                state",
  "                url",
  "                repository { nameWithOwner }",
  "              }",
  "            }",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

const USAGE = `Usage: detect-linked-issue-pr.mjs --repo <owner/name> --issue <number>

Detect whether an issue already has an open linked pull request in the same repository.
This helper owns linked-event query pagination and deterministic selection.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --issue <number>      Issue number

Success output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/name",
    "issue": 85,
    "hasOpenLinkedPr": true|false,
    "prNumber": 90|null,
    "prUrl": "..."|null,
    "selection"?: {
      "eventType": "CONNECTED_EVENT"|"CROSS_REFERENCED_EVENT",
      "eventCreatedAt": "..."
    }
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

function parseIssueNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw parseError("--issue must be a positive integer");
  }

  return Number(value);
}

export function parseDetectLinkedIssuePrCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    issue: undefined,
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
      options.issue = parseIssueNumber(requireOptionValue(args, "--issue"));
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.issue === undefined) {
    throw parseError("Linked PR detection requires both --repo <owner/name> and --issue <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
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

function buildQueryArgs({ owner, name, issue, after }) {
  const args = [
    "api",
    "graphql",
    "--field",
    `owner=${owner}`,
    "--field",
    `name=${name}`,
    "--field",
    `issue=${issue}`,
    "--field",
    `query=${LINKED_ISSUE_PR_QUERY}`,
  ];

  if (typeof after === "string" && after.length > 0) {
    args.push("--field", `after=${after}`);
  }

  return args;
}

function readTimelineConnection(payload) {
  const connection = payload?.data?.repository?.issue?.timelineItems;

  if (!connection || typeof connection !== "object") {
    throw new Error("Invalid linked-PR GraphQL payload: missing data.repository.issue.timelineItems");
  }

  const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
  const pageInfo = connection.pageInfo ?? {};

  return {
    nodes,
    hasNextPage: Boolean(pageInfo.hasNextPage),
    endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
  };
}

function normalizeLinkedPrNode(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.__typename === "ConnectedEvent") {
    return {
      eventType: "CONNECTED_EVENT",
      eventCreatedAt: node.createdAt,
      pr: node.subject,
    };
  }

  if (node.__typename === "CrossReferencedEvent") {
    return {
      eventType: "CROSS_REFERENCED_EVENT",
      eventCreatedAt: node.createdAt,
      pr: node.source,
    };
  }

  return null;
}

function normalizeOpenSameRepoCandidate(candidate, repo) {
  const pr = candidate?.pr;
  const number = pr?.number;
  const state = pr?.state;
  const url = pr?.url;
  const nameWithOwner = pr?.repository?.nameWithOwner;

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  if (state !== "OPEN" || nameWithOwner !== repo) {
    return null;
  }

  const createdAtMs = Number.parseInt(String(Date.parse(candidate.eventCreatedAt)), 10);

  return {
    prNumber: number,
    prUrl: typeof url === "string" ? url : null,
    eventType: candidate.eventType,
    eventCreatedAt: typeof candidate.eventCreatedAt === "string" ? candidate.eventCreatedAt : null,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Number.NEGATIVE_INFINITY,
  };
}

export function selectLinkedIssuePr(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftPriority = left.eventType === "CONNECTED_EVENT" ? 0 : 1;
    const rightPriority = right.eventType === "CONNECTED_EVENT" ? 0 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.createdAtMs !== right.createdAtMs) {
      return right.createdAtMs - left.createdAtMs;
    }

    if (left.prNumber !== right.prNumber) {
      return right.prNumber - left.prNumber;
    }

    return String(left.prUrl ?? "").localeCompare(String(right.prUrl ?? ""));
  });

  return sorted[0] ?? null;
}

export async function detectLinkedIssuePr({ repo, issue }, { env = process.env, ghCommand = "gh" } = {}) {
  const { owner, name } = parseRepoSlug(repo);

  const candidates = [];
  let after = null;

  while (true) {
    const result = await runChild(
      ghCommand,
      buildQueryArgs({ owner, name, issue, after }),
      env,
    );

    if (result.code !== 0) {
      const detail = result.stderr.trim() || `exit code ${result.code}`;
      throw new Error(`gh command failed: ${detail}`);
    }

    const payload = parseJsonText(result.stdout);
    const { nodes, hasNextPage, endCursor } = readTimelineConnection(payload);

    for (const node of nodes) {
      const normalizedNode = normalizeLinkedPrNode(node);
      if (!normalizedNode) {
        continue;
      }

      const normalizedCandidate = normalizeOpenSameRepoCandidate(normalizedNode, repo);
      if (normalizedCandidate) {
        candidates.push(normalizedCandidate);
      }
    }

    if (!hasNextPage) {
      break;
    }

    if (!endCursor) {
      throw new Error("Invalid linked-PR GraphQL payload: pageInfo.hasNextPage is true but endCursor is missing");
    }

    after = endCursor;
  }

  const selected = selectLinkedIssuePr(candidates);

  if (!selected) {
    return {
      ok: true,
      repo,
      issue,
      hasOpenLinkedPr: false,
      prNumber: null,
      prUrl: null,
    };
  }

  return {
    ok: true,
    repo,
    issue,
    hasOpenLinkedPr: true,
    prNumber: selected.prNumber,
    prUrl: selected.prUrl,
    selection: {
      eventType: selected.eventType,
      eventCreatedAt: selected.eventCreatedAt,
    },
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, env = process.env, ghCommand = "gh" } = {},
) {
  const options = parseDetectLinkedIssuePrCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await detectLinkedIssuePr(
    { repo: options.repo, issue: options.issue },
    { env, ghCommand },
  );

  stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

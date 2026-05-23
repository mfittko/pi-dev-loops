#!/usr/bin/env node
import { spawn } from "node:child_process";

import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../github/_github-helpers.mjs";
import { detectLinkedIssuePr } from "../github/detect-linked-issue-pr.mjs";

const USAGE = `Usage: detect-initial-copilot-pr-state.mjs --repo <owner/name> --issue <number>

Detect whether an assigned issue is still on the bootstrap-only Copilot draft PR
or has moved into normal linked-PR follow-up.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --issue <number>      Issue number

States:
  no_linked_pr
  waiting_for_initial_copilot_implementation
  linked_pr_ready_for_followup

Success output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/name",
    "issue": 59,
    "state": "no_linked_pr"|"waiting_for_initial_copilot_implementation"|"linked_pr_ready_for_followup",
    "prNumber": 79|null,
    "prUrl": "..."|null,
    "isDraft": true|false|null,
    "changedFiles": 0|null,
    "commitCount": 1|null,
    "soleCommitHeadline": "Initial plan"|null,
    "authorLogin": "Copilot"|null
  }

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  gh/runtime failures:
    { "ok": false, "error": "..." }`.trim();

export const LINKED_PR_STATE = Object.freeze({
  NO_LINKED_PR: "no_linked_pr",
  WAITING_FOR_INITIAL_COPILOT_IMPLEMENTATION: "waiting_for_initial_copilot_implementation",
  LINKED_PR_READY_FOR_FOLLOWUP: "linked_pr_ready_for_followup",
});

const INITIAL_COPILOT_PR_FACTS_QUERY = [
  "query($owner:String!, $name:String!, $pr:Int!) {",
  "  repository(owner:$owner, name:$name) {",
  "    pullRequest(number:$pr) {",
  "      number",
  "      url",
  "      state",
  "      isDraft",
  "      changedFiles",
  "      repository { nameWithOwner }",
  "      author {",
  "        __typename",
  "        login",
  "      }",
  "      commits(first: 2) {",
  "        totalCount",
  "        nodes {",
  "          commit {",
  "            messageHeadline",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

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

export function parseDetectInitialCopilotPrStateCliArgs(argv) {
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
    throw parseError("detect-initial-copilot-pr-state requires both --repo <owner/name> and --issue <number>");
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

function buildQueryArgs({ owner, name, pr }) {
  return [
    "api",
    "graphql",
    "--field",
    `owner=${owner}`,
    "--field",
    `name=${name}`,
    "-F",
    `pr=${pr}`,
    "--field",
    `query=${INITIAL_COPILOT_PR_FACTS_QUERY}`,
  ];
}

function getRequiredString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required PR facts: ${fieldName}`);
  }

  return value;
}

function getRequiredBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`Missing required PR facts: ${fieldName}`);
  }

  return value;
}

function getRequiredNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Missing required PR facts: ${fieldName}`);
  }

  return value;
}

function getRequiredPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Missing required PR facts: ${fieldName}`);
  }

  return value;
}

function normalizeRepoForComparison(repo) {
  return typeof repo === "string" ? repo.trim().toLowerCase() : "";
}

function isCopilotAuthored(authorLogin) {
  const normalized = String(authorLogin).trim().toLowerCase();
  return normalized === "copilot"
    || normalized === "app/copilot-swe-agent"
    || normalized === "copilot-swe-agent[bot]";
}

function classifyInitialCopilotPrState({ repo, facts }) {
  const isBootstrapOnly = facts.state === "OPEN"
    && normalizeRepoForComparison(facts.repository) === normalizeRepoForComparison(repo)
    && facts.isDraft
    && isCopilotAuthored(facts.authorLogin)
    && facts.commitCount === 1
    && facts.changedFiles === 0
    && facts.soleCommitHeadline === "Initial plan";

  return isBootstrapOnly
    ? LINKED_PR_STATE.WAITING_FOR_INITIAL_COPILOT_IMPLEMENTATION
    : LINKED_PR_STATE.LINKED_PR_READY_FOR_FOLLOWUP;
}

async function fetchLinkedPrFacts({ repo, prNumber }, { env, ghCommand }) {
  const { owner, name } = parseRepoSlug(repo);
  const result = await runChild(
    ghCommand,
    buildQueryArgs({ owner, name, pr: prNumber }),
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  const payload = parseJsonText(result.stdout);
  const pr = payload?.data?.repository?.pullRequest;

  if (!pr || typeof pr !== "object") {
    throw new Error(`Missing required PR facts: data.repository.pullRequest for linked PR #${prNumber}`);
  }

  const commitCount = getRequiredNonNegativeInteger(pr?.commits?.totalCount, "pullRequest.commits.totalCount");
  const commitNode = Array.isArray(pr?.commits?.nodes) ? pr.commits.nodes[0] : null;

  const soleCommitHeadline = commitCount === 1
    ? getRequiredString(commitNode?.commit?.messageHeadline, "pullRequest.commits.nodes[0].commit.messageHeadline")
    : null;

  return {
    number: getRequiredPositiveInteger(pr.number, "pullRequest.number"),
    url: getRequiredString(pr.url, "pullRequest.url"),
    state: getRequiredString(pr.state, "pullRequest.state"),
    isDraft: getRequiredBoolean(pr.isDraft, "pullRequest.isDraft"),
    changedFiles: getRequiredNonNegativeInteger(pr.changedFiles, "pullRequest.changedFiles"),
    repository: getRequiredString(pr?.repository?.nameWithOwner, "pullRequest.repository.nameWithOwner"),
    authorLogin: getRequiredString(pr?.author?.login, "pullRequest.author.login"),
    commitCount,
    soleCommitHeadline,
  };
}

export async function detectInitialCopilotPrState({ repo, issue }, { env = process.env, ghCommand = "gh" } = {}) {
  const linked = await detectLinkedIssuePr({ repo, issue }, { env, ghCommand });

  if (!linked.hasOpenLinkedPr || linked.prNumber === null) {
    return {
      ok: true,
      repo,
      issue,
      state: LINKED_PR_STATE.NO_LINKED_PR,
      prNumber: null,
      prUrl: null,
      isDraft: null,
      changedFiles: null,
      commitCount: null,
      soleCommitHeadline: null,
      authorLogin: null,
    };
  }

  const facts = await fetchLinkedPrFacts({ repo, prNumber: linked.prNumber }, { env, ghCommand });

  return {
    ok: true,
    repo,
    issue,
    state: classifyInitialCopilotPrState({ repo, facts }),
    prNumber: facts.number,
    prUrl: facts.url,
    isDraft: facts.isDraft,
    changedFiles: facts.changedFiles,
    commitCount: facts.commitCount,
    soleCommitHeadline: facts.soleCommitHeadline,
    authorLogin: facts.authorLogin,
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, env = process.env, ghCommand = "gh" } = {},
) {
  const options = parseDetectInitialCopilotPrStateCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await detectInitialCopilotPrState(
    { repo: options.repo, issue: options.issue },
    { env, ghCommand },
  );

  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

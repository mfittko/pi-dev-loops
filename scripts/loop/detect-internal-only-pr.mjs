#!/usr/bin/env node
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";

const USAGE = `Usage: detect-internal-only-pr.mjs --repo <owner/name> --pr <number>
Detect whether a PR only touches internal tooling files (scripts, docs, tests, config)
and should suppress external Copilot review.
Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number
Optional:
  --label-check         Also check for explicit "internal_only" label on the PR
Output (stdout, JSON):
  { "ok": true, "internalOnly": true|false, "files": ["path1", "path2", ...],
    "reason": "...", "repo": "...", "pr": N }
Exit codes:
  0  Success
  1  Argument error or gh failure`.trim();

const parseError = buildParseError(USAGE);

// Paths that are considered internal tooling (not consumer-facing).
// If ALL changed files match one of these patterns, the PR is internal-only.
const INTERNAL_PATH_PATTERNS = [
  /^scripts\//,
  /^docs\//,
  /^skills\/docs\//,
  /^\.pi\//,
  /^\.github\//,
  /^test\//,
];

// Paths that are always consumer-facing (override internal patterns).
// If ANY changed file matches one of these, the PR is NOT internal-only.
const CONSUMER_PATH_PATTERNS = [
  /^packages\//,
  /^skills\/[^d]/,  // skills/* except skills/docs/
  /^skills\/dev-loop\//,
  /^skills\/copilot-pr-followup\//,
  /^cli\//,
  /^package\.json$/,
  /^README\.md$/,
  /^AGENTS\.md$/,
];

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    labelCheck: false,
  };
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }
    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", parseError).trim();
      continue;
    }
    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr", parseError), parseError);
      continue;
    }
    if (token === "--label-check") {
      options.labelCheck = true;
      continue;
    }
    throw parseError(`Unknown argument: ${token}`);
  }
  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("detect-internal-only-pr requires both --repo <owner/name> and --pr <number>");
  }
  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }
  return options;
}

function isInternalPath(filePath) {
  for (const pattern of INTERNAL_PATH_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

function isConsumerPath(filePath) {
  for (const pattern of CONSUMER_PATH_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

async function fetchPrFiles({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "files", "--jq", ".files[].path"],
    env,
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }
  const paths = result.stdout.trim().split("\n").filter(Boolean);
  return paths;
}

async function fetchPrLabels({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "labels", "--jq", ".labels[].name"],
    env,
  );
  if (result.code !== 0) {
    return []; // Best-effort: label check failure is not fatal
  }
  const labels = result.stdout.trim().split("\n").filter(Boolean);
  return labels;
}

export async function detectInternalOnly(options, { env = process.env, ghCommand = "gh" } = {}) {
  const files = await fetchPrFiles(options, { env, ghCommand });

  if (files.length === 0) {
    return {
      ok: true,
      internalOnly: false,
      files: [],
      reason: "No files changed; cannot determine internal-only status",
      repo: options.repo,
      pr: options.pr,
    };
  }

  // Check if any consumer-facing file is touched
  const consumerFiles = files.filter(isConsumerPath);
  if (consumerFiles.length > 0) {
    return {
      ok: true,
      internalOnly: false,
      files,
      reason: `Consumer-facing file(s) changed: ${consumerFiles.join(", ")}`,
      repo: options.repo,
      pr: options.pr,
    };
  }

  // Check if ALL files are internal-only
  const nonInternalFiles = files.filter((f) => !isInternalPath(f));
  if (nonInternalFiles.length > 0) {
    return {
      ok: true,
      internalOnly: false,
      files,
      reason: `Non-internal file(s) changed outside recognized patterns: ${nonInternalFiles.join(", ")}`,
      repo: options.repo,
      pr: options.pr,
    };
  }

  // Check for explicit internal_only label if requested
  if (options.labelCheck) {
    const labels = await fetchPrLabels(options, { env, ghCommand });
    if (labels.includes("internal_only")) {
      // Label confirms internal-only — but our path check already passed, so this is just additional evidence
    }
  }

  return {
    ok: true,
    internalOnly: true,
    files,
    reason: `All ${files.length} changed file(s) are internal tooling only (scripts/docs/tests/config)`,
    repo: options.repo,
    pr: options.pr,
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
  } = {},
) {
  const options = parseCliArgs(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }
  const result = await detectInternalOnly(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

export { isInternalPath, isConsumerPath, INTERNAL_PATH_PATTERNS, CONSUMER_PATH_PATTERNS };

#!/usr/bin/env node
/**
 * Detect change scope from git diff for light mode eligibility.
 *
 * Usage:
 *   node scripts/loop/detect-change-scope.mjs [--base <ref>] [--head <ref>]
 *
 * Output (stdout, JSON):
 *   {
 *     "ok": true,
 *     "filesChanged": 2,
 *     "linesChanged": 50,
 *     "eligibleForLightMode": true,
 *     "threshold": { "maxFiles": 3, "maxLines": 200 }
 *   }
 *
 * When --base/--head not given, defaults to HEAD~1..HEAD (committed scope).
 *
 * `eligibleForLightMode` is only computed when light mode is enabled in config
 * and config loading has no validation errors (fail-closed).
 * When disabled, it is always `false`.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { base: null, head: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && i + 1 < args.length) opts.base = args[++i];
    else if (args[i] === "--head" && i + 1 < args.length) opts.head = args[++i];
  }
  return opts;
}

/**
 * Parse `git diff --stat` output into { filesChanged, linesChanged }.
 * Exported as a pure function for testability.
 *
 * @param {string} output - Raw stdout from `git diff --stat`
 * @returns {{ filesChanged: number, linesChanged: number }}
 */
export function parseGitDiffStat(output) {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return { filesChanged: 0, linesChanged: 0 };
  }

  const lines = trimmed.split("\n");
  // Last line is the summary: "N files changed, M insertions(+), K deletions(-)"
  const summaryLine = lines[lines.length - 1];
  const fileCount = lines.length - 1;

  let insertions = 0;
  let deletions = 0;
  // Summary may be absent for binary-only diffs or zero-change diffs
  const insMatch = summaryLine.match(/(\d+)\s+insertion/);
  const delMatch = summaryLine.match(/(\d+)\s+deletion/);
  if (insMatch) insertions = parseInt(insMatch[1], 10);
  if (delMatch) deletions = parseInt(delMatch[1], 10);

  return { filesChanged: fileCount, linesChanged: insertions + deletions };
}

function detectScope({ base, head } = {}) {
  let diffArgs = ["diff", "--stat"];
  if (base && head) {
    diffArgs.push(`${base}..${head}`);
  } else if (base) {
    diffArgs.push(base);
  } else {
    diffArgs.push("HEAD~1..HEAD");
  }

  let output;
  try {
    output = execFileSync("git", diffArgs, { encoding: "utf8", maxBuffer: 1_000_000 });
  } catch {
    return { ok: true, filesChanged: 0, linesChanged: 0 };
  }

  const parsed = parseGitDiffStat(output);
  return { ok: true, ...parsed };
}

function isEligibleForLightMode(scope, threshold) {
  return scope.filesChanged <= threshold.maxFiles && scope.linesChanged <= threshold.maxLines;
}

async function main() {
  const opts = parseArgs();
  const scope = detectScope(opts);

  // Only compute eligibility when light mode is enabled AND config has no
  // validation errors (fail-closed). When disabled or errors present,
  // `eligibleForLightMode` is always false.
  let threshold = { maxFiles: 3, maxLines: 200 }; // built-in default
  let eligible = false;
  try {
    const { loadDevLoopConfig, resolveLightMode } = await import(
      "../../packages/core/src/config/config.mjs"
    );
    const { config, errors } = await loadDevLoopConfig({ repoRoot: process.cwd() });
    if (Array.isArray(errors) && errors.length > 0) {
      // Config validation errors → fail-closed, eligible stays false
    } else {
      const lightMode = resolveLightMode(config);
      if (lightMode) {
        threshold = { maxFiles: lightMode.maxFiles, maxLines: lightMode.maxLines };
        eligible = isEligibleForLightMode(scope, threshold);
      }
    }
  } catch {
    // Use built-in defaults, eligible remains false
  }

  process.stdout.write(
    JSON.stringify({
      ...scope,
      eligibleForLightMode: eligible,
      threshold,
    }) + "\n"
  );
}

const isDirectRun =
  process.argv[1] && process.argv[1].includes("detect-change-scope.mjs");

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

export { detectScope, isEligibleForLightMode };

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
 * When --base/--head not given, defaults to git diff against HEAD~1
 * (for committed scope) or git diff HEAD (for working tree).
 */
import { execSync } from "node:child_process";
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

function detectScope({ base, head } = {}) {
  let diffArgs = ["diff", "--stat"];
  if (base && head) {
    diffArgs.push(`${base}..${head}`);
  } else if (base) {
    diffArgs.push(base);
  } else {
    diffArgs.push("HEAD~1");
  }

  let output;
  try {
    output = execSync("git", diffArgs, { encoding: "utf8", maxBuffer: 1_000_000 });
  } catch {
    return { ok: true, filesChanged: 0, linesChanged: 0 };
  }

  const lines = output.trim().split("\n");
  // Last line of git diff --stat is the summary line: "N files changed, M insertions(+), K deletions(-)"
  const summaryLine = lines[lines.length - 1];
  const fileCount = lines.length - 1; // all lines except the summary

  let insertions = 0;
  let deletions = 0;
  const insMatch = summaryLine.match(/(\d+)\s+insertion/);
  const delMatch = summaryLine.match(/(\d+)\s+deletion/);
  if (insMatch) insertions = parseInt(insMatch[1], 10);
  if (delMatch) deletions = parseInt(delMatch[1], 10);

  return {
    ok: true,
    filesChanged: fileCount,
    linesChanged: insertions + deletions,
  };
}

function isEligibleForLightMode(scope, threshold) {
  return scope.filesChanged <= threshold.maxFiles && scope.linesChanged <= threshold.maxLines;
}

async function main() {
  const opts = parseArgs();
  const scope = detectScope(opts);

  // Try to load config for threshold
  let threshold = { maxFiles: 3, maxLines: 200 }; // built-in default
  try {
    const { loadDevLoopConfig, resolveLightMode } = await import(
      "../../packages/core/src/config/config.mjs"
    );
    const { config } = await loadDevLoopConfig({ repoRoot: process.cwd() });
    const lightMode = resolveLightMode(config);
    if (lightMode) {
      threshold = { maxFiles: lightMode.maxFiles, maxLines: lightMode.maxLines };
    }
  } catch {
    // Use built-in defaults if config loading fails
  }

  const eligible = isEligibleForLightMode(scope, threshold);

  process.stdout.write(
    JSON.stringify({
      ...scope,
      eligibleForLightMode: eligible,
      threshold,
    }) + "\n"
  );

  if (!eligible && opts.base && opts.head) {
    process.exitCode = 0; // not an error, just not eligible
  }
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

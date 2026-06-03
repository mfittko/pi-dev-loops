#!/usr/bin/env node
/**
 * Detect tracker-first loop state — thin CLI wrapper.
 *
 * Usage:
 *   node scripts/loop/detect-tracker-first-loop-state.mjs --repo <owner/name> --issue <number>
 *
 * Emits JSON matching the Copilot loop interface contract:
 *   { ok, state, snapshot, allowedTransitions, nextAction }
 *
 * Unknown/ambiguous tracker state emits `needs_triage` (fail-closed).
 */
import process from "node:process";
import { execSync } from "node:child_process";
import { interpretTrackerLoopState } from "../../packages/core/src/loop/tracker-first-loop-state.mjs";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { repo: null, issue: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo" && i + 1 < args.length) opts.repo = args[++i];
    else if (args[i] === "--issue" && i + 1 < args.length) opts.issue = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (!opts.repo || !opts.issue) {
    process.stderr.write(
      JSON.stringify({ ok: false, error: "--repo and --issue required" }) + "\n"
    );
    process.exitCode = 1;
    return;
  }

  // Fetch issue state
  let rawState = "unknown";
  let prContext = null;
  try {
    const issueJson = execSync(
      `gh issue view ${opts.issue} --repo ${opts.repo} --json state,title --jq '.state'`,
      { encoding: "utf8" }
    ).trim();
    rawState = issueJson;

    // Check for linked PR
    try {
      const prJson = execSync(
        `gh pr list --repo ${opts.repo} --search "${opts.issue} in:body" --state open --json number,state,headRefName --jq '.[0]'`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      if (prJson) prContext = JSON.parse(prJson);
    } catch {
      // No linked PR — that's fine
    }
  } catch {
    rawState = "unknown";
  }

  const result = interpretTrackerLoopState({ trackerState: rawState, prContext });
  process.stdout.write(JSON.stringify(result) + "\n");
}

const isDirectRun =
  process.argv[1] && process.argv[1].includes("detect-tracker-first-loop-state.mjs");

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

export { main };

#!/usr/bin/env node
/**
 * run-queue.mjs — Thin CLI wrapper for the queue driver.
 *
 * Usage:
 *   dev-loops loop run-queue --repo <owner/name> [--merge-authorized] [--parallel]
 *
 * Accepts queue config from .pi/dev-loop-queue.json.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { runQueue, DEFAULT_QUEUE_DRIVER_OPTIONS } from "../../packages/core/src/loop/queue-driver.mjs";
import { computeParallelSchedule } from "../../packages/core/src/loop/queue-parallel.mjs";
import { readQueue, nextReadyEntry } from "../../packages/core/src/loop/queue-state.mjs";
import { parsePositiveInteger } from "../../packages/core/src/cli/primitives.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const USAGE = `Usage:
  dev-loops loop run-queue --repo <owner/name> [--merge-authorized] [--parallel] [--max-retries <n>]

Run the dev-loop queue driver over entries in .pi/dev-loop-queue.json.
Exit codes: 0 success, 1 error`.trim();

function parseArgs(argv) {
  const args = {
    repo: null,
    mergeAuthorized: false,
    parallel: false,
    maxRetries: 1,
    maxParallel: 3,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--repo":
        args.repo = argv[++i];
        break;
      case "--merge-authorized":
        args.mergeAuthorized = true;
        break;
      case "--parallel":
        args.parallel = true;
        break;
      case "--max-retries":
        args.maxRetries = parsePositiveInteger(argv[++i]);
        break;
      case "--max-parallel":
        args.maxParallel = parsePositiveInteger(argv[++i]);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (!args.repo) {
    console.error("Error: --repo <owner/name> is required");
    process.exit(1);
  }

  const queue = await readQueue(REPO_ROOT);

  if (queue.entries.length === 0) {
    console.log(JSON.stringify({ ok: true, message: "Queue is empty", results: [] }));
    return;
  }

  const pending = queue.entries.filter((e) => e.status !== "done" && e.status !== "blocked");
  console.error(`Queue: ${queue.entries.length} entries, ${pending.length} pending`);

  if (args.parallel && pending.length > 1) {
    const schedule = computeParallelSchedule(
      pending.map((e) => ({
        target: e.target,
        files: [],
        dependsOn: e.dependsOn || [],
      })),
      args.maxParallel
    );

    console.error(`Parallel schedule: ${schedule.waves.length} waves`);
    for (let wi = 0; wi < schedule.waves.length; wi++) {
      const wave = schedule.waves[wi];
      console.error(`  Wave ${wi + 1}: ${wave.map((g) => `[${g.join(", ")}]`).join("  ")}`);
    }

    console.error("Parallel dispatch via async subagents not yet wired; falling back to sequential.");
  }

  const result = await runQueue(REPO_ROOT, args.repo, {
    ...DEFAULT_QUEUE_DRIVER_OPTIONS,
    mergeAuthorized: args.mergeAuthorized,
    maxRetries: args.maxRetries,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

#!/usr/bin/env node
/**
 * verify-fresh-review-context.mjs — Gate-review subagent startup self-check.
 *
 * Writes a lock-file sentinel on first run. If the sentinel already exists,
 * the subagent inherits a prior session's context (contaminated) and the
 * script fails closed.
 *
 * Lock-file: tmp/gate-review-context-sentinel.json (relative to CWD, which
 * should be the repo root when run inside a Pi subagent).
 *
 * Exit 0 on clean (first run), exit 1 on contamination (prior run detected).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SENTINEL_RELATIVE = path.join("tmp", "gate-review-context-sentinel.json");

const USAGE = `Usage: verify-fresh-review-context.mjs [--help]

Verify that the current subagent session has fresh context.

Output (stdout, JSON):
  { "ok": true, "fresh": true, "sentinelCreated": true }
  { "ok": true, "fresh": false, "sentinelCreated": false, "reason": "..." }

Exit codes:
  0  Clean (first run)
  1  Contaminated (prior session detected)
  2  Internal error`.trim();

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const sentinelPath = path.resolve(process.cwd(), SENTINEL_RELATIVE);

  try {
    await mkdir(path.dirname(sentinelPath), { recursive: true });
  } catch {
    // ignore
  }

  let existingSentinel = null;
  try {
    const raw = await readFile(sentinelPath, "utf8");
    existingSentinel = JSON.parse(raw);
  } catch {
    // File doesn't exist — fresh context
  }

  if (existingSentinel) {
    process.stdout.write(JSON.stringify({
      ok: true,
      fresh: false,
      sentinelCreated: false,
      reason: "Gate-review context sentinel already exists — inherited session context detected. Restart the subagent with fresh context (subagent({context:\"fresh\"})).",
    }) + "\n");
    return 1;
  }

  const sentinel = {
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };

  await writeFile(sentinelPath, JSON.stringify(sentinel, null, 2) + "\n", "utf8");

  process.stdout.write(JSON.stringify({
    ok: true,
    fresh: true,
    sentinelCreated: true,
  }) + "\n");
  return 0;
}

const isDirect = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace("file://", ""));
if (isDirect) {
  const exitCode = await main();
  process.exit(exitCode);
}

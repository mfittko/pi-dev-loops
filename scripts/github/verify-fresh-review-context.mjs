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
import { isDirectCliRun, formatCliError } from "../_core-helpers.mjs";

const SENTINEL_RELATIVE = path.join("tmp", "gate-review-context-sentinel.json");

const USAGE = `Usage: verify-fresh-review-context.mjs [--help]

Verify that the current subagent session has fresh context.

Output (stdout, JSON):
  { "ok": true, "fresh": true, "sentinelCreated": true }
  { "ok": true, "fresh": false, "sentinelCreated": false, "reason": "..." }

  On internal error (stderr, JSON):
  { "ok": false, "error": "..." }

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

  // Ensure tmp/ exists
  try {
    await mkdir(path.dirname(sentinelPath), { recursive: true });
  } catch (err) {
    process.stderr.write(`${formatCliError(err, { prefix: "verify-fresh-review-context: " })}\n`);
    return 2;
  }

  // Check if sentinel already exists
  let existingSentinel = null;
  try {
    const raw = await readFile(sentinelPath, "utf8");
    existingSentinel = JSON.parse(raw);
  } catch {
    // File doesn't exist or unreadable — proceed
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

  // Atomic create with exclusive write flag (wx)
  const sentinel = {
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };

  try {
    await writeFile(sentinelPath, JSON.stringify(sentinel, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (err) {
    if (err.code === "EEXIST") {
      process.stdout.write(JSON.stringify({
        ok: true,
        fresh: false,
        sentinelCreated: false,
        reason: "Gate-review context sentinel already exists (detected on atomic create) — inherited session context detected. Restart the subagent with fresh context (subagent({context:\"fresh\"})).",
      }) + "\n");
      return 1;
    }
    process.stderr.write(`${formatCliError(err, { prefix: "verify-fresh-review-context: " })}\n`);
    return 2;
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    fresh: true,
    sentinelCreated: true,
  }) + "\n");
  return 0;
}

if (isDirectCliRun(import.meta.url)) {
  try {
    const exitCode = await main();
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(`${formatCliError(err, { prefix: "verify-fresh-review-context: " })}\n`);
    process.exit(2);
  }
}

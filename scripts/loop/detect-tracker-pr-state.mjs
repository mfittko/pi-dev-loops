#!/usr/bin/env node
/**
 * Deterministic tracker-PR state detector.
 *
 * Interprets a pre-built tracker-PR snapshot JSON and emits the current
 * lifecycle state, allowed next transitions, recommended next action, and
 * the canonical reverse-sync action that should be applied to the tracker.
 *
 * Auto-detection of live tracker/GitHub state is adapter-specific and
 * intentionally out of scope for this CLI. Callers are expected to build
 * the snapshot from their own tracker adapter and GitHub fact-gathering
 * tools, then pass it here for deterministic interpretation.
 *
 * Usage:
 *   detect-tracker-pr-state.mjs --input <path>
 *
 * Success output shape (stdout, JSON):
 *   {
 *     "ok": true,
 *     "snapshot": { ... },
 *     "state": "...",
 *     "allowedTransitions": [...],
 *     "nextAction": "...",
 *     "reverseSyncAction": "..."
 *   }
 *
 * Failure output (stderr, JSON):
 *   Argument/usage errors: { "ok": false, "error": "...", "usage": "..." }
 *   Runtime failures:      { "ok": false, "error": "..." }
 *
 * Exit codes:
 *   0  Success
 *   1  Argument error or runtime failure
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError } from "../_core-helpers.mjs";
import {
  interpretTrackerPrState,
  normalizeTrackerPrSnapshot,
} from "../../packages/core/src/loop/tracker-pr-state.mjs";

const USAGE = `Usage:
  detect-tracker-pr-state.mjs --input <path>

Interpret a pre-built tracker-PR snapshot JSON and emit the current lifecycle
state, allowed transitions, recommended next action, and canonical reverse-sync
action.

Required:
  --input <path>   Path to a JSON file containing the tracker-PR snapshot.

Snapshot schema (all fields optional; unknown fields are ignored):
  trackerItemExists  boolean     Whether a tracker work item was found
  trackerItemId      string|null Opaque tracker item ID (e.g. "PROJ-123") when present
  prExists           boolean     Whether a GitHub PR exists for this item
  prNumber           number|null PR number if known; prNumber with prExists=false is contradictory
  prDraft            boolean     Whether the PR is in draft state
  prMerged           boolean     Whether the PR has been merged
  prClosed           boolean     Whether the PR is closed on GitHub (merged PRs are also closed)

This snapshot intentionally excludes tracker-native workflow readiness/blocking
state. Callers must combine tracker-owned workflow state separately when
interpreting whether opening a PR is appropriate.

Output (stdout, JSON):
  {
    "ok": true,
    "snapshot": { ... },
    "state": "...",
    "allowedTransitions": [...],
    "nextAction": "...",
    "reverseSyncAction": "..."
  }

Error output (stderr, JSON):
  Argument/usage errors: { "ok": false, "error": "...", "usage": "..." }
  Runtime failures:      { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or runtime failure`.trim();

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

export function parseDetectTrackerPrCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    inputPath: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--input") {
      options.inputPath = requireOptionValue(args, "--input");
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.inputPath === undefined) {
    throw parseError("--input <path> is required");
  }

  return options;
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
  } = {},
) {
  const options = parseDetectTrackerPrCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const text = await readFile(path.resolve(options.inputPath), "utf8");

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse snapshot JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const snapshot = normalizeTrackerPrSnapshot(raw);
  const { state, allowedTransitions, nextAction, reverseSyncAction } = interpretTrackerPrState(snapshot);

  stdout.write(
    `${JSON.stringify({ ok: true, snapshot, state, allowedTransitions, nextAction, reverseSyncAction })}\n`,
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

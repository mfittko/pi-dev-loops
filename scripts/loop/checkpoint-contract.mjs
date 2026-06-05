#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireOptionValue } from "../_cli-primitives.mjs";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";

const USAGE = `Usage: checkpoint-contract.mjs --state <required|complete|skipped|none|missing> [--notes <text>] [--reason <text>]

Write .pi/dev-loop-retrospective-checkpoint.json using the retrospective contract format.`.trim();

const parseError = buildParseError(USAGE);
const CHECKPOINT_FILE = path.join(".pi", "dev-loop-retrospective-checkpoint.json");

const ALLOWED_STATES = new Set(["required", "complete", "skipped", "none", "missing"]);

export function parseCheckpointContractCliArgs(argv) {
  const args = [...argv];
  const options = {
    state: undefined,
    notes: null,
    reason: null,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--state") {
      options.state = requireOptionValue(args, "--state", parseError).trim().toLowerCase();
      continue;
    }
    if (token === "--notes") {
      options.notes = requireOptionValue(args, "--notes", parseError).trim();
      continue;
    }
    if (token === "--reason") {
      options.reason = requireOptionValue(args, "--reason", parseError).trim();
      continue;
    }
    throw parseError(`Unknown argument: ${token}`);
  }

  if (!options.state) {
    throw parseError("checkpoint-contract requires --state");
  }

  if (!ALLOWED_STATES.has(options.state)) {
    throw parseError(`Invalid --state value: "${options.state}". Allowed: ${[...ALLOWED_STATES].join(", ")}.`);
  }

  if (options.state === "complete" && !options.notes) {
    throw parseError('state "complete" requires --notes');
  }

  if (options.state === "skipped" && !options.reason) {
    throw parseError('state "skipped" requires --reason');
  }

  return options;
}

export function buildRetrospectiveCheckpointPayload({ state, notes = null, reason = null }, now = new Date()) {
  const timestamp = now.toISOString();
  if (state === "complete") {
    return { state, completedAt: timestamp, notes };
  }
  if (state === "skipped") {
    return { state, skippedAt: timestamp, reason };
  }
  if (state === "required") {
    return { state, triggeredAt: timestamp };
  }
  if (state === "missing") {
    return { state, triggeredAt: timestamp };
  }
  if (state === "none") {
    return { state };
  }
  throw new Error(`Unsupported retrospective checkpoint state: ${state}`);
}

export async function runCheckpointContractCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, cwd = process.cwd(), now = new Date() } = {},
) {
  const options = parseCheckpointContractCliArgs(argv);
  const payload = buildRetrospectiveCheckpointPayload(options, now);
  const checkpointPath = path.join(cwd, CHECKPOINT_FILE);
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  stdout.write(`${JSON.stringify({ ok: true, path: CHECKPOINT_FILE, checkpoint: payload })}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCheckpointContractCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

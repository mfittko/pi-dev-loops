#!/usr/bin/env node

import { spawn } from "node:child_process";

import { formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { parseRepoSlug } from "../github/capture-review-threads.mjs";
import { watchCopilotReview } from "../github/watch-copilot-review.mjs";
import { runHandoff } from "./copilot-pr-handoff.mjs";
import { detectCopilotSessionActivity } from "./detect-copilot-session-activity.mjs";

const USAGE = `Usage: run-copilot-watch-cycle.mjs --repo <owner/name> --pr <number> [--force-rerequest-review] [--probe-only]

Run one deterministic Copilot wait-cycle boundary.

Required:
  --repo <owner/name>       Repository slug (e.g. owner/repo)
  --pr <number>             Pull request number

Optional:
  --force-rerequest-review  Force a Copilot re-request even when automatic
                            same-head suppression is active
  --probe-only              Use a single immediate recheck (timeout 0) for
                            explicit status probes only; normal async waiting
                            keeps the emitted non-zero watch timeout

Output (stdout, JSON):
  { "ok": true, "handoffAction": "watch"|"fix"|"stop", "state": "...",
    "allowedTransitions": [...], "nextAction": "...", "snapshot": {...},
    "reviewRequestStatus"?: "...", "watchArgs"?: { ... },
    "sessionActivity"?: { ... },
    "watchStatus"?: "changed"|"timeout"|"idle", "watch"?: { ... },
    "loopDisposition": "pending"|"unresolved_feedback"|"clean_converged"|"blocked"|"action_required"|"done",
    "cycleDisposition": "pending"|"needs_followup"|"terminal",
    "terminal": true|false }

Cycle disposition:
  pending         Watch state persists; keep waiting or re-enter later
  needs_followup  Fresh review activity or fix-state follow-up needs action
  terminal        No automatic next step remains

Error output (stderr, JSON):
  Argument/usage errors:
    { "ok": false, "error": "...", "usage": "..." }
  runtime failures:
    { "ok": false, "error": "..." }

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

function parsePrNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw parseError("--pr must be a positive integer");
  }

  return Number(value);
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

async function fetchPrHeadBranch({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["pr", "view", String(pr), "--repo", repo, "--json", "headRefName"],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${result.stdout.trim() || "<empty>"}`);
  }

  if (typeof payload.headRefName !== "string" || payload.headRefName.trim().length === 0) {
    throw new Error("Missing required PR facts: headRefName");
  }

  return payload.headRefName.trim();
}

async function watchWorkflowRun({ repo, runId }, { env, ghCommand }) {
  const result = await runChild(
    ghCommand,
    ["run", "watch", String(runId), "--repo", repo],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }
}

function determineWatchTimeout({ probeOnly, defaultTimeoutMs, sessionActivity }) {
  if (probeOnly || sessionActivity === "active") {
    return 0;
  }

  return defaultTimeoutMs;
}

export function parseWatchCycleCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    forceRerequestReview: false,
    probeOnly: false,
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

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr"));
      continue;
    }

    if (token === "--force-rerequest-review") {
      options.forceRerequestReview = true;
      continue;
    }

    if (token === "--probe-only") {
      options.probeOnly = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined || options.pr === undefined) {
    throw parseError("run-copilot-watch-cycle requires both --repo <owner/name> and --pr <number>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

export async function runWatchCycle(
  options,
  {
    env = process.env,
    ghCommand = "gh",
    runHandoffImpl = runHandoff,
    watchCopilotReviewImpl = watchCopilotReview,
    detectCopilotSessionActivityImpl = detectCopilotSessionActivity,
    fetchPrHeadBranchImpl = fetchPrHeadBranch,
    watchWorkflowRunImpl = watchWorkflowRun,
    detectSessionActivity = false,
  } = {},
) {
  const handoff = await runHandoffImpl(options, { env, ghCommand });
  const result = {
    ok: true,
    handoffAction: handoff.action,
    state: handoff.state,
    allowedTransitions: handoff.allowedTransitions,
    nextAction: handoff.nextAction,
    snapshot: handoff.snapshot,
    loopDisposition: handoff.loopDisposition,
    cycleDisposition: handoff.action === "stop" ? "terminal" : "needs_followup",
    terminal: Boolean(handoff.terminal),
  };

  if (handoff.reviewRequestStatus !== undefined) {
    result.reviewRequestStatus = handoff.reviewRequestStatus;
  }

  if (handoff.watchArgs !== undefined) {
    result.watchArgs = handoff.watchArgs;
  }

  if (handoff.action !== "watch") {
    return result;
  }

  if (detectSessionActivity) {
    const headBranch = await fetchPrHeadBranchImpl({ repo: options.repo, pr: options.pr }, { env, ghCommand });
    const session = await detectCopilotSessionActivityImpl(
      {
        repo: options.repo,
        branch: headBranch,
      },
      { env, ghCommand },
    );
    result.sessionActivity = session;

    if (
      !options.probeOnly
      && session.activity === "active"
      && Number.isInteger(session.runId)
    ) {
      await watchWorkflowRunImpl(
        { repo: options.repo, runId: session.runId },
        { env, ghCommand },
      );
    }
  }

  const watchOptions = {
    ...handoff.watchArgs,
    timeoutMs: determineWatchTimeout({
      probeOnly: options.probeOnly,
      defaultTimeoutMs: handoff.watchArgs.timeoutMs,
      sessionActivity: result.sessionActivity?.activity ?? null,
    }),
  };
  const watch = await watchCopilotReviewImpl(watchOptions, { env, ghCommand });

  result.watchArgs = watchOptions;
  result.watchStatus = watch.status;
  result.watch = watch;
  result.cycleDisposition = watch.status === "changed" ? "needs_followup" : "pending";
  result.terminal = false;
  return result;
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
    runHandoffImpl = runHandoff,
    watchCopilotReviewImpl = watchCopilotReview,
  } = {},
) {
  const options = parseWatchCycleCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runWatchCycle(options, {
    env,
    ghCommand,
    runHandoffImpl,
    watchCopilotReviewImpl,
    detectSessionActivity: true,
  });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

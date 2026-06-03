#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveAuthoritativeStartupResumeBundle } from "../../packages/core/src/loop/public-dev-loop-routing.mjs";
import { buildParseError, formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { requireOptionValue } from "../_cli-primitives.mjs";

import {
  validateAsyncStartContext,
  buildAsyncStartRejection,
  ASYNC_START_STATUS,
} from "@pi-dev-loops/core/loop/async-start-contract";

const USAGE = `Usage:
  resolve-dev-loop-startup.mjs --input <path>

Resolve the authoritative public dev-loop startup/resume bundle from a pre-built
canonical-state JSON payload and emit the selected strategy, required route-pack
reads, next action, and a concise canonical state summary.

Required:
  --input <path>   Path to a JSON file containing the authoritative startup input.

Input JSON:
  Pass the same shape accepted by resolveAuthoritativeStartupResumeBundle(...),
  including currentState plus any required authoritative fields such as
  artifactState, issueLinkageResolution, loopState, issueReadiness,
  issueAssignmentState, gateReviewEvidence, asyncRun, and
  retrospectiveCheckpointState when applicable.
  NOTE: When omitted by the caller, retrospectiveCheckpointState is auto-read
  from .pi/dev-loop-retrospective-checkpoint.json when
  requireRetrospective is enabled in the repo settings.

Async-start contract:
  Strategies flagged as requiresAsyncDispatch must run within a visible
  Pi-managed async subagent session. When the resolver detects an inline
  invocation of an async-required strategy, it fails closed with a
  machine-readable rejection (stderr JSON, exit code 1).
  Bypass: set PI_ASYNC_START_BYPASS=1.

Output (stdout, JSON):
  {
    "ok": true,
    "bundleKind": "resolved|needs_reconcile",
    "selectedStrategy": "...",   // normalized: null (core) is surfaced as "none" here
    "requiredReads": ["..."],
    "nextAction": "...",
    "canonicalStateSummary": { ... },
    "bundle": { ... }            // bundle.selectedStrategy preserves the raw core value (may be null)
  }

Async-start rejection (stderr, JSON):
  { "ok": false, "error": "...", "asyncStartContract": "rejected" }

Error output (stderr, JSON):
  Argument/usage errors: { "ok": false, "error": "...", "usage": "..." }
  Runtime failures:      { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error, runtime failure, or async-start contract rejection`.trim();

const SHARED_PUBLIC_CONTRACT = "skills/docs/public-dev-loop-contract.md";
const SHARED_RETROSPECTIVE_CONTRACT = "skills/docs/retrospective-checkpoint-contract.md";

const STRATEGY_REQUIRED_READS = {
  local_implementation: [
    SHARED_PUBLIC_CONTRACT,
    "skills/local-implementation/SKILL.md",
  ],
  issue_intake: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
    "skills/docs/issue-intake-procedure.md",
  ],
  copilot_pr_followup: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
  ],
  external_pr_followup: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
  ],
  reviewer_fixer: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
  ],
  wait_watch: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
  ],
  final_approval: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
    "skills/docs/copilot-loop-operations.md",
    "skills/final-approval/SKILL.md",
  ],
  none: [SHARED_PUBLIC_CONTRACT],
};

const STRATEGY_ASYNC_DISPATCH = {
  local_implementation: false,
  issue_intake: true,
  copilot_pr_followup: true,
  external_pr_followup: true,
  reviewer_fixer: true,
  wait_watch: true,
  final_approval: false,
  none: false,
};

const parseError = buildParseError(USAGE);


export function parseResolveDevLoopStartupCliArgs(argv) {
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
      options.inputPath = requireOptionValue(args, "--input", parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.inputPath === undefined) {
    throw parseError("--input <path> is required");
  }

  return options;
}

export function summarizeCanonicalState(bundle) {
  return {
    target: bundle.canonicalState?.target ?? null,
    ownership: bundle.canonicalState?.ownership ?? null,
    nextActor: bundle.canonicalState?.nextActor ?? null,
    status: bundle.canonicalState?.status ?? null,
    authorization: bundle.canonicalState?.authorization ?? null,
    artifactState: bundle.artifactState ?? null,
    issueLinkageResolution: bundle.issueLinkageResolution ?? null,
    loopState: bundle.loopState ?? null,
    routeKind: bundle.routeKind ?? null,
    selectedGate: bundle.selectedGate ?? null,
    executionMode: bundle.executionMode ?? null,
    waitSemantics: bundle.waitSemantics ?? null,
    requiresAsyncDispatch: bundle.selectedStrategy !== null
      ? (STRATEGY_ASYNC_DISPATCH[bundle.selectedStrategy] ?? false)
      : false,
  };
}

/**
 * Build the startup result, with optional async-start enforcement when the
 * selected strategy requires async dispatch. Also auto-injects
 * retrospectiveCheckpointState from the settings-driven checkpoint file.
 *
 * @param {object} input — canonical-state JSON payload
 * @param {object} [options]
 * @param {Record<string,string|undefined>} [options.env] — for async-start check
 * @returns {{ ok: true, ... } | { ok: false, error: string, asyncStartContract: "rejected" }}
 */
export function buildResolveDevLoopStartupResult(input, { env = process.env, config = null } = {}) {
  // #462: Auto-read retrospective checkpoint state when caller omitted it.
  // This prevents callers from silently bypassing the retrospective gate.
  if (!input.retrospectiveCheckpointState) {
    try {
      const checkpointText = readFileSync(
        path.join(process.cwd(), ".pi", "dev-loop-retrospective-checkpoint.json"),
        "utf8",
      );
      const checkpoint = JSON.parse(checkpointText);
      const rawState = checkpoint?.state;
      // Normalize to match the known RETROSPECTIVE_CHECKPOINT_STATE values
      // accepted by the core router: "none", "complete", "skipped", "missing".
      const VALID_STATES = new Set(["none", "complete", "skipped", "missing"]);
      const state = (typeof rawState === "string" && VALID_STATES.has(rawState.trim().toLowerCase()))
        ? rawState.trim().toLowerCase()
        : null;
      input = { ...input, retrospectiveCheckpointState: state };
    } catch {
      // No checkpoint file or unreadable — pass through.
    }
  }

  const bundle = resolveAuthoritativeStartupResumeBundle(input);
  const strategyKey = bundle.selectedStrategy ?? "none";
  if (!(strategyKey in STRATEGY_REQUIRED_READS)) {
    throw new Error(
      `Unknown strategy key "${strategyKey}" is not in the allowed strategy required-reads map. ` +
      `Update STRATEGY_REQUIRED_READS to include this strategy or check for a core routing contract drift.`,
    );
  }

  const requiresAsyncDispatch = bundle.selectedStrategy !== null
    ? (STRATEGY_ASYNC_DISPATCH[bundle.selectedStrategy] ?? false)
    : false;

  // #465: Async-start contract enforcement for GitHub-first strategies.
  if (requiresAsyncDispatch) {
    const validation = validateAsyncStartContext({ env });
    if (validation.status === ASYNC_START_STATUS.REJECTED) {
      return buildAsyncStartRejection(validation);
    }
  }

  return {
    ok: true,
    bundleKind: bundle.bundleKind,
    selectedStrategy: strategyKey,
    requiredReads: STRATEGY_REQUIRED_READS[strategyKey],
    nextAction: bundle.nextAction,
    canonicalStateSummary: summarizeCanonicalState(bundle),
    bundle,
  };
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = parseResolveDevLoopStartupCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const text = await readFile(path.resolve(options.inputPath), "utf8");
  const input = parseJsonText(text);
  const result = buildResolveDevLoopStartupResult(input);

  // #465: When async-start enforcement produces a rejection, emit to stderr
  // and exit non-zero instead of writing the rejection to stdout.
  if (result.ok === false) {
    stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }

  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

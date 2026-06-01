#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveAuthoritativeStartupResumeBundle } from "../../packages/core/src/loop/public-dev-loop-routing.mjs";
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";

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

Error output (stderr, JSON):
  Argument/usage errors: { "ok": false, "error": "...", "usage": "..." }
  Runtime failures:      { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error or runtime failure`.trim();

const SHARED_PUBLIC_CONTRACT = "skills/docs/public-dev-loop-contract.md";
const SHARED_RETROSPECTIVE_CONTRACT = "skills/docs/retrospective-checkpoint-contract.md";
const SHARED_PROJECTION_CONTRACT = "skills/docs/conductor-pr-projection-contract.md";

const STRATEGY_REQUIRED_READS = {
  local_implementation: [
    SHARED_PUBLIC_CONTRACT,
    "skills/local-implementation/SKILL.md",
  ],
  issue_intake: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/issue-intake/SKILL.md",
  ],
  copilot_pr_followup: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
  ],
  external_pr_followup: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
  ],
  reviewer_fixer: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
  ],
  wait_watch: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/copilot-pr-followup/SKILL.md",
  ],
  final_approval: [
    SHARED_PUBLIC_CONTRACT,
    SHARED_RETROSPECTIVE_CONTRACT,
    SHARED_PROJECTION_CONTRACT,
    "skills/final-approval/SKILL.md",
    "skills/copilot-pr-followup/SKILL.md",
  ],
  none: [SHARED_PUBLIC_CONTRACT],
};

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
  };
}

export function buildResolveDevLoopStartupResult(input) {
  const bundle = resolveAuthoritativeStartupResumeBundle(input);
  // Preserve the raw bundle.selectedStrategy (may be null per the core contract).
  // Use a derived key only for required-reads lookup and the top-level selectedStrategy field.
  const strategyKey = bundle.selectedStrategy ?? "none";
  if (!(strategyKey in STRATEGY_REQUIRED_READS)) {
    throw new Error(
      `Unknown strategy key "${strategyKey}" is not in the allowed strategy required-reads map. ` +
      `Update STRATEGY_REQUIRED_READS to include this strategy or check for a core routing contract drift.`,
    );
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

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const options = parseResolveDevLoopStartupCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const text = await readFile(path.resolve(options.inputPath), "utf8");
  const input = parseJsonText(text);
  const result = buildResolveDevLoopStartupResult(input);
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

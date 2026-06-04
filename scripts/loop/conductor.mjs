#!/usr/bin/env node
/**
 * Unified conductor entrypoint: runs the conductor cycle for gate-coordinated
 * action queue AND monitors for auto-resume opportunities, combining both
 * into a single operator-facing output.
 *
 * This is the recommended entrypoint for Pi parent agents running the conductor
 * loop. It produces:
 *   1. Ordered action queue from run-conductor-cycle (what to do, in what order)
 *   2. Auto-resume plans from conductor-monitor (orphaned runs to resume)
 *   3. Consolidated summary
 *
 * Usage:
 *   conductor.mjs --repo <owner/name> [--auto-resume] [--cycle-only] [--monitor-only]
 *
 * --cycle-only    Only run the cycle (action queue); skip auto-resume scan
 * --monitor-only  Only run the monitor; skip gate coordination
 * --auto-resume   Enable auto-resume scanning (requires filesystem access)
 */

import { runConductorCycle } from "./run-conductor-cycle.mjs";
import { runConductorMonitor } from "./conductor-monitor.mjs";
import { requireOptionValue } from "../_cli-primitives.mjs";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import {
  loadDevLoopConfig,
  resolveWorkflowConfig,
  resolveAutonomyStopAt,
  resolveGateConfig,
} from "@pi-dev-loops/core/config";
import { readFileSync } from "node:fs";
import path from "node:path";

const USAGE = `Usage: conductor.mjs --repo <owner/name> [--auto-resume] [--cycle-only] [--monitor-only]

Unified conductor entrypoint for dev-loop lifecycle orchestration.`.trim();

const parseError = buildParseError(USAGE);

/**
 * Check the retrospective checkpoint gate.
 *
 * Only blocks when requireRetrospective is true AND checkpoint state is
 * required/missing. This is a direct filesystem check for conductor startup
 * gating — intentionally simpler than core's evaluateRetrospectiveGate, which
 * operates on routing results for the dev-loop startup resolver. The conductor
 * needs a yes/no startup gate, not a routing transform.
 *
 * @param {string} cwd - Repo root
 * @param {boolean} requireRetrospective - Config gate flag
 * @returns {{ blocked: boolean, reason?: string }}
 */
function checkRetrospectiveGate(cwd, requireRetrospective) {
  if (!requireRetrospective) return { blocked: false };

  try {
    const checkpointPath = path.join(cwd, ".pi", "dev-loop-retrospective-checkpoint.json");
    const checkpointText = readFileSync(checkpointPath, "utf8");
    const checkpoint = JSON.parse(checkpointText);
    const state = typeof checkpoint?.state === "string" ? checkpoint.state.trim().toLowerCase() : null;
    if (state === "required" || state === "missing") {
      return {
        blocked: true,
        reason: `Retrospective checkpoint pending (state: ${state}). Complete the retrospective before running the conductor.`,
      };
    }
    return { blocked: false };
  } catch (err) {
    if (err?.code === "ENOENT") return { blocked: false };
    return { blocked: true, reason: `Cannot read retrospective checkpoint: ${err.message}` };
  }
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    autoResume: false,
    cycleOnly: false,
    monitorOnly: false,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo", parseError).trim();
      continue;
    }

    if (token === "--auto-resume") {
      options.autoResume = true;
      continue;
    }

    if (token === "--cycle-only") {
      options.cycleOnly = true;
      continue;
    }

    if (token === "--monitor-only") {
      options.monitorOnly = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined) {
    throw parseError("conductor requires --repo <owner/name>");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

/**
 * @param {object} options
 * @param {object} runtime
 * @param {object} [runtime.loadConfigImpl] - injectable config loader for tests
 */
export async function runConductor(options, runtime = {}) {
  const { cycleOnly = false, monitorOnly = false, autoResume = false } = options;
  const cwd = runtime.repoRoot || process.cwd();
  const loadConfig = runtime.loadConfigImpl || loadDevLoopConfig;

  // Load config once at startup and share with all sub-components
  let configLoadResult;
  let requireRetrospective = false;
  let autonomyStopAt = ["merge"];
  /** @type {{ draft: { requireCi: boolean } | null, preApproval: { requireCi: boolean } | null }} */
  let gateConfig = { draft: null, preApproval: null };

  try {
    configLoadResult = await loadConfig({ repoRoot: cwd });
    const cfg = configLoadResult.config ?? {};

    requireRetrospective = resolveWorkflowConfig(cfg, "requireRetrospective");
    autonomyStopAt = resolveAutonomyStopAt(cfg);

    const draftCfg = resolveGateConfig(cfg, "draft");
    const preApprovalCfg = resolveGateConfig(cfg, "preApproval");
    // Only requireCi is extracted from gate config here because the conductor
    // delegates angle resolution and gate execution to dev-loop subagents.
    // Angles, excludeAngles, and required are consumed by the subagent layer.
    gateConfig = {
      draft: { requireCi: draftCfg.requireCi },
      preApproval: { requireCi: preApprovalCfg.requireCi },
    };
  } catch {
    // Config load failed — use safe defaults (no retrospective block, stop at merge)
    configLoadResult = { config: null, warnings: [], errors: [{ path: "<config>", message: "Failed to load config", layer: "merged" }] };
  }

  const retroGate = checkRetrospectiveGate(cwd, requireRetrospective);
  if (retroGate.blocked) {
    return {
      ok: false,
      error: retroGate.reason,
      repo: options.repo,
      blockedByRetrospective: true,
      checkedAt: new Date().toISOString(),
    };
  }

  const runCycle = !monitorOnly;
  const runMonitor = !cycleOnly;

  // Run sequentially so gh stubs (and other shared state) don't race.
  // Promise.all causes parallel gh calls that exhaust stub sequences.
  const cycleResult = runCycle
    ? await runConductorCycle({ repo: options.repo, autonomyStopAt, gateConfig }, runtime).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : null;

  const monitorResult = runMonitor
    ? await runConductorMonitor({ repo: options.repo, autoResume }, runtime).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : null;

  const cycleOk = cycleResult?.ok === true;
  const monitorOk = monitorResult?.ok === true;

  return {
    ok: (runCycle ? cycleOk : true) && (runMonitor ? monitorOk : true),
    repo: options.repo,
    checkedAt: new Date().toISOString(),
    cycle: cycleResult ?? null,
    monitor: monitorResult ?? null,
    cycleOk,
    monitorOk,
    config: {
      requireRetrospective,
      autonomyStopAt,
      gateConfig,
      configErrors: configLoadResult?.errors?.length ?? 0,
    },
    summary: {
      totalPrs: (cycleResult?.prCount ?? 0) || (monitorResult?.prCount ?? 0),
      cycleActions: cycleResult?.actions?.length ?? 0,
      needsSubagent: cycleResult?.summary?.needsSubagent ?? 0,
      readyToMerge: cycleResult?.summary?.readyToMerge ?? 0,
      waiting: cycleResult?.summary?.waiting ?? 0,
      blocked: cycleResult?.summary?.blocked ?? 0,
      done: cycleResult?.summary?.done ?? 0,
      errors: cycleResult?.summary?.errors ?? 0,
      queueStatus: monitorResult?.queueStatus ?? "unknown",
      needsAttentionCount: monitorResult?.needsAttentionCount ?? 0,
      orphanedPrCount: monitorResult?.orphanedPrCount ?? 0,
      resumePlanCount: monitorResult?.resumePlanCount ?? 0,
      manualAttentionCount: monitorResult?.manualAttentionCount ?? 0,
    },
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    env = process.env,
    ghCommand = "gh",
    cwd = process.cwd(),
  } = {},
) {
  const options = parseCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const result = await runConductor(options, {
    env,
    ghCommand,
    repoRoot: cwd,
  });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

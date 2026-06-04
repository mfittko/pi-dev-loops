#!/usr/bin/env node
/**
 * Pre-flight gate for local implementation mutations.
 *
 * Runs before any planning or implementation work to enforce:
 * 1. Worktree isolation (current directory is under tmp/worktrees/)
 * 2. Branch identity (current branch matches --expected-branch when provided)
 * 3. Subagent availability (advisory; fails-open when --require-subagents set)
 *
 * Fails closed on any violation: exit code 1 + machine-readable JSON on stderr.
 *
 * Usage:
 *   pre-flight-gate.mjs [--expected-branch <name>] [--require-subagents]
 *
 * Bypass: PI_PREFLIGHT_BYPASS=1
 */

import { execFileSync } from "node:child_process";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { requireOptionValue } from "../_cli-primitives.mjs";
import {
  isUnderWorktreePath,
  parseMainWorktreePath,
  isMainCheckout,
  detectSubagentAvailability,
} from "../../packages/core/src/loop/worktree-guard.mjs";

const PI_PREFLIGHT_BYPASS_VAR = "PI_PREFLIGHT_BYPASS";

const USAGE = `Usage:
  pre-flight-gate.mjs [--expected-branch <name>] [--require-subagents]

Gate local implementation mutations before planning or editing.

Required environment:
  (none)

Optional:
  --expected-branch <name>   Expected current branch (for branch identity check).
  --require-subagents        Require subagent availability (advisory; fails-open).

Success output (stdout, JSON):
  { "ok": true, "checks": { "worktree": true, "branch": "matched",
    "subagents": "available" } }

Violation output (stderr, JSON, exit 1):
  { "ok": false, "error": "<error_code>", "checks": { ... },
    "guidance": "<actionable instruction for the agent>" }

Bypass:
  PI_PREFLIGHT_BYPASS=1   Skip all checks (for development/testing only).`.trim();

const parseError = buildParseError(USAGE);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PreFlightGateOptions
 * @property {boolean} help
 * @property {string | undefined} expectedBranch
 * @property {boolean} requireSubagents
 */

/**
 * @param {string[]} argv
 * @returns {PreFlightGateOptions}
 */
export function parsePreFlightGateCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    expectedBranch: undefined,
    requireSubagents: false,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--expected-branch") {
      options.expectedBranch = requireOptionValue(args, "--expected-branch", parseError, { flagPattern: /^-/u });
      continue;
    }

    if (token === "--require-subagents") {
      options.requireSubagents = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  return options;
}

// ---------------------------------------------------------------------------
// Check runners
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {Record<string, string | undefined>} opts.env
 * @param {string} [opts.gitCommand]
 * @returns {{ ok: true, mainWorktreePath: string } | { ok: false, error: string, guidance: string, mainWorktreePath?: string }}
 */
function checkWorktreeIsolation({ cwd, env, gitCommand = "git" }) {
  let worktreeListOutput;
  try {
    worktreeListOutput = execFileSync(gitCommand, ["worktree", "list"], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return {
      ok: false,
      error: "worktree_list_failed",
      guidance: "Could not run `git worktree list`. Verify the repository is a valid git working directory.",
    };
  }

  const mainWorktreePath = parseMainWorktreePath(worktreeListOutput);

  if (!isUnderWorktreePath(cwd)) {
    if (mainWorktreePath !== null && isMainCheckout(cwd, mainWorktreePath)) {
      return {
        ok: false,
        error: "main_checkout_detected",
        guidance:
          `Current directory appears to be the main git checkout (${mainWorktreePath}).\n` +
          "Local implementation requires worktree isolation. Create a worktree:\n" +
          "  git worktree add -b <branch> tmp/worktrees/<slug>/ origin/main\n" +
          "Then re-run from the worktree directory.",
        mainWorktreePath,
      };
    }
    return {
      ok: false,
      error: "not_in_worktree",
      guidance:
        "Local implementation requires worktree isolation. Create a worktree:\n" +
        "  git worktree add -b <branch> tmp/worktrees/<slug>/ origin/main\n" +
        "Then re-run from the worktree directory.",
      mainWorktreePath: mainWorktreePath ?? undefined,
    };
  }

  return { ok: true, mainWorktreePath: mainWorktreePath ?? undefined };
}

/**
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {Record<string, string | undefined>} opts.env
 * @param {string | undefined} opts.expectedBranch
 * @param {string} [opts.gitCommand]
 * @returns {{ ok: true, status: "matched" | "skipped", branch?: string } | { ok: false, error: string, guidance: string }}
 */
function checkBranchIdentity({ cwd, env, expectedBranch, gitCommand = "git" }) {
  if (!expectedBranch) {
    return { ok: true, status: "skipped" };
  }

  let currentBranch;
  try {
    currentBranch = execFileSync(gitCommand, ["branch", "--show-current"], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return {
      ok: false,
      error: "branch_check_failed",
      guidance: "Could not determine current branch. Verify the repository is a valid git working directory.",
    };
  }

  if (currentBranch !== expectedBranch) {
    return {
      ok: false,
      error: "branch_mismatch",
      guidance: `Expected branch "${expectedBranch}" but current branch is "${currentBranch}". Switch to the working branch and re-run.`,
    };
  }

  return { ok: true, status: "matched", branch: currentBranch };
}

/**
 * @param {object} opts
 * @param {Record<string, string | undefined>} opts.env
 * @param {boolean} opts.requireSubagents
 * @returns {{ ok: true, status: "available" | "unavailable" | "skipped" }}
 */
function checkSubagentAvailability({ env, requireSubagents }) {
  if (!requireSubagents) {
    return { ok: true, status: "skipped" };
  }

  const available = detectSubagentAvailability({ env });
  return { ok: true, status: available ? "available" : "unavailable" };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @param {object} [io]
 * @param {NodeJS.WriteStream} [io.stdout]
 * @param {NodeJS.WriteStream} [io.stderr]
 * @param {string} [io.cwd]
 * @param {Record<string, string | undefined>} [io.env]
 * @param {string} [io.gitCommand]
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = process.cwd(),
    env = process.env,
    gitCommand = "git",
  } = {},
) {
  const options = parsePreFlightGateCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return { ok: true, help: true };
  }

  // Bypass
  if ((env[PI_PREFLIGHT_BYPASS_VAR] ?? "").trim() === "1") {
    const payload = {
      ok: true,
      checks: { worktree: true, branch: "skipped", subagents: "skipped" },
      summary: "pre-flight gate bypassed via PI_PREFLIGHT_BYPASS=1",
    };
    stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const checks = { worktree: false, branch: "skipped", subagents: "skipped" };
  const errors = [];

  // 1. Worktree isolation (always runs)
  const worktreeResult = checkWorktreeIsolation({ cwd, env, gitCommand });
  checks.worktree = worktreeResult.ok;
  if (!worktreeResult.ok) {
    errors.push({
      check: "worktree",
      error: worktreeResult.error,
      guidance: worktreeResult.guidance,
    });
  }

  // 2. Branch identity (when --expected-branch provided)
  const branchResult = checkBranchIdentity({
    cwd,
    env,
    expectedBranch: options.expectedBranch,
    gitCommand,
  });
  checks.branch = branchResult.status;
  if (!branchResult.ok) {
    errors.push({
      check: "branch",
      error: branchResult.error,
      guidance: branchResult.guidance,
    });
  }

  // 3. Subagent availability (advisory; fails-open)
  const subagentResult = checkSubagentAvailability({
    env,
    requireSubagents: options.requireSubagents,
  });
  checks.subagents = subagentResult.status;

  if (errors.length > 0) {
    const payload = {
      ok: false,
      error: errors[0].error,
      checks,
      guidance: errors.map((e) => e.guidance).join("\n\n"),
      errors,
    };
    stderr.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const payload = {
    ok: true,
    checks,
    summary: "all checks passed",
  };
  stdout.write(`${JSON.stringify(payload)}\n`);
  return payload;
}

if (isDirectCliRun(import.meta.url)) {
  runCli()
    .then((result) => {
      if (result?.ok === false) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
}

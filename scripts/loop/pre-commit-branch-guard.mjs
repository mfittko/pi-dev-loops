#!/usr/bin/env node
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { requireOptionValue, runCommand } from "../_cli-primitives.mjs";
import {
  isUnderWorktreePath,
  parseMainWorktreePath,
  isMainCheckout,
} from "../../packages/core/src/loop/worktree-guard.mjs";

const USAGE = `Usage:
  pre-commit-branch-guard.mjs --expected-branch <name> [--require-worktree] [--block-main-checkout]

Verify the current git branch identity and/or worktree isolation before local commit steps.

Required:
  --expected-branch <name>   Expected current branch name (for example PR headRefName).

Optional:
  --require-worktree         Require that the current working directory is under
                             tmp/worktrees/ (blocks mutation from non-worktree paths).
  --block-main-checkout      Block mutation when the current directory is the main
                             git worktree (detected via git worktree list).

Success output (stdout, JSON):
  { "ok": true, "branch": "<current>", "matched": true,
    "worktreeOk": <true|null>, "mainCheckoutBlocked": <true|null> }

Branch mismatch output (stderr, JSON, exit 1):
  { "ok": false, "error": "branch_mismatch",
    "current": "<actual>", "expected": "<expected>" }

Worktree rejection output (stderr, JSON, exit 1):
  { "ok": false, "error": "not_in_worktree",
    "cwd": "<cwd>", "requiredPrefix": "tmp/worktrees/" }

Main-checkout block output (stderr, JSON, exit 1):
  { "ok": false, "error": "main_checkout_blocked",
    "cwd": "<cwd>", "mainWorktree": "<path>" }

Usage errors (stderr, JSON, exit 1):
  { "ok": false, "error": "...", "usage": "..." }`.trim();

const parseError = buildParseError(USAGE);


export function parseBranchGuardCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    expectedBranch: undefined,
    requireWorktree: false,
    blockMainCheckout: false,
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

    if (token === "--require-worktree") {
      options.requireWorktree = true;
      continue;
    }

    if (token === "--block-main-checkout") {
      options.blockMainCheckout = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.expectedBranch === undefined) {
    throw parseError("--expected-branch <name> is required");
  }

  return options;
}



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
  const options = parseBranchGuardCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return { ok: true, help: true };
  }

  // Branch check (required)
  const { stdout: branchOutput } = await runCommand(gitCommand, ["branch", "--show-current"], { cwd, env });
  const currentBranch = branchOutput.trim();

  if (currentBranch !== options.expectedBranch) {
    const payload = {
      ok: false,
      error: "branch_mismatch",
      current: currentBranch,
      expected: options.expectedBranch,
    };
    stderr.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  // Worktree isolation checks (optional)
  let worktreeOk = null;
  let mainCheckoutBlocked = null;

  if (options.requireWorktree || options.blockMainCheckout) {
    let mainWorktreePath = null;

    if (options.blockMainCheckout) {
      try {
        const { stdout: wtOutput } = await runCommand(gitCommand, ["worktree", "list"], { cwd, env });
        mainWorktreePath = parseMainWorktreePath(wtOutput);
      } catch {
        // Cannot determine main checkout — treat as non-blocking for blockMainCheckout
      }
    }

    if (options.requireWorktree) {
      worktreeOk = isUnderWorktreePath(cwd);
      if (!worktreeOk) {
        const payload = {
          ok: false,
          error: "not_in_worktree",
          cwd,
          requiredPrefix: "tmp/worktrees/",
        };
        stderr.write(`${JSON.stringify(payload)}\n`);
        return payload;
      }
    }

    if (options.blockMainCheckout) {
      const isMain = isMainCheckout(cwd, mainWorktreePath);
      // Only block when actually on main checkout (not under worktree path)
      mainCheckoutBlocked = !(isMain && !isUnderWorktreePath(cwd));
      if (!mainCheckoutBlocked) {
        const payload = {
          ok: false,
          error: "main_checkout_blocked",
          cwd,
          mainWorktree: mainWorktreePath,
        };
        stderr.write(`${JSON.stringify(payload)}\n`);
        return payload;
      }
    }

    // Normalize nulls: set only what was requested
    if (!options.requireWorktree) worktreeOk = null;
    if (!options.blockMainCheckout) mainCheckoutBlocked = null;
  }

  const payload = {
    ok: true,
    branch: currentBranch,
    matched: true,
    worktreeOk,
    mainCheckoutBlocked,
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

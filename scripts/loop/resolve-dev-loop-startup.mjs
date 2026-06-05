#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveAuthoritativeStartupResumeBundle } from "../../packages/core/src/loop/public-dev-loop-routing.mjs";
import { buildParseError, formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { requireOptionValue, parsePositiveInteger } from "../_cli-primitives.mjs";
import { execFileSync } from "node:child_process";
import {
  isUnderWorktreePath,
  parseMainWorktreePath,
  isMainCheckout,
  parseAllWorktreePaths,
  isListedWorktree,
} from "../../packages/core/src/loop/worktree-guard.mjs";

import {
  validateAsyncStartContext,
  buildAsyncStartRejection,
  ASYNC_START_STATUS,
} from "../../packages/core/src/loop/async-start-contract.mjs";
import { loadDevLoopConfig, resolveWorkflowConfig } from "../../packages/core/src/config/config.mjs";

const USAGE = `Usage:
  resolve-dev-loop-startup.mjs --issue <number>
  resolve-dev-loop-startup.mjs --pr <number>
  resolve-dev-loop-startup.mjs --input <path>

Resolve the authoritative public dev-loop startup/resume bundle.
Auto-resolves state from GitHub API, git remote, and settings when
--issue or --pr is used. Use --input for non-standard states.

Required (exactly one):
  --issue <n>    Target an issue by number (auto-resolves all state)
  --pr <n>       Target a PR by number (auto-resolves all state)
  --input <path>  Path to a JSON file with canonical-state payload

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
    issue: undefined,
    pr: undefined,
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

    if (token === "--issue") {
      options.issue = parsePositiveInteger(requireOptionValue(args, "--issue", parseError), "--issue", parseError);
      continue;
    }

    if (token === "--pr") {
      options.pr = parsePositiveInteger(requireOptionValue(args, "--pr", parseError), "--pr", parseError);
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  const modeCount = [options.inputPath, options.issue, options.pr].filter(v => v !== undefined).length;
  if (modeCount > 1) {
    throw parseError("--issue, --pr, and --input are mutually exclusive; provide exactly one");
  }

  if (modeCount === 0) {
    throw parseError("--input <path>, --issue <n>, or --pr <n> is required");
  }

  return options;
}

function detectRepoSlug(cwd) {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) throw new Error(`Could not parse owner/name from git remote: ${url}`);
    return `${match[1]}/${match[2]}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Repo auto-detection failed: ${msg}. Set origin remote or use --input.`);
  }
}

function ghJson(args, cwd) {
  try {
    const stdout = execFileSync("gh", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`gh command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function mapGhState(ghState) {
  const s = String(ghState).toUpperCase();
  if (s === "OPEN") return "open";
  if (s === "CLOSED") return "closed";
  if (s === "MERGED") return "merged";
  throw new Error(`Unknown GitHub state: "${ghState}"`);
}

function hasAcSection(body) {
  if (typeof body !== "string" || body.length === 0) return false;
  return /##\s*Acceptance Criteria|##\s*AC\b|###\s*Acceptance Criteria|###\s*AC\b/i.test(body);
}

function resolveTargetPreference(cwd) {
  const candidates = [
    path.join(cwd, ".pi", "dev-loop", "settings.yaml"),
    path.join(cwd, ".pi", "dev-loop", "settings.yml"),
    path.join(cwd, ".pi", "dev-loop", "settings.json"),
  ];
  for (const settingsPath of candidates) {
    try {
      const raw = readFileSync(settingsPath, "utf8");
      if (settingsPath.endsWith(".json")) {
        const parsed = JSON.parse(raw);
        const val = parsed?.strategy?.default;
        if (val === "local-first") return "prefer_local";
        if (val === "github-first") return "prefer_github_first";
        continue;
      }
      const match = raw.match(/strategy:\s*\n\s*default:\s*["']?([^"'\s]+)["']?/);
      if (match) {
        if (match[1] === "local-first") return "prefer_local";
        if (match[1] === "github-first") return "prefer_github_first";
      }
    } catch {
      // try next candidate
    }
  }
  return "prefer_github_first";
}

/**
 * Build the canonical-state input JSON from --issue or --pr auto-resolution.
 * Exported for testability.
 */
export function buildAutoResolvedInput({ issue, pr, cwd }) {
  // Resolve repo root for reliable script/settings path resolution (thread 2)
  let repoRoot = cwd;
  try {
    repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    // Fall through — use cwd as-is
  }

  const repo = detectRepoSlug(repoRoot);

  if (issue !== undefined) {
    const artifactState = "not_applicable";
    const warnings = [];

    let issueLinkageResolution = "resolved_no_open_pr";
    let linkedPr = null;
    try {
      const linkageJson = execFileSync(process.execPath, [
        path.join(repoRoot, "scripts/github/detect-linked-issue-pr.mjs"),
        "--repo", repo, "--issue", String(issue),
      ], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const linkage = JSON.parse(linkageJson);
      if (linkage.hasOpenLinkedPr) {
        issueLinkageResolution = "resolved_linked_pr";
        linkedPr = linkage.prNumber;
      }
    } catch {
      warnings.push(`issueLinkageResolution: using default "${issueLinkageResolution}" — linked-PR detection unavailable`);
    }

    let issueReadiness;
    try {
      const issueJson = ghJson(["issue", "view", String(issue), "--repo", repo, "--json", "body"], repoRoot);
      issueReadiness = hasAcSection(issueJson.body) ? "ready" : "needs_clarification";
    } catch {
      issueReadiness = "needs_clarification";
      warnings.push(`issueReadiness: using default "${issueReadiness}" — gh issue view failed`);
    }

    let issueAssignmentState;
    try {
      const assigneesJson = ghJson(["issue", "view", String(issue), "--repo", repo, "--json", "assignees"], repoRoot);
      issueAssignmentState = (assigneesJson.assignees || []).some(a => a.login === "copilot-swe-agent")
        ? "assigned_to_copilot"
        : "unassigned";
    } catch {
      issueAssignmentState = "unassigned";
      warnings.push(`issueAssignmentState: using default "${issueAssignmentState}" — gh issue view failed`);
    }

    const targetPreference = resolveTargetPreference(repoRoot);
    const loopState = "issue_intake_start";

    return {
      intent: "start_issue_locally",
      mode: "bounded_handoff",
      targetPreference,
      artifactState,
      issueLinkageResolution,
      issueReadiness,
      issueAssignmentState,
      loopState,
      warnings: warnings.length > 0 ? warnings : undefined,
      currentState: {
        target: { kind: "issue", issue, pr: null, linkedPr, branch: null, phase: null },
        ownership: "local",
        nextActor: "local",
        status: "active",
        authorization: "authorized",
      },
    };
  }

  // --- PR path ---
  let artifactState;
  try {
    const prJson = ghJson(["pr", "view", String(pr), "--repo", repo, "--json", "state,mergedAt"], repoRoot);
    artifactState = prJson.mergedAt ? "merged" : mapGhState(prJson.state);
  } catch {
    artifactState = "open";
  }

  const targetPreference = resolveTargetPreference(repoRoot);

  return {
    intent: "continue_on_pr",
    mode: "bounded_handoff",
    targetPreference,
    artifactState,
    issueLinkageResolution: "not_applicable",
    loopState: "pr_followup_start",
    currentState: {
      target: { kind: "pr", issue: null, pr, linkedPr: null, branch: null, phase: null },
      ownership: "copilot",
      nextActor: "user",
      status: "active",
      authorization: "authorized",
    },
  };
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
 * @param {string} [options.cwd] — working directory for checkpoint file resolution (default: process.cwd())
 * @param {"required"|"allowed"} [options.asyncStartMode] — settings-driven async-start mode
 * @returns {{ ok: true, ... } | { ok: false, error: string, asyncStartContract: "rejected" }}
 */
export function buildResolveDevLoopStartupResult(input, { env = process.env, cwd = process.cwd(), asyncStartMode = "required" } = {}) {
  // #462: Always read the retrospective checkpoint file. When the durable
  // artifact says the retrospective is required, override the caller-provided
  // value to prevent bypass. Also maps the durable-artifact "required" state
  // to the core router's "missing" checkpoint state.
  try {
    const checkpointText = readFileSync(
      path.join(cwd, ".pi", "dev-loop-retrospective-checkpoint.json"),
      "utf8",
    );
    const checkpoint = JSON.parse(checkpointText);
    const rawState = checkpoint?.state;

    // Map durable-artifact states to core-router RETROSPECTIVE_CHECKPOINT_STATE values.
    const DURABLE_STATE_MAP = {
      none: "none",
      complete: "complete",
      skipped: "skipped",
      missing: "missing",
      required: "missing",  // durable artifact uses "required" to mean pending retrospective
    };

    const normalizedRaw = typeof rawState === "string" ? rawState.trim().toLowerCase() : null;
    const mappedState = DURABLE_STATE_MAP[normalizedRaw] ?? null;

    if (mappedState) {
      // Always apply the on-disk state. This prevents callers from bypassing
      // the gate by supplying a value like "complete" when the durable
      // artifact says the retrospective is still required.
      input = { ...input, retrospectiveCheckpointState: mappedState };
    } else {
      // Unrecognized state: fail-closed per the retrospective checkpoint
      // contract (unrecognized checkpoint state maps to "missing").
      input = { ...input, retrospectiveCheckpointState: "missing" };
    }
  } catch (err) {
    // Distinguish file-not-found (no checkpoint artifact exists — pass through)
    // from malformed/unreadable (file exists but is corrupt — fail closed).
    if (err?.code === "ENOENT") {
      // No checkpoint file — pass through with whatever the caller provided.
      // (A missing file is not a bypass; it means no qualifying completion
      // has been recorded yet, so no retrospective is pending.)
    } else {
      // File exists but is malformed/unreadable — fail closed per the
      // retrospective checkpoint contract.
      input = { ...input, retrospectiveCheckpointState: "missing" };
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
    const validation = validateAsyncStartContext({ env, asyncStartMode });
    if (validation.status === ASYNC_START_STATUS.REJECTED) {
      return buildAsyncStartRejection(validation);
    }
  }

  // #497: Worktree isolation enforcement for local implementation.
  // Reject local_implementation routing when the working directory is the
  // main git checkout (not a worktree under tmp/worktrees/).
  const PI_WORKTREE_BYPASS_VAR = "PI_WORKTREE_BYPASS";
  if (
    strategyKey === "local_implementation" &&
    (env[PI_WORKTREE_BYPASS_VAR] ?? "").trim() !== "1"
  ) {
    try {
      const worktreeOutput = execFileSync("git", ["worktree", "list"], {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const mainPath = parseMainWorktreePath(worktreeOutput);
      const allPaths = parseAllWorktreePaths(worktreeOutput);
      if (!isUnderWorktreePath(cwd)) {
        const reason = mainPath !== null && isMainCheckout(cwd, mainPath)
          ? `Local implementation requires worktree isolation. Current directory is the main git checkout (${mainPath}). Create a worktree under tmp/worktrees/<slug>/ and re-run.`
          : "Local implementation requires worktree isolation. Current directory is not under tmp/worktrees/. Create a worktree and re-run.";
        return {
          ok: true,
          bundleKind: "needs_reconcile",
          selectedStrategy: "none",
          requiredReads: STRATEGY_REQUIRED_READS["none"],
          nextAction: reason,
          canonicalStateSummary: summarizeCanonicalState(bundle),
          bundle,
        };
      }
      if (!isListedWorktree(cwd, allPaths)) {
        const reason = `Local implementation requires worktree isolation. Current directory is under tmp/worktrees/ but is not listed as a git worktree by \`git worktree list\`. Create a proper worktree with \`git worktree add\` and re-run.`;
        return {
          ok: true,
          bundleKind: "needs_reconcile",
          selectedStrategy: "none",
          requiredReads: STRATEGY_REQUIRED_READS["none"],
          nextAction: reason,
          canonicalStateSummary: summarizeCanonicalState(bundle),
          bundle,
        };
      }
    } catch {
      // If git worktree list fails, fail closed — we cannot validate worktree
      // isolation so we must not allow local_implementation routing from an unknown
      // directory. The pre-flight gate provides a secondary guard for the actual
      // implementation session.
      return {
        ok: true,
        bundleKind: "needs_reconcile",
        selectedStrategy: "none",
        requiredReads: STRATEGY_REQUIRED_READS["none"],
        nextAction: "Local implementation requires worktree isolation but git worktree list failed. Verify the repository and re-run from a worktree under tmp/worktrees/.",
        canonicalStateSummary: summarizeCanonicalState(bundle),
        bundle,
      };
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

  let input;
  if (options.inputPath !== undefined) {
    const text = await readFile(path.resolve(options.inputPath), "utf8");
    input = parseJsonText(text);
  } else if (options.issue !== undefined) {
    input = buildAutoResolvedInput({ issue: options.issue, cwd: process.cwd() });
  } else {
    input = buildAutoResolvedInput({ pr: options.pr, cwd: process.cwd() });
  }

  const { config: devLoopConfig, errors: configErrors = [] } = await loadDevLoopConfig({ repoRoot: process.cwd() });
  const asyncStartMode = configErrors.length === 0
    ? resolveWorkflowConfig(devLoopConfig, "asyncStartMode")
    : "required";
  const result = buildResolveDevLoopStartupResult(input, { asyncStartMode });

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

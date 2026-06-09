#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { requireOptionValue, parsePositiveInteger } from "../_cli-primitives.mjs";
import { detectRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)), "..");

const USAGE = `Usage:
  dev-loops loop info --issue <number>
  dev-loops loop info --pr <number>
Read-only state inspection for issues and PRs.
Required (exactly one):
  --issue <n>    Issue number
  --pr <n>       PR number
Optional:
  --json         Machine-readable JSON output (default: human-readable summary)
  --repo <slug>  Repository slug (auto-detected from git remote when omitted)
Exit codes:
  0  Success
  1  Argument error or runtime failure`.trim();

const parseError = buildParseError(USAGE);

function parseCliArgs(argv) {
  const args = [...argv];
  const opts = { help: false, issue: undefined, pr: undefined, json: false, repo: undefined };
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--help" || token === "-h") { opts.help = true; return opts; }
    if (token === "--json") { opts.json = true; continue; }
    if (token === "--issue") { opts.issue = parsePositiveInteger(requireOptionValue(args, "--issue", parseError), "--issue", parseError); continue; }
    if (token === "--pr") { opts.pr = parsePositiveInteger(requireOptionValue(args, "--pr", parseError), "--pr", parseError); continue; }
    if (token === "--repo") { opts.repo = requireOptionValue(args, "--repo", parseError); continue; }
    throw parseError(`Unknown argument: ${token}`);
  }
  const modes = [opts.issue, opts.pr].filter(v => v !== undefined).length;
  if (modes > 1) throw parseError("--issue and --pr are mutually exclusive");
  if (modes === 0) throw parseError("--issue <n> or --pr <n> is required");
  return opts;
}

function ghJson(args, cwd) {
  const stdout = execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(stdout);
}

function runNode(scriptPath, args, cwd) {
  const stdout = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(stdout);
}

function formatBranchDisplay(headRefName, baseRefName) {
  return `${headRefName} ← ${baseRefName}`;
}

function formatCiDisplay(ciStatus, ciConclusion) {
  if (!ciStatus || ciStatus === "none") return "no CI";
  if (ciStatus === "pending") return "CI pending";
  if (ciStatus === "failure") return `CI ❌ (${ciConclusion || "failed"})`;
  if (ciStatus === "crediblyGreen") return "CI ✅ (local)";
  return `CI ${ciStatus}`;
}

function formatPrSummary(prData, handoffResult) {
  const lines = [];
  lines.push(`PR #${prData.number}: ${prData.title}`);
  lines.push(`  Branch: ${formatBranchDisplay(prData.headRefName, prData.baseRefName)}`);
  lines.push(`  State: ${prData.state}${prData.isDraft ? " (draft)" : ""}`);
  lines.push(`  Author: ${prData.author?.login || "unknown"}`);
  
  if (handoffResult?.snapshot) {
    const s = handoffResult.snapshot;
    if (s.ciStatus !== undefined) {
      lines.push(`  CI: ${formatCiDisplay(s.ciStatus, s.ciConclusion)}`);
    }
    if (s.unresolvedThreadCount !== undefined) {
      lines.push(`  Unresolved threads: ${s.unresolvedThreadCount}`);
    }
    if (s.completedCopilotRoundCount !== undefined && s.completedCopilotRoundCount > 0) {
      lines.push(`  Copilot rounds: ${s.completedCopilotRoundCount}`);
    }
    if (s.reviewRoundCount !== undefined && s.reviewRoundCount > 0) {
      lines.push(`  Review rounds: ${s.reviewRoundCount}`);
    }
    if (s.copilotReviewOnCurrentHead) {
      lines.push(`  Copilot review: requested on current head`);
    }
  }
  
  if (handoffResult?.action) {
    lines.push(`  Action: ${handoffResult.action}`);
  }
  if (handoffResult?.nextAction) {
    lines.push(`  Next: ${handoffResult.nextAction}`);
  }
  if (handoffResult?.state) {
    lines.push(`  Loop state: ${handoffResult.state}`);
  }
  
  return lines.join("\n");
}

function formatIssueSummary(issueData, startupBundle, linkedPrData) {
  const lines = [];
  lines.push(`Issue #${issueData.number}: ${issueData.title}`);
  lines.push(`  State: ${issueData.state}`);
  
  if (issueData.assignees?.length > 0) {
    const names = issueData.assignees.map(a => a.login).join(", ");
    lines.push(`  Assignees: ${names}`);
  }
  
  const bundle = startupBundle?.bundle || startupBundle;
  if (bundle) {
    if (bundle.loopState) lines.push(`  Loop state: ${bundle.loopState}`);
    if (bundle.selectedStrategy) lines.push(`  Strategy: ${bundle.selectedStrategy}`);
    if (bundle.routeKind) lines.push(`  Route: ${bundle.routeKind}`);
    if (bundle.nextAction) lines.push(`  Next: ${bundle.nextAction}`);
  }
  
  // Acceptance criteria check
  if (issueData.body) {
    const hasAc = /##\s*Acceptance Criteria|##\s*AC\b|###\s*Acceptance Criteria|###\s*AC\b/i.test(issueData.body);
    lines.push(`  Acceptance criteria: ${hasAc ? "present" : "missing"}`);
  }
  
  // Linked PR
  if (linkedPrData) {
    lines.push(`  Linked PR: #${linkedPrData.number} (${linkedPrData.state}${linkedPrData.isDraft ? ", draft" : ""})`);
    if (linkedPrData.headRefName) {
      lines.push(`    Branch: ${formatBranchDisplay(linkedPrData.headRefName, linkedPrData.baseRefName)}`);
    }
    if (linkedPrData.ciStatus !== undefined) {
      lines.push(`    CI: ${formatCiDisplay(linkedPrData.ciStatus, linkedPrData.ciConclusion)}`);
    }
    if (linkedPrData.unresolvedThreadCount !== undefined) {
      lines.push(`    Unresolved threads: ${linkedPrData.unresolvedThreadCount}`);
    }
    if (linkedPrData.loopState) {
      lines.push(`    Loop state: ${linkedPrData.loopState}`);
    }
    if (linkedPrData.action) {
      lines.push(`    Action: ${linkedPrData.action}`);
    }
  }
  
  return lines.join("\n");
}

function buildPrInfo(prNumber, repo, cwd) {
  // Fetch PR metadata
  const prData = ghJson(["pr", "view", String(prNumber), "--repo", repo, "--json", "number,title,body,state,isDraft,headRefName,baseRefName,author,mergedAt,url,reviewRequests"], cwd);
  
  // Get handoff state
  let handoffResult = null;
  try {
    const handoffScript = path.join(REPO_ROOT, "scripts/loop/copilot-pr-handoff.mjs");
    handoffResult = runNode(handoffScript, ["--pr", String(prNumber), "--repo", repo], cwd);
  } catch {
    // Handoff unavailable — still show PR metadata
  }
  
  return { prData, handoffResult };
}

function buildIssueInfo(issueNumber, repo, cwd) {
  // Fetch issue metadata
  const issueData = ghJson(["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,title,body,state,labels,assignees,milestone,url"], cwd);
  
  // Get startup bundle
  let startupBundle = null;
  try {
    const startupScript = path.join(REPO_ROOT, "scripts/loop/resolve-dev-loop-startup.mjs");
    startupBundle = runNode(startupScript, ["--issue", String(issueNumber)], cwd);
  } catch {
    // Startup resolver unavailable
  }
  
  // Check for linked PR
  let linkedPrInfo = null;
  try {
    const linkageScript = path.join(REPO_ROOT, "scripts/github/detect-linked-issue-pr.mjs");
    const linkage = runNode(linkageScript, ["--repo", repo, "--issue", String(issueNumber)], cwd);
    if (linkage.hasOpenLinkedPr && linkage.prNumber) {
      // Get PR metadata
      const prData = ghJson(["pr", "view", String(linkage.prNumber), "--repo", repo, "--json", "number,title,state,isDraft,headRefName,baseRefName,author,url"], cwd);
      
      // Get handoff state for linked PR
      let handoffResult = null;
      try {
        const handoffScript = path.join(REPO_ROOT, "scripts/loop/copilot-pr-handoff.mjs");
        handoffResult = runNode(handoffScript, ["--pr", String(linkage.prNumber), "--repo", repo], cwd);
      } catch { /* handoff unavailable */ }
      
      linkedPrInfo = {
        ...prData,
        ciStatus: handoffResult?.snapshot?.ciStatus,
        ciConclusion: handoffResult?.snapshot?.ciConclusion,
        unresolvedThreadCount: handoffResult?.snapshot?.unresolvedThreadCount,
        loopState: handoffResult?.state,
        action: handoffResult?.action,
      };
    }
  } catch {
    // Linked PR detection unavailable
  }
  
  return { issueData, startupBundle, linkedPrInfo: linkedPrInfo };
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  const opts = parseCliArgs(argv);
  if (opts.help) { stdout.write(`${USAGE}\n`); return; }
  
  const cwd = process.cwd();
  const repo = opts.repo || detectRepoSlug(cwd);
  if (!repo) {
    stderr.write(JSON.stringify({ ok: false, error: "Repo auto-detection failed. Set origin remote or use --repo." }) + "\n");
    process.exitCode = 1;
    return;
  }
  
  try {
    if (opts.issue !== undefined) {
      const { issueData, startupBundle, linkedPrInfo } = buildIssueInfo(opts.issue, repo, cwd);
      
      if (opts.json) {
        stdout.write(JSON.stringify({ ok: true, kind: "issue", issue: issueData, startup: startupBundle, linkedPr: linkedPrInfo }) + "\n");
      } else {
        stdout.write(formatIssueSummary(issueData, startupBundle, linkedPrInfo) + "\n");
      }
    } else {
      const { prData, handoffResult } = buildPrInfo(opts.pr, repo, cwd);
      
      if (opts.json) {
        stdout.write(JSON.stringify({ ok: true, kind: "pr", pr: prData, handoff: handoffResult }) + "\n");
      } else {
        stdout.write(formatPrSummary(prData, handoffResult) + "\n");
      }
    }
  } catch (err) {
    stderr.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + "\n");
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

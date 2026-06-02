#!/usr/bin/env node
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { detectGateReviewEvidence } from "./detect-gate-review-evidence.mjs";
import { upsertGateReviewComment } from "./upsert-gate-review-comment.mjs";

const USAGE = `Usage: reconcile-draft-gate.mjs --repo <owner/name> --pr <number> [--skip-checks]

Recovery path for non-draft PRs that bypassed the required draft_gate.
Converts the PR to draft, validates the head, posts a reconciling clean
draft_gate comment, then marks the PR ready for review again.

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Optional:
  --skip-checks         Skip head-SHA CI/check validation before posting
                        the reconciling gate comment. Use only when the
                        CI state is already known-green.

Output (stdout, JSON):
  {
    "ok": true,
    "action": "reconciled",
    "repo": "owner/repo",
    "pr": 17,
    "headSha": "abc1234",
    "commentId": 101,
    "commentUrl": "https://github.com/owner/repo/pull/17#issuecomment-101"
  }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success — PR was reconciled and gate evidence posted
  1  Argument error, gh failure, or unrecoverable state`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

export function parseReconcileDraftGateCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    skipChecks: false,
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

    if (token === "--pr") {
      options.pr = parsePrNumber(requireOptionValue(args, "--pr", parseError), parseError);
      continue;
    }

    if (token === "--skip-checks") {
      options.skipChecks = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  const missing = ["repo", "pr"].filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    throw parseError("reconcile-draft-gate requires --repo and --pr");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

async function convertPrToDraft({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(ghCommand, [
    "api",
    "-X", "PATCH",
    `repos/${repo}/pulls/${pr}`,
    "-f", "draft=true",
  ], env);

  if (result.code !== 0) {
    throw new Error(`Failed to convert PR #${pr} to draft: ${result.stderr.trim() || `exit code ${result.code}`}`);
  }

  const payload = parseJsonText(result.stdout, { label: `gh api repos/${repo}/pulls/${pr} (draft=true)` });

  if (payload.draft !== true) {
    throw new Error(`PR #${pr} was not set to draft state after mutation`);
  }

  return payload;
}

async function markPrReady({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(ghCommand, [
    "pr", "ready", String(pr),
    "--repo", repo,
  ], env);

  if (result.code !== 0) {
    throw new Error(`Failed to mark PR #${pr} ready: ${result.stderr.trim() || `exit code ${result.code}`}`);
  }

  return true;
}

export async function reconcileDraftGate(options, { env = process.env, ghCommand = "gh" } = {}) {
  // Step 1: Inspect current PR state
  const initialEvidence = await detectGateReviewEvidence({ repo: options.repo, pr: options.pr }, { env, ghCommand });

  if (!initialEvidence.ok) {
    throw new Error(`Failed to inspect PR #${options.pr} evidence: ${initialEvidence.error || "unknown error"}`);
  }

  const headSha = initialEvidence.currentHeadSha;
  if (!headSha) {
    throw new Error(`Could not resolve current head SHA for PR #${options.pr}`);
  }

  // Step 2: Convert PR to draft
  await convertPrToDraft({ repo: options.repo, pr: options.pr }, { env, ghCommand });

  // Step 3: Post a reconciling clean draft_gate comment
  const gateResult = await upsertGateReviewComment({
    repo: options.repo,
    pr: options.pr,
    gate: "draft_gate",
    headSha,
    verdict: "clean",
    findingsSummary: options.skipChecks
      ? "Reconciled non-draft PR — draft gate auto-reconciled (checks skipped)."
      : "Reconciled non-draft PR — draft gate auto-reconciled.",
    nextAction: "Mark ready for review (auto-reconciled).",
  }, { env, ghCommand });

  if (!gateResult.ok) {
    // Revert: mark PR ready again before throwing
    try {
      await markPrReady({ repo: options.repo, pr: options.pr }, { env, ghCommand });
    } catch {
      // Best-effort revert
    }
    throw new Error(`Failed to post reconciling draft_gate comment: ${gateResult.error || "unknown error"}`);
  }

  // Step 4: Mark PR ready for review
  await markPrReady({ repo: options.repo, pr: options.pr }, { env, ghCommand });

  return {
    ok: true,
    action: "reconciled",
    repo: options.repo,
    pr: options.pr,
    headSha: gateResult.headSha || headSha,
    currentHeadSha: gateResult.currentHeadSha || headSha,
    commentId: gateResult.commentId,
    commentUrl: gateResult.commentUrl,
  };
}

async function main() {
  let options;
  try {
    options = parseReconcileDraftGateCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  try {
    const result = await reconcileDraftGate(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  await main();
}

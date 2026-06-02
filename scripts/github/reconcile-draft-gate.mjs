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

Fail-closed guards:
  - Refuses to reconcile if any draft_gate evidence already exists on the PR.
  - When --skip-checks is not set, requires CI to be green on the current head
    SHA before posting the reconciling gate comment.

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

const CONVERT_TO_DRAFT_MUTATION = [
  "mutation($pullRequestId:ID!) {",
  "  convertPullRequestToDraft(input: {pullRequestId: $pullRequestId}) {",
  "    pullRequest {",
  "      id",
  "      isDraft",
  "    }",
  "  }",
  "}",
].join("\n");

const PR_ID_QUERY = [
  "query($owner:String!, $name:String!, $number:Int!) {",
  "  repository(owner: $owner, name: $name) {",
  "    pullRequest(number: $number) {",
  "      id",
  "      isDraft",
  "    }",
  "  }",
  "}",
].join("\n");

async function resolvePrNodeId({ repo, pr }, { env, ghCommand }) {
  const [owner, name] = repo.split("/");
  const result = await runChild(ghCommand, [
    "api", "graphql",
    "-f", "query=" + PR_ID_QUERY,
    "-f", `owner=${owner}`,
    "-f", `name=${name}`,
    "-F", `number=${pr}`,
  ], env);

  if (result.code !== 0) {
    throw new Error(
      `Failed to resolve PR node ID for #${pr}: ${result.stderr.trim() || `exit code ${result.code}`}`
    );
  }

  const payload = parseJsonText(result.stdout, {
    label: `gh api graphql (resolvePrNodeId for #${pr})`,
  });

  const prData = payload?.data?.repository?.pullRequest;
  if (!prData?.id) {
    throw new Error(`Could not resolve PR node ID for #${pr}`);
  }

  return { id: prData.id, isDraft: prData.isDraft };
}

async function convertPrToDraft({ repo, pr }, { env, ghCommand }) {
  const { id } = await resolvePrNodeId({ repo, pr }, { env, ghCommand });

  const result = await runChild(ghCommand, [
    "api", "graphql",
    "-f", "query=" + CONVERT_TO_DRAFT_MUTATION,
    "-F", `pullRequestId=${id}`,
  ], env);

  if (result.code !== 0) {
    throw new Error(
      `Failed to convert PR #${pr} to draft: ${result.stderr.trim() || `exit code ${result.code}`}`
    );
  }

  const payload = parseJsonText(result.stdout, {
    label: `gh api graphql (convertPullRequestToDraft #${pr})`,
  });

  const converted = payload?.data?.convertPullRequestToDraft?.pullRequest;
  if (converted?.isDraft !== true) {
    throw new Error(`PR #${pr} was not set to draft state after mutation`);
  }

  return converted;
}

async function markPrReady({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(ghCommand, [
    "pr", "ready", String(pr),
    "--repo", repo,
  ], env);

  if (result.code !== 0) {
    throw new Error(
      `Failed to mark PR #${pr} ready: ${result.stderr.trim() || `exit code ${result.code}`}`
    );
  }

  return true;
}

function normalizeCheckBucket(check = {}) {
  const bucket = typeof check.bucket === "string" ? check.bucket.trim().toLowerCase() : "";
  if (bucket) {
    return bucket;
  }

  const state = typeof check.state === "string" ? check.state.trim().toLowerCase() : "";
  if (["success", "passed", "pass"].includes(state)) {
    return "pass";
  }
  if (["skipped", "skipping"].includes(state)) {
    return "skipping";
  }
  if (["pending", "queued", "in_progress", "waiting", "requested", "expected", "action_required"].includes(state)) {
    return "pending";
  }
  if (["failure", "failed", "fail", "error", "timed_out", "startup_failure"].includes(state)) {
    return "fail";
  }
  if (["cancel", "cancelled", "canceled"].includes(state)) {
    return "cancel";
  }
  return state || "unknown";
}

function summarizeBlockingChecks(blockingChecks) {
  if (!Array.isArray(blockingChecks) || blockingChecks.length === 0) {
    return "unknown blocking CI state";
  }

  return blockingChecks
    .map((check) => `${check.name || "unnamed-check"}=${check.bucket}`)
    .join(", ");
}

async function checkCiStatus({ repo, pr, headSha }, { env, ghCommand }) {
  const result = await runChild(ghCommand, [
    "pr", "checks", String(pr),
    "--repo", repo,
    "--json", "bucket,state,name,workflow",
  ], env);

  if (result.code !== 0 && result.code !== 8) {
    throw new Error(
      `Failed to check PR #${pr} CI status: ${result.stderr.trim() || `exit code ${result.code}`}`
    );
  }

  const payload = parseJsonText(result.stdout || "[]", {
    label: `gh pr checks #${pr}`,
  });
  if (!Array.isArray(payload)) {
    throw new Error(`Invalid gh pr checks payload for PR #${pr}: expected an array`);
  }

  if (payload.length === 0) {
    return {
      status: "none",
      checks: [],
      blockingSummary: `No CI/check runs were reported for PR #${pr} head ${headSha.slice(0, 7)}.`,
    };
  }

  const checks = payload.map((check) => ({
    name: typeof check?.name === "string" && check.name.trim().length > 0 ? check.name.trim() : null,
    workflow: typeof check?.workflow === "string" && check.workflow.trim().length > 0 ? check.workflow.trim() : null,
    state: typeof check?.state === "string" && check.state.trim().length > 0 ? check.state.trim() : null,
    bucket: normalizeCheckBucket(check),
  }));
  const blockingChecks = checks.filter((check) => !["pass", "skipping"].includes(check.bucket));

  return {
    status: blockingChecks.length === 0 ? "success" : "blocked",
    checks,
    blockingChecks,
    blockingSummary: blockingChecks.length === 0
      ? null
      : `Blocking CI/check state on head ${headSha.slice(0, 7)}: ${summarizeBlockingChecks(blockingChecks)}.`,
  };
}

export async function reconcileDraftGate(options, { env = process.env, ghCommand = "gh" } = {}) {
  // Step 1: Inspect current PR state
  const initialEvidence = await detectGateReviewEvidence(
    { repo: options.repo, pr: options.pr },
    { env, ghCommand }
  );

  if (!initialEvidence.ok) {
    throw new Error(
      `Failed to inspect PR #${options.pr} evidence: ${initialEvidence.error || "unknown error"}`
    );
  }

  const headSha = initialEvidence.currentHeadSha;
  if (!headSha) {
    throw new Error(`Could not resolve current head SHA for PR #${options.pr}`);
  }

  // Fail-closed guard: refuse to reconcile if any draft_gate evidence already exists.
  if (initialEvidence.draftGate?.visible) {
    throw new Error(
      `PR #${options.pr} already has a visible draft_gate comment (verdict: ` +
      `${initialEvidence.draftGate.verdict || "unknown"}). Refusing to overwrite existing ` +
      `evidence. Reconcile manually or clear the existing comment first.`
    );
  }

  if (initialEvidence.draftGateMarker?.visible) {
    throw new Error(
      `PR #${options.pr} already has a visible draft_gate marker. Refusing to overwrite ` +
      `existing evidence. Reconcile manually or clear the existing marker first.`
    );
  }

  // Check CI status unless --skip-checks is set
  if (!options.skipChecks) {
    const ciStatus = await checkCiStatus(
      { repo: options.repo, pr: options.pr, headSha },
      { env, ghCommand }
    );

    if (ciStatus.status !== "success") {
      throw new Error(
        `PR #${options.pr} CI is not green. ${ciStatus.blockingSummary || "No successful check state was confirmed."} ` +
        `Refusing to post a clean draft_gate comment. Fix CI or use --skip-checks.`
      );
    }
  }

  // Step 2: Convert PR to draft using GraphQL mutation
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
      : "Reconciled non-draft PR — draft gate auto-reconciled (CI green).",
    nextAction: "Mark ready for review (auto-reconciled).",
  }, { env, ghCommand });

  if (!gateResult.ok) {
    // Revert: mark PR ready again before throwing
    try {
      await markPrReady({ repo: options.repo, pr: options.pr }, { env, ghCommand });
    } catch {
      // Best-effort revert
    }
    throw new Error(
      `Failed to post reconciling draft_gate comment: ${gateResult.error || "unknown error"}`
    );
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
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`
    );
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  await main();
}

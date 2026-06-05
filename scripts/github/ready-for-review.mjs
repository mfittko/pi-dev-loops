#!/usr/bin/env node
import { buildParseError, formatCliError, isDirectCliRun, parseJsonText, summarizeGateReviewComments, summarizeGateReviewCommentMarkers } from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import { loadDevLoopConfig, resolveGateConfig } from "@pi-dev-loops/core/config";

const USAGE = `Usage: ready-for-review.mjs --repo <owner/name> --pr <number> [--skip-gate-check] [--skip-ci-check]

Wrapper around \`gh pr ready\` that enforces gate-evidence validation before
allowing a draft→ready transition.

Behavior:
  - fetches live PR state (draft flag, head SHA, CI status)
  - validates visible clean draft_gate evidence exists on current head
  - requires green CI unless config disables \`gates.draft.requireCi\`
  - calls \`gh pr ready\` only when all guards pass
  - fails closed when gate evidence is missing or CI is failing

Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
  --pr <number>         Pull request number

Optional:
  --skip-gate-check     Skip draft_gate evidence validation (emergency-only)
  --skip-ci-check       Skip CI green validation before gate check

Output (stdout, JSON):
  {
    "ok": true,
    "action": "marked_ready",
    "repo": "owner/repo",
    "pr": 17,
    "headSha": "abc1234",
    "draftGateSatisfied": true,
    "ciStatus": "success"
  }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  \`gh pr ready\` succeeded
  1  wrapper validation failed, gate evidence missing, or \`gh\` could not be spawned
  N  same non-zero exit code returned by \`gh pr ready\``.trim();

const parseError = buildParseError(USAGE);

const PR_VIEW_QUERY = `query($owner:String!, $name:String!, $number:Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      isDraft
      headRefOid
      state
      mergeStateStatus
    }
  }
}`;

function emptyGateSummary() {
  return {
    visible: false,
    headSha: null,
    verdict: null,
    findingsSummary: null,
    nextAction: null,
    commentId: null,
    commentUrl: null,
    updatedAt: null,
  };
}

function emptyGateMarkerSummary() {
  return {
    visible: false,
    headSha: null,
    verdict: null,
    findingsSummary: null,
    nextAction: null,
    contractComplete: false,
    commentId: null,
    commentUrl: null,
    updatedAt: null,
  };
}

function normalizeGateSummary(summary) {
  if (!summary) return emptyGateSummary();
  return {
    visible: true,
    headSha: summary.headSha,
    verdict: summary.verdict,
    findingsSummary: summary.findingsSummary,
    nextAction: summary.nextAction,
    commentId: summary.commentId,
    commentUrl: summary.commentUrl,
    updatedAt: summary.updatedAt,
  };
}

function normalizeGateMarkerSummary(summary) {
  if (!summary) return emptyGateMarkerSummary();
  return {
    visible: true,
    headSha: summary.headSha,
    verdict: summary.verdict,
    findingsSummary: summary.findingsSummary,
    nextAction: summary.nextAction,
    contractComplete: summary.contractComplete === true,
    commentId: summary.commentId,
    commentUrl: summary.commentUrl,
    updatedAt: summary.updatedAt,
  };
}

export function parseReadyForReviewCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    skipGateCheck: false,
    skipCiCheck: false,
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

    if (token === "--skip-gate-check") {
      options.skipGateCheck = true;
      continue;
    }

    if (token === "--skip-ci-check") {
      options.skipCiCheck = true;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  const missing = ["repo", "pr"].filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    throw parseError(`ready-for-review requires --repo and --pr`);
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }
  return parseJsonText(result.stdout, { label: `gh ${args.slice(0, 2).join(" ")}` });
}

async function fetchPrState({ repo, pr }, { env, ghCommand }) {
  const [owner, name] = repo.split("/");
  const result = await runGhJson(
    ["api", "graphql", "-f", `query=${PR_VIEW_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr}`],
    { env, ghCommand },
  );

  const prData = result?.data?.repository?.pullRequest;
  if (!prData) {
    throw new Error(`Could not fetch PR #${pr} state from ${repo}`);
  }

  return {
    id: prData.id,
    isDraft: prData.isDraft === true,
    headRefOid: typeof prData.headRefOid === "string" ? prData.headRefOid.trim() : null,
    state: typeof prData.state === "string" ? prData.state.trim() : null,
    mergeStateStatus: typeof prData.mergeStateStatus === "string" ? prData.mergeStateStatus.trim() : null,
  };
}

async function fetchCiStatus({ repo, pr }, { env, ghCommand }) {
  const result = await runChild(ghCommand, [
    "pr", "checks", String(pr), "--repo", repo, "--json", "bucket,state,name,workflow",
  ], env);

  if (result.code !== 0 && result.code !== 1 && result.code !== 8) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh pr checks failed: ${detail}`);
  }

  const stdout = result.stdout.trim();
  if (stdout.length === 0) {
    return { status: "none", checks: [], blockingChecks: [] };
  }

  const payload = parseJsonText(stdout, { label: "gh pr checks" });
  if (!Array.isArray(payload)) {
    return { status: "none", checks: [], blockingChecks: [] };
  }

  function normalizeCheckBucket(check = {}) {
    const bucket = typeof check?.bucket === "string" ? check.bucket.trim().toLowerCase() : "";
    if (bucket) return bucket;
    const state = typeof check?.state === "string" ? check.state.trim().toLowerCase() : "";
    if (["success", "passed", "pass"].includes(state)) return "pass";
    if (["skipped", "skipping"].includes(state)) return "skipping";
    if (["pending", "queued", "in_progress", "waiting", "requested", "expected", "action_required"].includes(state)) return "pending";
    if (["failure", "failed", "fail", "error", "timed_out", "startup_failure"].includes(state)) return "fail";
    if (["cancel", "cancelled", "canceled"].includes(state)) return "cancel";
    return state || "unknown";
  }

  const checks = payload.map((check) => ({
    name: typeof check?.name === "string" ? check.name.trim() : null,
    workflow: typeof check?.workflow === "string" ? check.workflow.trim() : null,
    state: typeof check?.state === "string" ? check.state.trim() : null,
    bucket: normalizeCheckBucket(check),
  }));

  const blockingChecks = checks.filter((check) => !["pass", "skipping"].includes(check.bucket));

  return {
    status: blockingChecks.length === 0 ? "success" : "blocked",
    checks,
    blockingChecks,
    blockingSummary: blockingChecks.length > 0
      ? `Blocking checks: ${blockingChecks.map((c) => `${c.name || "unnamed"}=${c.bucket}`).join(", ")}`
      : null,
  };
}

async function fetchGateEvidence({ repo, pr, headSha }, { env, ghCommand }) {
  const commentsResult = await runChild(ghCommand, [
    "api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments?per_page=100`,
  ], env);

  if (commentsResult.code !== 0) {
    const detail = commentsResult.stderr.trim() || `exit code ${commentsResult.code}`;
    throw new Error(`Failed to fetch PR comments: ${detail}`);
  }

  const commentsPayload = parseJsonText(commentsResult.stdout, { label: "gh issue comments" });
  const comments = Array.isArray(commentsPayload)
    ? commentsPayload.every((e) => Array.isArray(e)) ? commentsPayload.flat() : commentsPayload
    : [];

  const commentSummary = summarizeGateReviewComments(comments);
  const markerSummary = summarizeGateReviewCommentMarkers(comments, { headSha });

  const draftGate = normalizeGateSummary(commentSummary.draft_gate);
  const draftGateMarker = normalizeGateMarkerSummary(markerSummary.draft_gate);

  const markerHeadMatches = draftGateMarker.headSha !== null && headSha !== null && headSha.startsWith(draftGateMarker.headSha);
  const currentHeadClean = draftGateMarker.visible && markerHeadMatches && draftGateMarker.verdict === "clean" && draftGateMarker.contractComplete;
  const cleanEvidenceExists = draftGate.visible && draftGate.verdict === "clean" && draftGate.headSha !== null;

  return {
    draftGate,
    draftGateMarker,
    currentHeadClean,
    cleanEvidenceExists,
  };
}

export async function readyForReview(options, { env = process.env, ghCommand = "gh", repoRoot = process.cwd() } = {}) {
  const { config } = await loadDevLoopConfig({ repoRoot });
  const draftGateConfig = resolveGateConfig(config, "draft");
  const requireCi = draftGateConfig?.requireCi !== false && !options.skipCiCheck;

  // Step 1: Fetch PR state
  const prState = await fetchPrState({ repo: options.repo, pr: options.pr }, { env, ghCommand });
  const headSha = prState.headRefOid;

  if (!headSha) {
    throw new Error(`Could not resolve head SHA for PR #${options.pr}`);
  }

  // Step 2: Verify PR is in draft state
  if (!prState.isDraft) {
    throw new Error(
      `PR #${options.pr} is not in draft state (state: ${prState.state || "unknown"}). ` +
      `ready-for-review only transitions draft PRs to ready.`
    );
  }

  // Step 3: Check CI (if required by config and not skipped)
  let ciStatus = null;
  if (requireCi) {
    ciStatus = await fetchCiStatus({ repo: options.repo, pr: options.pr }, { env, ghCommand });
    if (ciStatus.status === "blocked") {
      throw new Error(
        `PR #${options.pr} has blocking CI checks: ${ciStatus.blockingSummary}. ` +
        `Fix blocking checks before marking ready for review, or use --skip-ci-check to override.`
      );
    }
    if (ciStatus.status !== "success") {
      throw new Error(
        `PR #${options.pr} CI is not green (status: ${ciStatus.status}). ` +
        `Wait for CI to settle green before marking ready for review, or use --skip-ci-check to override.`
      );
    }
  }

  // Step 4: Validate draft_gate evidence (fail-closed guard)
  let gateEvidence = null;
  if (!options.skipGateCheck) {
    gateEvidence = await fetchGateEvidence({ repo: options.repo, pr: options.pr, headSha }, { env, ghCommand });

    if (!gateEvidence.cleanEvidenceExists && !gateEvidence.currentHeadClean) {
      throw new Error(
        `PR #${options.pr} has no visible clean draft_gate evidence on current head ${headSha.slice(0, 7)}. ` +
        `Run the draft gate before marking ready for review, or use --skip-gate-check for emergency override.`
      );
    }

    if (!gateEvidence.currentHeadClean) {
      throw new Error(
        `PR #${options.pr} draft_gate marker does not match current head ${headSha.slice(0, 7)}. ` +
        `The draft gate evidence was recorded against a different commit. ` +
        `Re-run the draft gate on the current head before marking ready for review.`
      );
    }
  }

  // Step 5: Call gh pr ready
  const readyResult = await runChild(ghCommand, [
    "pr", "ready", String(options.pr), "--repo", options.repo,
  ], env);

  if (readyResult.code !== 0) {
    const detail = readyResult.stderr.trim() || `exit code ${readyResult.code}`;
    throw new Error(`gh pr ready failed: ${detail}`);
  }

  return {
    ok: true,
    action: "marked_ready",
    repo: options.repo,
    pr: options.pr,
    headSha,
    draftGateSatisfied: gateEvidence ? gateEvidence.currentHeadClean : null,
    ciStatus: ciStatus?.status ?? null,
    gateCheckSkipped: options.skipGateCheck === true,
    ciCheckSkipped: options.skipCiCheck === true,
  };
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const options = parseReadyForReviewCliArgs(argv);

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const result = await readyForReview(options, runtime);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (isDirectCliRun(import.meta.url)) {
  try {
    const exitCode = await main();
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
  }
}

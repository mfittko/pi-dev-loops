#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildParseError,
  formatCliError,
  isDirectCliRun,
  parseJsonText,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "../_core-helpers.mjs";
import { parsePositiveInteger, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
const DEFAULT_LIMIT = 20;
const USAGE = `Usage: audit-merged-pr-gate-evidence.mjs --repo <owner/name> [--limit <n>] [--output <path>]
Audit the most recent merged pull requests for visible dev-loop gate evidence.
The check fetches recent merged PRs through \`gh pr list\` and visible issue
comments through \`gh api\`, then reports PRs that lack a clean draft_gate
comment or a clean current-head pre_approval_gate comment.
Required:
  --repo <owner/name>   Repository slug (e.g. owner/repo)
Optional:
  --limit <n>           Number of recent merged PRs to audit (default: 20)
  --output <path>       Write the JSON summary to this path as well as stdout
Output (stdout, JSON):
  {
    "ok": true,
    "repo": "owner/repo",
    "limit": 20,
    "auditedCount": 20,
    "allHaveRequiredGateEvidence": true,
    "missingEvidence": []
  }
Exit codes:
  0  Audit completed, even when some PRs are missing evidence
  1  Argument error, gh failure, malformed gh JSON, or output write failure`.trim();
const parseError = buildParseError(USAGE);
function normalizeOutputPath(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    throw parseError("--output must be a non-empty path");
  }
  return normalized;
}
export function parseAuditMergedPrGateEvidenceCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    limit: DEFAULT_LIMIT,
    outputPath: undefined,
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
    if (token === "--limit") {
      options.limit = parsePositiveInteger(requireOptionValue(args, "--limit", parseError), "--limit", parseError);
      continue;
    }
    if (token === "--output") {
      options.outputPath = normalizeOutputPath(requireOptionValue(args, "--output", parseError));
      continue;
    }
    throw parseError(`Unknown argument: ${token}`);
  }
  if (options.repo === undefined) {
    throw parseError("audit-merged-pr-gate-evidence requires --repo <owner/name>");
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
function flattenPaginatedPayload(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid gh api payload: expected an array");
  }
  return payload.every((entry) => Array.isArray(entry)) ? payload.flat() : payload;
}
function normalizeMergedPulls(payload, limit) {
  return flattenPaginatedPayload(payload)
    .filter((pr) => typeof pr?.mergedAt === "string" && pr.mergedAt.trim().length > 0)
    .sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)))
    .slice(0, limit)
    .map((pr) => ({
      number: Number.isInteger(pr?.number) ? pr.number : null,
      title: typeof pr?.title === "string" ? pr.title : "",
      url: typeof pr?.url === "string" ? pr.url : null,
      mergedAt: pr.mergedAt,
      headSha: typeof pr?.headRefOid === "string" && pr.headRefOid.trim().length > 0 ? pr.headRefOid.trim().toLowerCase() : null,
    }))
    .filter((pr) => pr.number !== null);
}
function normalizeGateSummary(summary) {
  if (!summary) {
    return null;
  }
  return {
    headSha: summary.headSha,
    verdict: summary.verdict,
    commentId: summary.commentId,
    commentUrl: summary.commentUrl,
    updatedAt: summary.updatedAt,
  };
}
function evaluateMergedPrGateEvidence({ pr, comments }) {
  const gateSummary = summarizeGateReviewComments(comments);
  const markerSummary = summarizeGateReviewCommentMarkers(comments, { headSha: pr.headSha });
  const draftGate = gateSummary.draft_gate;
  const preApprovalGate = markerSummary.pre_approval_gate;
  const failures = [];
  if (!(draftGate?.verdict === "clean")) {
    failures.push("missing visible clean draft_gate comment");
  }
  if (!(preApprovalGate?.contractComplete === true && preApprovalGate.verdict === "clean" && preApprovalGate.headSha === pr.headSha)) {
    failures.push("missing visible clean current-head pre_approval_gate comment");
  }
  return {
    pr: pr.number,
    title: pr.title,
    url: pr.url,
    mergedAt: pr.mergedAt,
    headSha: pr.headSha,
    ok: failures.length === 0,
    failures,
    draftGate: normalizeGateSummary(draftGate),
    preApprovalGate: normalizeGateSummary(preApprovalGate),
  };
}
async function fetchRecentMergedPulls(options, { env, ghCommand }) {
  const payload = await runGhJson([
    "pr",
    "list",
    "--repo",
    options.repo,
    "--state",
    "merged",
    "--limit",
    String(options.limit),
    "--json",
    "number,title,url,mergedAt,headRefOid",
  ], { env, ghCommand });
  return normalizeMergedPulls(payload, options.limit);
}
export async function auditMergedPrGateEvidence(options, { env = process.env, ghCommand = "gh" } = {}) {
  const prs = await fetchRecentMergedPulls(options, { env, ghCommand });
  const results = [];
  for (const pr of prs) {
    const comments = flattenPaginatedPayload(await runGhJson([
      "api",
      "--paginate",
      "--slurp",
      `repos/${options.repo}/issues/${pr.number}/comments?per_page=100`,
    ], { env, ghCommand }));
    results.push(evaluateMergedPrGateEvidence({ pr, comments }));
  }
  const missingEvidence = results.filter((result) => !result.ok);
  return {
    ok: true,
    repo: options.repo,
    limit: options.limit,
    auditedCount: results.length,
    allHaveRequiredGateEvidence: missingEvidence.length === 0,
    missingEvidence,
    results,
  };
}
async function writeOutputFile(outputPath, data) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
async function main() {
  let options;
  try {
    options = parseAuditMergedPrGateEvidenceCliArgs(process.argv.slice(2));
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
    const result = await auditMergedPrGateEvidence(options);
    if (options.outputPath) {
      await writeOutputFile(options.outputPath, result);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
if (isDirectCliRun(import.meta.url)) {
  await main();
}

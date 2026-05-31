#!/usr/bin/env node
import { formatCliError, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { truncateText } from "../../packages/core/src/bash-exit-one.mjs";
import { parseRepoSlug } from "../../packages/core/src/github/repo-slug.mjs";
import { detectGateReviewEvidence } from "./detect-gate-review-evidence.mjs";
import { loadPrGateCoordinationContext } from "../loop/detect-pr-gate-coordination-state.mjs";
import { evaluatePrGateCoordination, PR_GATE_ACTION } from "../../packages/core/src/loop/pr-gate-coordination.mjs";

const GATE_NAMES = new Set(["draft_gate", "pre_approval_gate"]);
const GATE_VERDICTS = new Set(["clean", "findings_present", "blocked"]);
const MAX_GATE_COMMENT_TEXT_LENGTH = 280;
const MAX_GATE_COMMENT_EXCERPT_LENGTH = 120;

const USAGE = `Usage: upsert-gate-review-comment.mjs --repo <owner/name> --pr <number> --gate <draft_gate|pre_approval_gate> --head-sha <sha> --verdict <clean|findings_present|blocked> --findings-summary <text> --next-action <text>

Create or update the visible gate-review PR comment for a gate/head pair.
Same-head reruns are idempotent: if a visible marker already exists for the same
\`gate + headSha\`, this helper updates it in place when correction is needed and
suppresses duplicate reposts when the existing visible comment already matches.

Required:
  --repo <owner/name>
  --pr <number>
  --gate <draft_gate|pre_approval_gate>
  --head-sha <sha>                            Full current head SHA or hexadecimal prefix of it
  --verdict <clean|findings_present|blocked>
  --findings-summary <text>
  --next-action <text>

Output (stdout, JSON):
  {
    "ok": true,
    "action": "created"|"updated"|"noop",
    "repo": "owner/repo",
    "pr": 17,
    "gate": "draft_gate",
    "headSha": "abc1234",
    "currentHeadSha": "abc1234",
    "commentId": 101,
    "commentUrl": "https://github.com/owner/repo/pull/17#issuecomment-101"
  }

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error, gh failure, or contradictory gate evidence`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function normalizeGateName(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return GATE_NAMES.has(normalized) ? normalized : null;
}

function normalizeVerdict(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return GATE_VERDICTS.has(normalized) ? normalized : null;
}

function normalizeHeadSha(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{7,64}$/i.test(normalized) ? normalized : null;
}

function normalizeRequiredText(value, flag) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    throw parseError(`${flag} must be a non-empty string`);
  }
  if (flag === "--findings-summary") {
    return summarizeGateReviewText(normalized);
  }
  return truncateText(collapseWhitespace(normalized), MAX_GATE_COMMENT_TEXT_LENGTH);
}

function collapseWhitespace(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function pushUnique(values, value) {
  if (value.length > 0 && !values.includes(value)) {
    values.push(value);
  }
}

function formatValidationCounts(counts) {
  const orderedKeys = ["tests", "pass", "fail", "skipped", "todo", "cancelled", "suites"];
  const parts = orderedKeys
    .filter((key) => Number.isInteger(counts[key]))
    .map((key) => `${key}: ${counts[key]}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildVerboseValidationSummary(lines) {
  const commands = [];
  const counts = {};
  let ciLine = null;
  let failureExcerpt = null;
  let sawPassedSignal = false;

  for (const rawLine of lines) {
    const line = collapseWhitespace(rawLine.replace(/^[*-]\s*/u, ""));
    if (line.length === 0) {
      continue;
    }

    const commandMatch = line.match(/^(?:>|\$)\s*(.+)$/u);
    if (commandMatch) {
      pushUnique(commands, collapseWhitespace(commandMatch[1]));
      continue;
    }

    const countMatch = line.match(/^(?:ℹ\s*)?(tests|suites|pass|fail|cancelled|skipped|todo)\s*:?\s*(\d+)$/iu);
    if (countMatch) {
      counts[countMatch[1].toLowerCase()] = Number.parseInt(countMatch[2], 10);
      continue;
    }

    if (
      ciLine === null
      && /\b(?:github\s+ci|ci|checks?|workflow)\b/i.test(line)
      && /\b(?:pass(?:ed)?|green|success(?:ful)?|fail(?:ed)?|red|pending|blocked)\b/i.test(line)
    ) {
      ciLine = truncateText(line, MAX_GATE_COMMENT_EXCERPT_LENGTH);
      continue;
    }

    if (
      failureExcerpt === null
      && (/^✖\s*/u.test(line) || /^FAIL\b/u.test(line) || /\b(?:AssertionError|TypeError|ReferenceError|SyntaxError)\b/u.test(line) || /\bError:/u.test(line))
    ) {
      failureExcerpt = truncateText(line.replace(/^✖\s*/u, ""), MAX_GATE_COMMENT_EXCERPT_LENGTH);
      continue;
    }

    if (/\bpass(?:ed)?\b/i.test(line)) {
      sawPassedSignal = true;
    }
  }

  const parts = [];
  if (commands.length > 0) {
    parts.push(`commands: ${commands.join(", ")}`);
  }

  const countLine = formatValidationCounts(counts);
  if (countLine) {
    parts.push(countLine);
  }

  if (ciLine) {
    parts.push(`ci: ${ciLine}`);
  }

  const sawStructuredSignal = commands.length > 0 || countLine !== null || ciLine !== null || failureExcerpt !== null;

  if (failureExcerpt) {
    parts.push(`failure excerpt: ${failureExcerpt}`);
  } else if (Number.isInteger(counts.fail) && counts.fail > 0) {
    parts.push("validation: failed");
  } else if (!countLine && sawPassedSignal && sawStructuredSignal) {
    parts.push("validation: passed");
  }

  return parts.length > 0 ? parts.join("; ") : null;
}

export function summarizeGateReviewText(value, limit = MAX_GATE_COMMENT_TEXT_LENGTH) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    return "";
  }

  const flat = collapseWhitespace(normalized);
  if (!/[\r\n]/u.test(normalized)) {
    return truncateText(flat, limit);
  }

  const lines = normalized.split(/\r?\n/u);
  const verboseSummary = buildVerboseValidationSummary(lines);
  return truncateText(verboseSummary ?? flat, limit);
}

export function parseUpsertGateReviewCommentCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    gate: undefined,
    headSha: undefined,
    verdict: undefined,
    findingsSummary: undefined,
    nextAction: undefined,
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

    if (token === "--gate") {
      const gate = normalizeGateName(requireOptionValue(args, "--gate", parseError));
      if (!gate) {
        throw parseError("--gate must be one of: draft_gate, pre_approval_gate");
      }
      options.gate = gate;
      continue;
    }

    if (token === "--head-sha") {
      const headSha = normalizeHeadSha(requireOptionValue(args, "--head-sha", parseError));
      if (!headSha) {
        throw parseError("--head-sha must be a 7-64 character hexadecimal SHA");
      }
      options.headSha = headSha;
      continue;
    }

    if (token === "--verdict") {
      const verdict = normalizeVerdict(requireOptionValue(args, "--verdict", parseError));
      if (!verdict) {
        throw parseError("--verdict must be one of: clean, findings_present, blocked");
      }
      options.verdict = verdict;
      continue;
    }

    if (token === "--findings-summary") {
      options.findingsSummary = normalizeRequiredText(requireOptionValue(args, "--findings-summary", parseError), "--findings-summary");
      continue;
    }

    if (token === "--next-action") {
      options.nextAction = normalizeRequiredText(requireOptionValue(args, "--next-action", parseError), "--next-action");
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  const missing = ["repo", "pr", "gate", "headSha", "verdict", "findingsSummary", "nextAction"]
    .filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    throw parseError("upsert-gate-review-comment requires --repo, --pr, --gate, --head-sha, --verdict, --findings-summary, and --next-action");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

export function renderGateReviewCommentBody({ gate, headSha, verdict, findingsSummary, nextAction }) {
  return [
    `Gate review: ${gate}`,
    `Reviewed head SHA: ${headSha}`,
    `Verdict: ${verdict}`,
    `Findings summary: ${findingsSummary}`,
    `Next action: ${nextAction}`,
  ].join("\n");
}

function resolveRequestedHeadSha(requestedHeadSha, currentHeadSha) {
  if (requestedHeadSha === currentHeadSha) {
    return currentHeadSha;
  }

  if (currentHeadSha.startsWith(requestedHeadSha)) {
    return currentHeadSha;
  }

  throw new Error(`Requested head SHA ${requestedHeadSha} does not match the current PR head SHA ${currentHeadSha}; refuse to mutate stale gate evidence.`);
}

function selectGateEvidence(evidence, gate) {
  if (gate === "draft_gate") {
    return {
      strict: evidence.draftGate,
      marker: evidence.draftGateMarker,
    };
  }

  return {
    strict: evidence.preApprovalGate,
    marker: evidence.preApprovalGateMarker,
  };
}

function summarizeExistingComment({ strict, marker, headSha }) {
  const strictSameHead = strict?.visible === true && strict.headSha === headSha ? strict : null;
  const markerSameHead = marker?.visible === true && marker.headSha === headSha ? marker : null;

  if (markerSameHead && (!strictSameHead || markerSameHead.commentId !== strictSameHead.commentId)) {
    return {
      kind: "marker",
      commentId: markerSameHead.commentId,
      commentUrl: markerSameHead.commentUrl,
      verdict: markerSameHead.verdict,
      findingsSummary: markerSameHead.findingsSummary ?? null,
      nextAction: markerSameHead.nextAction ?? null,
      contractComplete: markerSameHead.contractComplete === true,
    };
  }

  if (strictSameHead) {
    return {
      kind: "strict",
      commentId: strictSameHead.commentId,
      commentUrl: strictSameHead.commentUrl,
      verdict: strictSameHead.verdict,
      findingsSummary: strictSameHead.findingsSummary,
      nextAction: strictSameHead.nextAction,
      contractComplete: true,
    };
  }

  if (markerSameHead) {
    return {
      kind: "marker",
      commentId: markerSameHead.commentId,
      commentUrl: markerSameHead.commentUrl,
      verdict: markerSameHead.verdict,
      findingsSummary: markerSameHead.findingsSummary ?? null,
      nextAction: markerSameHead.nextAction ?? null,
      contractComplete: markerSameHead.contractComplete === true,
    };
  }

  return null;
}

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }
  return parseJsonText(result.stdout, { label: `gh ${args.slice(0, 3).join(" ")}` });
}

function parseCommentMutationResponse(payload) {
  const commentId = Number.isInteger(payload?.id) ? payload.id : null;
  const commentUrl = typeof payload?.html_url === "string" && payload.html_url.trim().length > 0
    ? payload.html_url.trim()
    : null;

  if (commentId === null || commentUrl === null) {
    throw new Error("Gate-review comment mutation did not return a comment id and html_url");
  }

  return { commentId, commentUrl };
}

async function createComment({ repo, pr, body }, { env, ghCommand }) {
  const payload = await runGhJson(["api", "repos/" + repo + "/issues/" + pr + "/comments", "-f", `body=${body}`], { env, ghCommand });
  return parseCommentMutationResponse(payload);
}

async function updateComment({ repo, commentId, body }, { env, ghCommand }) {
  const payload = await runGhJson(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${commentId}`, "-f", `body=${body}`], { env, ghCommand });
  return parseCommentMutationResponse(payload);
}

export async function upsertGateReviewComment(options, { env = process.env, ghCommand = "gh" } = {}) {
  const coordinationContext = options.gate === "pre_approval_gate"
    ? await loadPrGateCoordinationContext({ repo: options.repo, pr: options.pr }, { env, ghCommand })
    : null;

  if (coordinationContext) {
    const coordination = evaluatePrGateCoordination({
      repo: coordinationContext.repo,
      pr: coordinationContext.pr,
      currentHeadSha: coordinationContext.currentHeadSha,
      prDraft: Boolean(coordinationContext.prData?.isDraft),
      prClosed: String(coordinationContext.prData?.state || "").toUpperCase() === "CLOSED",
      prMerged: String(coordinationContext.prData?.state || "").toUpperCase() === "MERGED",
      lifecycleState: coordinationContext.interpretation.state,
      loopDisposition: coordinationContext.disposition.loopDisposition,
      sameHeadCleanConverged: coordinationContext.interpretation.sameHeadCleanConverged,
      draftGate: coordinationContext.gateEvidence.draftGate,
      draftGateMarker: coordinationContext.gateEvidence.draftGateMarker,
      preApprovalGate: coordinationContext.gateEvidence.preApprovalGate,
      preApprovalGateMarker: coordinationContext.gateEvidence.preApprovalGateMarker,
    });
    if (coordination.forbiddenActions.includes(PR_GATE_ACTION.RUN_PRE_APPROVAL_GATE)) {
      throw new Error(`Cannot enter ${options.gate} on ${options.repo}#${options.pr}: ${coordination.reason}`);
    }
  }

  const evidence = coordinationContext?.gateEvidence ?? await detectGateReviewEvidence({ repo: options.repo, pr: options.pr }, { env, ghCommand });
  const canonicalHeadSha = resolveRequestedHeadSha(options.headSha, evidence.currentHeadSha);
  const desiredBody = renderGateReviewCommentBody({ ...options, headSha: canonicalHeadSha });

  const existing = summarizeExistingComment({ ...selectGateEvidence(evidence, options.gate), headSha: canonicalHeadSha });

  if (
    existing
    && existing.contractComplete
    && existing.verdict === options.verdict
    && existing.findingsSummary === options.findingsSummary
    && existing.nextAction === options.nextAction
  ) {
    return {
      ok: true,
      action: "noop",
      repo: options.repo,
      pr: options.pr,
      gate: options.gate,
      headSha: canonicalHeadSha,
      currentHeadSha: evidence.currentHeadSha,
      commentId: existing.commentId,
      commentUrl: existing.commentUrl,
    };
  }

  if (existing) {
    const updated = await updateComment({ repo: options.repo, commentId: existing.commentId, body: desiredBody }, { env, ghCommand });
    return {
      ok: true,
      action: "updated",
      repo: options.repo,
      pr: options.pr,
      gate: options.gate,
      headSha: canonicalHeadSha,
      currentHeadSha: evidence.currentHeadSha,
      commentId: updated.commentId,
      commentUrl: updated.commentUrl,
    };
  }

  const created = await createComment({ repo: options.repo, pr: options.pr, body: desiredBody }, { env, ghCommand });
  return {
    ok: true,
    action: "created",
    repo: options.repo,
    pr: options.pr,
    gate: options.gate,
    headSha: canonicalHeadSha,
    currentHeadSha: evidence.currentHeadSha,
    commentId: created.commentId,
    commentUrl: created.commentUrl,
  };
}

async function main() {
  let options;
  try {
    options = parseUpsertGateReviewCommentCliArgs(process.argv.slice(2));
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
    const result = await upsertGateReviewComment(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}

if (isDirectCliRun(import.meta.url)) {
  await main();
}

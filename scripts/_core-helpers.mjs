import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export {
  formatCliError,
  parseJsonText,
  parseReviewThreads,
  readInput,
} from "../packages/core/src/github/review-threads.mjs";

export {
  buildPhasePaths,
  readJsonIfExists,
} from "../packages/core/src/loop/phase-files.mjs";


const SUBMITTED_REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);
const GATE_REVIEW_NAMES = new Set(["draft_gate", "pre_approval_gate"]);
const GATE_REVIEW_VERDICTS = new Set(["clean", "findings_present", "blocked"]);

export function isCopilotLogin(login) {
  return typeof login === "string" && /^copilot(?:[^a-z]|$)/i.test(login);
}

export function normalizeTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function extractReviewCommitSha(review) {
  const graphqlSha = typeof review?.commit?.oid === "string" ? review.commit.oid.trim() : "";
  const restSha = typeof review?.commit_id === "string" ? review.commit_id.trim() : "";
  const sha = graphqlSha || restSha;
  return sha.length > 0 ? sha : null;
}

export function isDirectCliRun(importMetaUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== "string" || argv1.length === 0) {
    return false;
  }

  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

function stripOptionalCodeTicks(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeGateReviewName(value) {
  const normalized = stripOptionalCodeTicks(value).toLowerCase();
  return GATE_REVIEW_NAMES.has(normalized) ? normalized : null;
}

function normalizeGateReviewVerdict(value) {
  const normalized = stripOptionalCodeTicks(value).toLowerCase();
  return GATE_REVIEW_VERDICTS.has(normalized) ? normalized : null;
}

function normalizeGateReviewHeadSha(value) {
  const normalized = stripOptionalCodeTicks(value);
  return /^[0-9a-f]{7,64}$/i.test(normalized) ? normalized : null;
}

export function parseGateReviewCommentBody(body) {
  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }

  const fields = {
    gate: null,
    headSha: null,
    verdict: null,
    findingsSummary: null,
    nextAction: null,
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let match = line.match(/^(?:[-*]\s*)?(?:gate(?:\s+name)?|gate\s+review)\s*:\s*(.+)$/iu);
    if (match) {
      fields.gate = normalizeGateReviewName(match[1]);
      continue;
    }

    match = line.match(/^(?:[-*]\s*)?(?:head\s+sha(?:\s+reviewed)?|reviewed\s+head\s+sha)\s*:\s*(.+)$/iu);
    if (match) {
      fields.headSha = normalizeGateReviewHeadSha(match[1]);
      continue;
    }

    match = line.match(/^(?:[-*]\s*)?verdict\s*:\s*(.+)$/iu);
    if (match) {
      fields.verdict = normalizeGateReviewVerdict(match[1]);
      continue;
    }

    match = line.match(/^(?:[-*]\s*)?(?:findings(?:\s+summary)?|summary)\s*:\s*(.+)$/iu);
    if (match) {
      fields.findingsSummary = match[1].trim();
      continue;
    }

    match = line.match(/^(?:[-*]\s*)?next\s+action\s*:\s*(.+)$/iu);
    if (match) {
      fields.nextAction = match[1].trim();
      continue;
    }
  }

  if (!fields.gate || !fields.headSha || !fields.verdict || !fields.findingsSummary || !fields.nextAction) {
    return null;
  }

  return fields;
}

export function summarizeGateReviewComments(comments) {
  const summary = {
    draft_gate: null,
    pre_approval_gate: null,
  };

  const entries = Array.isArray(comments) ? comments : [];

  for (let index = 0; index < entries.length; index += 1) {
    const comment = entries[index];
    const parsed = parseGateReviewCommentBody(comment?.body);
    if (!parsed) {
      continue;
    }

    const updatedAtMs = normalizeTimestamp(comment?.updated_at ?? comment?.updatedAt ?? comment?.created_at ?? comment?.createdAt);
    const candidate = {
      visible: true,
      gate: parsed.gate,
      headSha: parsed.headSha,
      verdict: parsed.verdict,
      findingsSummary: parsed.findingsSummary,
      nextAction: parsed.nextAction,
      commentId: Number.isInteger(comment?.id) ? comment.id : null,
      commentUrl: typeof comment?.html_url === "string" && comment.html_url.trim().length > 0 ? comment.html_url.trim() : null,
      updatedAt: typeof (comment?.updated_at ?? comment?.updatedAt) === "string"
        ? (comment.updated_at ?? comment.updatedAt).trim()
        : typeof (comment?.created_at ?? comment?.createdAt) === "string"
          ? (comment.created_at ?? comment.createdAt).trim()
          : null,
      updatedAtMs,
      arrayIndex: index,
    };

    const current = summary[parsed.gate];
    if (!current || (candidate.updatedAtMs ?? -1) > (current.updatedAtMs ?? -1) || ((candidate.updatedAtMs ?? -1) === (current.updatedAtMs ?? -1) && candidate.arrayIndex > current.arrayIndex)) {
      summary[parsed.gate] = candidate;
    }
  }

  return summary;
}

export function summarizeCopilotReviews(reviews, { headSha } = {}) {
  const allReviews = Array.isArray(reviews) ? reviews : [];
  const copilotReviews = allReviews.filter((review) => isCopilotLogin(review?.author?.login));

  let hasPendingReviewOnCurrentHead = false;
  let hasSubmittedReviewOnCurrentHead = false;
  let latestSubmittedReviewOnCurrentHeadAt = null;

  for (const review of copilotReviews) {
    const state = typeof review?.state === "string" ? review.state.toUpperCase() : "";
    const reviewCommitSha = extractReviewCommitSha(review);
    const reviewOnCurrentHead = headSha !== null && reviewCommitSha === headSha;

    if (!reviewOnCurrentHead) {
      continue;
    }

    if (state === "PENDING") {
      hasPendingReviewOnCurrentHead = true;
      continue;
    }

    if (SUBMITTED_REVIEW_STATES.has(state)) {
      hasSubmittedReviewOnCurrentHead = true;
      const submittedAt = typeof review?.submittedAt === "string" ? review.submittedAt : null;
      if (submittedAt !== null && (latestSubmittedReviewOnCurrentHeadAt === null || submittedAt > latestSubmittedReviewOnCurrentHeadAt)) {
        latestSubmittedReviewOnCurrentHeadAt = submittedAt;
      }
    }
  }

  return {
    copilotReviews,
    copilotReviewIds: copilotReviews
      .map((review) => review?.id)
      .filter((id) => id !== null && id !== undefined)
      .map((id) => String(id)),
    copilotReviewPresent: copilotReviews.length > 0,
    hasPendingReviewOnCurrentHead,
    hasSubmittedReviewOnCurrentHead,
    latestSubmittedReviewOnCurrentHeadAt,
  };
}

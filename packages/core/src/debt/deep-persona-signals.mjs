import { randomUUID } from "node:crypto";
import { DebtSignalSchema } from "./debt-signal.mjs";
import { loadDevLoopConfig } from "../config/config.mjs";

// ============================================================================
// Flag phrase inventory — derived from personas.deep prompt in defaults.yaml
// ============================================================================

/** @type {Array<{ phrase: RegExp, category: string, severity: string, confidence: number }>} */
const FLAG_PATTERNS = [
  {
    phrase: /(?:crossing|crossed|exceeds?)\s+\d{3,}\s+lines/i,
    category: "file_size",
    severity: "high",
    confidence: 0.9,
  },
  {
    phrase: /conditionals?\s+bolted\s+onto\s+unrelated\s+paths/i,
    category: "spaghetti_branching",
    severity: "high",
    confidence: 0.9,
  },
  {
    phrase: /\bspaghetti\b/i,
    category: "spaghetti_branching",
    severity: "high",
    confidence: 0.9,
  },
  {
    phrase: /thin\s+wrapper/i,
    category: "thin_wrapper",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /re-export\s*[- ]?only/i,
    category: "thin_wrapper",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /identity\s+abstraction/i,
    category: "thin_wrapper",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /feature\s+logic\s+leaking\s+into/i,
    category: "leaky_feature_logic",
    severity: "high",
    confidence: 0.9,
  },
  {
    phrase: /leaking\s+into\s+shared/i,
    category: "leaky_feature_logic",
    severity: "high",
    confidence: 0.9,
  },
  {
    phrase: /cast[- ]?heavy/i,
    category: "weak_contract",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /optionality[- ]?heavy/i,
    category: "weak_contract",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /any[- ]?typed\s+contract/i,
    category: "weak_contract",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /code\s+judo/i,
    category: "simplification_opportunity",
    severity: "medium",
    confidence: 0.9,
  },
  {
    phrase: /prefer\s+deletion\s+over\s+addition/i,
    category: "simplification_opportunity",
    severity: "medium",
    confidence: 0.9,
  },
];

const FILE_PATH_RE = /[\w/\-]+\.(?:m?js|ts|tsx|jsx|mjs)/i;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Match a comment body against known deep-persona flag phrases.
 * Returns the match when a specific pattern matches, or null when no
 * patterns match the body.
 *
 * @param {string} body
 * @returns {{ category: string, severity: string, confidence: number, matchedPhrase: string|null }|null}
 */
function matchDeepPersonaFlags(body) {
  for (const pattern of FLAG_PATTERNS) {
    if (pattern.phrase.test(body)) {
      return {
        category: pattern.category,
        severity: pattern.severity,
        confidence: pattern.confidence,
        matchedPhrase: pattern.phrase.source,
      };
    }
  }

  return null;
}

/**
 * Extract a file path from a comment body, or return an empty string if none found.
 *
 * @param {string} body
 * @returns {string}
 */
function extractFilePath(body) {
  const match = body.match(FILE_PATH_RE);
  return match ? match[0] : "";
}

/**
 * Build a debt_signal object from a matched deep-persona comment.
 *
 * @param {object} comment - Normalized comment from parseReviewThreads output
 * @param {string} category - Inferred category
 * @param {string} severity - Severity hint
 * @param {number} confidence - Confidence score (0..1)
 * @param {string|null} matchedPhrase - The regex source that matched
 * @param {{ prNumber: string|number, prUrl: string }} prMeta
 * @returns {object}
 */
function buildDebtSignal(comment, category, severity, confidence, matchedPhrase, prMeta) {
  const filePath = extractFilePath(comment.body);

  return {
    id: randomUUID(),
    sourceType: "pr_review_deep_persona",
    signalKind: category,
    location: filePath ? { filePath } : {},
    severityHint: severity,
    timestamp: new Date().toISOString(),
    confidence,
    rawPayload: {
      description: comment.body,
      metadata: {
        prNumber: String(prMeta.prNumber),
        prUrl: prMeta.prUrl,
        commentId: comment.id,
        threadId: comment.threadId,
        isResolved: comment.isResolved ?? false,
        category,
        matchedPhrase,
      },
    },
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract deep-persona debt_signal artifacts from normalized review-thread JSON.
 *
 * Accepts the output of `parseReviewThreads()` (the `comments` array with
 * normalized `{ id, threadId, author, body, isActionable }` entries).
 *
 * Filters to only bot-authored comments that match known deep-persona flag
 * phrases. Bots are identified by `author.isBot === true` or `author.type === "Bot"`.
 *
 * @param {{ comments: Array<{ id: string, threadId: string, author: { login: string, type: string, isBot: boolean }, body: string, isActionable?: boolean, isResolved?: boolean }>, threads?: Array<{ id: string, isResolved: boolean }> }} parsedOutput - parseReviewThreads() output
 * @param {{ prNumber: string|number, prUrl: string }} prMeta
 * @returns {Array<object>} Array of debt_signal objects compatible with DebtSignalSchema
 */
export function extractDeepPersonaSignals(parsedOutput, prMeta) {
  if (!parsedOutput || !Array.isArray(parsedOutput.comments)) {
    throw new Error("Invalid parsed output: expected { comments: [...] } from parseReviewThreads()");
  }

  // Build a thread-id → isResolved map for fast lookup
  const threadResolved = new Map();
  if (Array.isArray(parsedOutput.threads)) {
    for (const thread of parsedOutput.threads) {
      threadResolved.set(thread.id, Boolean(thread.isResolved));
    }
  }

  const signals = [];

  for (const comment of parsedOutput.comments) {
    // Only process bot-authored comments (all Copilot personas emit as bots)
    if (!comment.author || (!comment.author.isBot && comment.author.type !== "Bot")) {
      continue;
    }

    if (!comment.body || comment.body.trim().length === 0) {
      continue;
    }

    const match = matchDeepPersonaFlags(comment.body);
    if (!match) {
      continue;
    }

    // Enrich comment with isResolved from thread data
    const isResolved = threadResolved.has(comment.threadId)
      ? threadResolved.get(comment.threadId)
      : (comment.isResolved ?? false);

    const signal = buildDebtSignal(
      { ...comment, isResolved },
      match.category,
      match.severity,
      match.confidence,
      match.matchedPhrase,
      prMeta,
    );

    // Validate against canonical schema
    const parsed = DebtSignalSchema.safeParse(signal);
    if (parsed.success) {
      signals.push(parsed.data);
    }
  }

  return signals;
}

/**
 * Return the known deep-persona flag phrase regex sources for inspection.
 *
 * @returns {Array<string>}
 */
export function getDeepPersonaFlagPhrases() {
  return FLAG_PATTERNS.map((p) => p.phrase.source);
}

/**
 * Verify that all known deep-persona flag phrase regex patterns match
 * the loaded deep persona prompt text. Returns an array of regex sources
 * whose patterns did not find any match in the prompt (empty = all match).
 *
 * @returns {Promise<Array<string>>}
 */
export async function verifyPromptStability() {
  const { config } = await loadDevLoopConfig();
  const deepPrompt = config?.personas?.deep?.prompt ?? "";

  return FLAG_PATTERNS
    .filter((p) => !p.phrase.test(deepPrompt))
    .map((p) => p.phrase.source);
}

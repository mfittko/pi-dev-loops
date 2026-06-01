/**
 * Deterministic tracker-spec resolution for tracker-backed local implementation.
 *
 * This module provides:
 * - TRACKER_SPEC_FORMAT: recognized tracker reference formats
 * - detectTrackerSpecFormat: classify a raw reference string
 * - isSpecBearingIssueBody: heuristic check for spec-bearing issue bodies
 * - normalizeTrackerSpec: normalize a fetched issue body into a phase-usable spec shape
 * - trackerBackedStartupReads: minimal startup reads for tracker-backed sessions
 *
 * Contract: skills/docs/tracker-backed-local-contract.md
 */

/** Recognized tracker reference formats. */
export const TRACKER_SPEC_FORMAT = Object.freeze({
  /** GitHub issue: owner/repo#N or just #N */
  GITHUB_ISSUE: "github_issue",
  /** Full URL to a GitHub issue */
  GITHUB_URL: "github_url",
  /** Unrecognized format */
  UNKNOWN: "unknown",
});

const GITHUB_ISSUE_RE =
  /^(?:(?:https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+))|(?:([^/]+\/[^/]+)?#(\d+)))$/i;

const SHORTCUT_RE = /^sc[#-]?\d+$/i;

/**
 * Section headings that indicate a spec-bearing issue body.
 * Match is case-insensitive against the full body text (applied to body
 * text, not just headings).
 */
const SPEC_SECTION_PATTERNS = [
  /\b(?:summary|problem|objective|goal)\b/i,
  /\b(?:desired\s+behavior|expected\s+behavior|proposal)\b/i,
  /\b(?<!out of )(?:scope|in\s+scope)\b/i,
  /\b(?:acceptance\s+criteria|acceptance)\b/i,
];

/**
 * Classify a raw tracker reference string.
 *
 * @param {string} raw - raw reference string, e.g. "mfittko/pi-dev-loops#294", "sc#1234", "PROJ-567"
 * @returns {{ format: string, owner?: string, repo?: string, number?: string, url?: string, raw?: string }}
 */
export function detectTrackerSpecFormat(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { format: TRACKER_SPEC_FORMAT.UNKNOWN };
  }

  const trimmed = raw.trim();

  // Shortcut and Jira patterns are detected but return UNKNOWN —
  // the contract is adapter-agnostic and only GitHub has a CLI helper.
  // Adapter-specific detection can be added when a real adapter ships.
  if (SHORTCUT_RE.test(trimmed) || /^[A-Z][A-Z0-9]+-\d+$/.test(trimmed)) {
    return { format: TRACKER_SPEC_FORMAT.UNKNOWN, raw: trimmed };
  }

  const ghMatch = trimmed.match(GITHUB_ISSUE_RE);
  if (ghMatch) {
    const urlOwnerRepo = ghMatch[1] || undefined;
    const urlNumber = ghMatch[2] || undefined;
    const inlineOwnerRepo = ghMatch[3] || undefined;
    const inlineNumber = ghMatch[4] || undefined;

    const number = urlNumber || inlineNumber || undefined;

    if (urlOwnerRepo) {
      const [owner, repo] = urlOwnerRepo.split("/");
      return {
        format: TRACKER_SPEC_FORMAT.GITHUB_URL,
        owner,
        repo,
        number,
        url: trimmed,
      };
    }

    if (inlineOwnerRepo) {
      const [owner, repo] = inlineOwnerRepo.split("/");
      return {
        format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE,
        owner,
        repo,
        number,
      };
    }

    return {
      format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE,
      owner: undefined,
      repo: undefined,
      number,
    };
  }

  return { format: TRACKER_SPEC_FORMAT.UNKNOWN };
}

/**
 * Heuristic check: does the issue body contain enough structure to be a spec?
 *
 * A spec-bearing issue body should contain at least 2 of the 4 section patterns
 * (summary, desired behavior, scope, acceptance criteria) and at least 200
 * characters of body text.
 *
 * @param {string} body - the raw issue body text
 * @returns {boolean}
 */
export function isSpecBearingIssueBody(body) {
  if (typeof body !== "string" || body.trim().length < 200) {
    return false;
  }

  const matchedSections = SPEC_SECTION_PATTERNS.filter((pattern) => pattern.test(body));
  return matchedSections.length >= 2;
}

/**
 * Normalize a fetched issue body into a structured spec shape suitable for
 * phase planning.
 *
 * @param {object} params
 * @param {string} params.title - issue title
 * @param {string} params.body - issue body text
 * @param {{ format: string, owner?: string, repo?: string, number?: string, url?: string }} params.trackerRef - resolved tracker reference
 * @returns {{ objective: string, summary: string, scope: string, nonGoals: string, acceptanceCriteria: string, rawBody: string, trackerRef: object, specBearing: boolean }}
 */
export function normalizeTrackerSpec({ title, body, trackerRef }) {
  const safeTitle = typeof title === "string" ? title : "";
  const safeBody = typeof body === "string" ? body : "";
  const specBearing = isSpecBearingIssueBody(safeBody);

  return {
    objective: safeTitle || "Untitled",
    summary: extractSection(safeBody, /(?:summary|problem|objective|goal)/i) || safeBody.slice(0, 500).trim(),
    scope: extractSection(safeBody, /(?:scope|in\s+scope)/i) || "Not specified",
    nonGoals: extractSection(safeBody, /(?:non[-\s]goals|out\s+of\s+scope)/i) || "Not specified",
    acceptanceCriteria:
      extractSection(safeBody, /(?:acceptance\s+criteria|acceptance)\b/i) || "Not specified",
    rawBody: safeBody,
    trackerRef,
    specBearing,
  };
}

/**
 * Extract a section from an issue body by heading pattern.
 * Returns the text following the heading up to the next heading or end of body.
 *
 * @param {string} body
 * @param {RegExp} headingPattern
 * @returns {string | null}
 */
function extractSection(body, headingPattern) {
  if (typeof body !== "string") return null;

  const lines = body.split("\n");
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match `## Summary`, `**Summary**`, `### Problem`, etc.
    if (headingPattern.test(line) && /^(#{1,4}\s|[*_]{2})/.test(line)) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) return null;

  const sectionLines = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    // Stop at the next heading
    if (line.startsWith("#") || (line.startsWith("**") && line.endsWith("**") && line.length > 4)) {
      break;
    }
    sectionLines.push(lines[i]);
  }

  const result = sectionLines.join("\n").trim();
  return result || null;
}

/**
 * Minimal startup reads for a tracker-backed local implementation session.
 *
 * Unlike full local mode (6 files minimum), tracker-backed sessions need only
 * the issue body as the canonical spec. Other files are optional context.
 *
 * Note: tracker-backed sessions do not use docs/phases/phase-x.md.
 * The tracker issue and a phase doc are mutually exclusive.
 *
 * @returns {{ required: string[], optional: string[] }}
 */
export function trackerBackedStartupReads() {
  return {
    required: [
      "tracker issue body (canonical spec)",
      "previous phase summary and retrospective (if prior phase exists)",
    ],
    optional: [
      "AGENTS.md",
      "PLAN.md",
      "docs/IMPLEMENTATION_STATE.md",
      "docs/IMPLEMENTATION_WORKFLOW.md",
    ],
  };
}

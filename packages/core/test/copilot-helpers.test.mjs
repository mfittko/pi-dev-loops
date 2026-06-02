import assert from "node:assert/strict";
import test from "node:test";

import {
  extractReviewCommitSha,
  isCopilotLogin,
  normalizeTimestamp,
  parseGateReviewCommentBody,
  parseGateReviewCommentMarkerBody,
  summarizeCopilotReviews,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "../src/github/copilot-helpers.mjs";

test("isCopilotLogin matches copilot-prefixed logins case-insensitively", () => {
  assert.equal(isCopilotLogin("copilot-swe-agent"), true);
  assert.equal(isCopilotLogin("Copilot"), true);
  assert.equal(isCopilotLogin("COPILOT"), true);
  assert.equal(isCopilotLogin("copilot"), true);
  assert.equal(isCopilotLogin("notcopilot"), false);
  assert.equal(isCopilotLogin(""), false);
  assert.equal(isCopilotLogin(null), false);
  assert.equal(isCopilotLogin(undefined), false);
  assert.equal(isCopilotLogin(42), false);
});

test("normalizeTimestamp returns ms for valid ISO strings and null for invalid input", () => {
  const ts = normalizeTimestamp("2024-01-15T12:00:00Z");
  assert.equal(typeof ts, "number");
  assert.ok(Number.isFinite(ts));
  assert.equal(normalizeTimestamp(""), null);
  assert.equal(normalizeTimestamp("not-a-date"), null);
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp(undefined), null);
  assert.equal(normalizeTimestamp(42), null);
});

test("extractReviewCommitSha prefers GraphQL oid over REST commit_id", () => {
  assert.equal(extractReviewCommitSha({ commit: { oid: "abc123" } }), "abc123");
  assert.equal(extractReviewCommitSha({ commit_id: "def456" }), "def456");
  assert.equal(extractReviewCommitSha({ commit: { oid: "abc123" }, commit_id: "def456" }), "abc123");
  assert.equal(extractReviewCommitSha({}), null);
  assert.equal(extractReviewCommitSha(null), null);
});

test("parseGateReviewCommentBody returns null when required fields are missing", () => {
  assert.equal(parseGateReviewCommentBody(""), null);
  assert.equal(parseGateReviewCommentBody("gate: draft_gate\nhead sha reviewed: abc1234"), null);
});

test("parseGateReviewCommentBody parses a full gate review comment", () => {
  const body = [
    "gate: draft_gate",
    "head sha reviewed: abc1234",
    "verdict: clean",
    "findings summary: no issues found",
    "next action: mark ready for review",
  ].join("\n");

  const result = parseGateReviewCommentBody(body);
  assert.ok(result !== null);
  assert.equal(result.gate, "draft_gate");
  assert.equal(result.headSha, "abc1234");
  assert.equal(result.verdict, "clean");
  assert.equal(result.findingsSummary, "no issues found");
  assert.equal(result.nextAction, "mark ready for review");
});

test("parseGateReviewCommentMarkerBody accepts gate+headSha even with partial contract fields", () => {
  const body = "gate: pre_approval_gate\nhead sha reviewed: def5678";
  const result = parseGateReviewCommentMarkerBody(body);
  assert.ok(result !== null);
  assert.equal(result.gate, "pre_approval_gate");
  assert.equal(result.headSha, "def5678");
  assert.equal(result.contractComplete, false);
});

test("parseGateReviewCommentBody parses the new Markdown template format", () => {
  const body = [
    "### Gate review: `draft_gate`",
    "",
    "**Reviewed head SHA:** `abc1234`",
    "**Verdict:** clean",
    "",
    "**Findings summary:** no issues found",
    "",
    "**Next action:** mark ready for review",
  ].join("\n");

  const result = parseGateReviewCommentBody(body);
  assert.ok(result !== null, "should parse the new template format");
  assert.equal(result.gate, "draft_gate");
  assert.equal(result.headSha, "abc1234");
  assert.equal(result.verdict, "clean");
  assert.equal(result.findingsSummary, "no issues found");
  assert.equal(result.nextAction, "mark ready for review");
});

test("parseGateReviewCommentMarkerBody parses partial new-format markers", () => {
  const body = [
    "### Gate review: `pre_approval_gate`",
    "",
    "**Reviewed head SHA:** `def5678`",
    "**Verdict:** clean",
  ].join("\n");

  const result = parseGateReviewCommentMarkerBody(body);
  assert.ok(result !== null, "should parse partial new-format marker");
  assert.equal(result.gate, "pre_approval_gate");
  assert.equal(result.headSha, "def5678");
  assert.equal(result.contractComplete, false);
});


test("summarizeGateReviewComments picks the most-recently-updated entry per gate", () => {
  const comments = [
    {
      body: "gate: draft_gate\nhead sha reviewed: aaa1111\nverdict: findings_present\nfindings summary: issues\nnext action: stay draft and fix",
      updated_at: "2024-01-01T00:00:00Z",
      id: 1,
    },
    {
      body: "gate: draft_gate\nhead sha reviewed: bbb2222\nverdict: clean\nfindings summary: no issues found\nnext action: mark ready for review",
      updated_at: "2024-01-02T00:00:00Z",
      id: 2,
    },
  ];

  const summary = summarizeGateReviewComments(comments);
  assert.equal(summary.draft_gate?.commentId, 2);
  assert.equal(summary.draft_gate?.verdict, "clean");
  assert.equal(summary.pre_approval_gate, null);
});

test("summarizeGateReviewCommentMarkers filters by headSha when provided", () => {
  const comments = [
    {
      body: "gate: draft_gate\nhead sha reviewed: aaa1111\nverdict: clean\nfindings summary: ok\nnext action: mark ready for review",
      id: 1,
    },
    {
      body: "gate: draft_gate\nhead sha reviewed: bbb2222\nverdict: clean\nfindings summary: ok\nnext action: mark ready for review",
      id: 2,
    },
  ];

  const summary = summarizeGateReviewCommentMarkers(comments, { headSha: "aaa1111" });
  assert.equal(summary.draft_gate?.commentId, 1);
});

test("summarizeCopilotReviews identifies submitted reviews on the current head", () => {
  const reviews = [
    {
      author: { login: "copilot-swe-agent" },
      state: "CHANGES_REQUESTED",
      commit: { oid: "abc1234" },
      submittedAt: "2024-01-10T00:00:00Z",
    },
  ];

  const result = summarizeCopilotReviews(reviews, { headSha: "abc1234" });
  assert.equal(result.copilotReviewPresent, true);
  assert.equal(result.hasSubmittedReviewOnCurrentHead, true);
  assert.equal(result.hasPendingReviewOnCurrentHead, false);
  assert.equal(result.latestSubmittedReviewOnCurrentHeadAt, "2024-01-10T00:00:00Z");
});

test("summarizeCopilotReviews ignores non-Copilot reviews", () => {
  const reviews = [
    {
      author: { login: "human-reviewer" },
      state: "APPROVED",
      commit: { oid: "abc1234" },
    },
  ];

  const result = summarizeCopilotReviews(reviews, { headSha: "abc1234" });
  assert.equal(result.copilotReviewPresent, false);
  assert.equal(result.hasSubmittedReviewOnCurrentHead, false);
});

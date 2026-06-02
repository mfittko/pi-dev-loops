#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCliError, isCopilotLogin, isDirectCliRun, parseJsonText } from "../_core-helpers.mjs";
import { requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";

const DEFAULT_OUTPUT_DIR = "tmp/investigation";
const DEFAULT_JSON_NAME = "copilot-comment-summary.json";
const DEFAULT_MARKDOWN_NAME = "copilot-comment-categories.md";

const USAGE = `Usage: audit-copilot-comments.mjs --repo <owner/name> [--output-dir <path>]

Scan all pull-request review comments in a repository via the GitHub REST API,
filter to Copilot-authored comments, classify them into workflow categories, and
write both a JSON summary and a Markdown report under the requested output directory.

Required:
  --repo <owner/name>     Repository slug (e.g. owner/repo)

Optional:
  --output-dir <path>     Output directory (default: tmp/investigation)

Output (stdout, JSON summary):
  {
    "ok": true,
    "repo": "owner/repo",
    "generatedAt": "2026-06-02T00:00:00.000Z",
    "totals": {
      "copilotComments": 123,
      "prsWithCopilotComments": 17,
      "uncategorizedComments": 5
    },
    "categories": [
      { "id": "grammar", "count": 92 }
    ],
    "recommendations": [
      { "key": "coverage-angle", "priorityOrder": 1 }
    ],
    "comments": [
      { "id": 101, "prNumber": 12, "primaryCategoryId": "grammar" }
    ],
    "files": {
      "jsonSummaryPath": "<output-dir>/copilot-comment-summary.json",
      "markdownReportPath": "<output-dir>/copilot-comment-categories.md"
    }
  }

  Stdout emits the same full summary object that is written to
  <output-dir>/copilot-comment-summary.json (default output dir: tmp/investigation).

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error, gh failure, or malformed gh JSON`.trim();

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

const CATEGORY_DEFINITIONS = [
  {
    id: "placeholder_404",
    label: "404 placeholders",
    description: "Placeholder or dead links that resolve to missing pages/resources.",
    recommendedLens: "link validator",
    suggestedChecks: ["Validate Markdown/HTML links", "Reject placeholder href targets"],
    automationFit: "strong",
    priorityWeight: 3,
    patterns: [
      /\b404\b/i,
      /placeholder\s+(?:link|url|href)/i,
      /dead\s+link/i,
      /not\s+found/i,
      /does\s+not\s+resolve/i,
      /missing\s+page/i,
    ],
  },
  {
    id: "broken_paths",
    label: "Broken relative paths",
    description: "Relative doc/code paths that no longer point at a real file or section.",
    recommendedLens: "link validator",
    suggestedChecks: ["Validate relative Markdown paths", "Check file/anchor existence in repo"],
    automationFit: "strong",
    priorityWeight: 3,
    patterns: [
      /broken\s+relative\s+path/i,
      /relative\s+(?:path|link)/i,
      /wrong\s+relative\s+path/i,
      /incorrect\s+relative\s+path/i,
      /(?:link|target)\s+(?:does\s+not|doesn't)\s+exist/i,
      /(?:link|path)\s+points?\s+to\s+(?:a\s+)?(?:missing|non[- ]existent)/i,
      /points?\s+to\s+(?:a\s+)?missing\s+(?:file|section|anchor)/i,
      /missing\s+(?:file|anchor)\b/i,
    ],
  },
  {
    id: "stale_commands",
    label: "Stale commands",
    description: "Removed or outdated commands/scripts still referenced in docs or workflow text.",
    recommendedLens: "docs angle",
    suggestedChecks: ["Verify documented npm scripts/CLI commands exist", "Flag removed or renamed command references"],
    automationFit: "hybrid",
    priorityWeight: 3,
    patterns: [
      /stale\s+(?:command|script|reference)/i,
      /(?:removed|renamed|outdated)\s+(?:command|script)/i,
      /(?:command|script)\s+no\s+longer\s+exists/i,
      /(?:documentation|docs?|readme|usage|help\s+text).*(?:command|script|npm\s+run).*(?:stale|wrong|outdated|removed|renamed)/i,
      /npm\s+run\s+\S+.*(?:missing|not\s+defined|not\s+found)/i,
      /(?:command|script)\s+(?:reference|name).*(?:stale|wrong|outdated)/i,
      /references?\s+an?\s+(?:old|removed|renamed)\s+(?:command|script)/i,
    ],
  },
  {
    id: "gate_evidence",
    label: "Gate evidence",
    description: "Missing or weak evidence that a required workflow gate ran on the intended head.",
    recommendedLens: "gate evidence lens",
    suggestedChecks: ["Require visible draft/pre-approval gate evidence", "Validate head SHA + verdict markers before ready/merge states"],
    automationFit: "strong",
    priorityWeight: 5,
    patterns: [
      /gate\s+evidence/i,
      /missing\s+(?:draft|pre-approval|gate)\s+(?:evidence|comment|marker)/i,
      /cannot\s+find\s+(?:any\s+)?(?:draft|pre-approval)\s+gate/i,
      /visible\s+(?:draft|pre-approval)\s+gate/i,
      /gate\s+review\s+comment/i,
      /(?:draft|pre-approval)\s+gate.*head\s+sha/i,
      /head\s+sha.*(?:draft|pre-approval|gate)/i,
      /(?:ready|merge|approval).*(?:without|lacks?).*(?:draft|pre-approval|gate)/i,
      /draft-first\s+enforcement/i,
    ],
  },
  {
    id: "ci_guard",
    label: "CI guard",
    description: "CI/workflow semantics that a correctness or release guard should catch before review.",
    recommendedLens: "correctness / CI lens",
    suggestedChecks: ["Verify CI semantics, reproducibility, and failure precedence", "Treat workflow drift as a dedicated review angle"],
    automationFit: "hybrid",
    priorityWeight: 5,
    patterns: [
      /\bCI\b/i,
      /github\s+actions?/i,
      /status\s+check/i,
      /check\s+has\s+.*conclusion/i,
      /non-reproducible/i,
      /deterministic\s+install/i,
      /npm\s+ci/i,
      /lockfile/i,
      /branch\s+protection/i,
      /pending\s+.*failure/i,
      /check\s+run/i,
      /node(?:\.js)?\s+support\s+floor/i,
    ],
  },
  {
    id: "unused_imports",
    label: "Unused imports",
    description: "Dead imports, dead locals, or never-used reads that linters can catch mechanically.",
    recommendedLens: "ESLint / dead-code linter",
    suggestedChecks: ["Enable no-unused-vars/no-unused-imports coverage", "Flag dead locals and unused I/O in tests/scripts"],
    automationFit: "strong",
    priorityWeight: 2,
    patterns: [
      /unused\s+import/i,
      /never\s+used/i,
      /unused\s+(?:read|variable|local)/i,
      /remove\s+the\s+unused/i,
      /imported\s+.*\s+but\s+never\s+used/i,
    ],
  },
  {
    id: "incomplete_coverage",
    label: "Incomplete coverage",
    description: "Missing negative cases, malformed-argument tests, or other gaps in validation coverage.",
    recommendedLens: "coverage angle",
    suggestedChecks: ["Require explicit negative-case and error-contract tests", "Track coverage gaps in review gate output"],
    automationFit: "hybrid",
    priorityWeight: 5,
    patterns: [
      /incomplete\s+(?:test\s+)?coverage/i,
      /coverage\s+gap/i,
      /missing\s+(?:test|coverage)/i,
      /add\s+(?:an?\s+)?(?:regression\s+)?test/i,
      /not\s+covered/i,
      /negative-case/i,
      /error-contract/i,
      /malformed-argument/i,
      /happy\s+path\s+only/i,
      /doesn['’]t\s+exercise/i,
      /should\s+test/i,
    ],
  },
  {
    id: "misleading_tests",
    label: "Misleading tests",
    description: "Tests whose names, assertions, or helpers misrepresent what is actually being verified.",
    recommendedLens: "coverage / test-quality angle",
    suggestedChecks: ["Review test names vs asserted behavior", "Flag brittle assertion wording and misleading helpers"],
    automationFit: "copilot",
    priorityWeight: 4,
    patterns: [
      /misleading\s+test/i,
      /test\s+name/i,
      /assertions?\s+match\s+very\s+long/i,
      /test\s+can\s+hang/i,
      /brittle\s+to\s+minor\s+copy\s+edits/i,
      /doesn['’]t\s+actually\s+assert/i,
      /claims?\s+.*\s+but/i,
      /confus(?:ing|e)\s+test/i,
      /helper\s+never\s+listens/i,
    ],
  },
  {
    id: "config_conflicts",
    label: "Config conflicts",
    description: "Schema/config/docs drift where two sources disagree about the supported contract.",
    recommendedLens: "config drift lens",
    suggestedChecks: ["Cross-check config/schema/docs invariants", "Flag canonical-token and support-floor mismatches"],
    automationFit: "copilot",
    priorityWeight: 4,
    patterns: [
      /config\s+(?:conflict|drift|mismatch)/i,
      /schema\s+(?:conflict|drift|mismatch)/i,
      /conflicts\s+with\s+the\s+stated\s+contract/i,
      /mismatch/i,
      /inconsistent\s+within\s+this\s+doc/i,
      /canonical\s+status\s+token/i,
      /support\s+floor/i,
      /engines\.node/i,
      /two\s+sources\s+of\s+truth/i,
    ],
  },
  {
    id: "duplicate_content",
    label: "Duplicate content",
    description: "Redundant or duplicated text/docs that should be consolidated.",
    recommendedLens: "docs angle",
    suggestedChecks: ["Detect duplicate contract wording", "Prefer one canonical wording/source over repeated copies"],
    automationFit: "hybrid",
    priorityWeight: 2,
    patterns: [
      /duplicate\s+(?:content|wording|text|docs?|helper)/i,
      /duplicated\s+here\s+and\s+in/i,
      /redundant\s+(?:content|wording|docs?|branch|helper)/i,
      /repeated\s+(?:content|wording)/i,
      /copy[- ]paste/i,
      /parallel\s+source\s+of\s+truth/i,
      /same\s+helper/i,
      /centraliz(?:e|ing)\s+this/i,
    ],
  },
  {
    id: "no_op_tool_usage",
    label: "No-op tool usage",
    description: "Workflow/tool invocations that are effectively no-ops or discard the intended effect.",
    recommendedLens: "workflow enforcement lens",
    suggestedChecks: ["Validate tool invocations actually affect output/state", "Flag no-op shell/tool usage patterns"],
    automationFit: "hybrid",
    priorityWeight: 3,
    patterns: [
      /no-op/i,
      /no\s+effect/i,
      /does\s+nothing/i,
      /tool\s+usage/i,
      /tool\s+call/i,
      /invocation\s+.*ignored/i,
      /discards?\s+the\s+.*effect/i,
      /still\s+passes\s+the\s+entire\s+body\s+as\s+a\s+single\s+command-line\s+argument/i,
    ],
  },
  {
    id: "grammar",
    label: "Grammar / wording",
    description: "Copy-editing, casing, or clarity issues in user-facing docs/comments.",
    recommendedLens: "docs angle",
    suggestedChecks: ["Add a docs-copy review angle", "Normalize casing/token wording in rendered docs"],
    automationFit: "copilot",
    priorityWeight: 1,
    patterns: [
      /grammar/i,
      /wording/i,
      /typo/i,
      /spelling/i,
      /casing/i,
      /copy\s+edit/i,
      /awkward/i,
      /rephrase/i,
      /capitali[sz]e/i,
      /punctuation/i,
    ],
  },
];

const RECOMMENDATION_DEFINITIONS = [
  {
    key: "coverage-angle",
    label: "Strengthen the coverage/test-quality lens",
    categories: ["incomplete_coverage", "misleading_tests"],
    owner: "review angle",
    rationale: "A dedicated coverage/test-quality pass should catch missing negative cases, misleading test names, and brittle assertions before Copilot does.",
  },
  {
    key: "docs-angle",
    label: "Strengthen docs and command-surface review",
    categories: ["stale_commands", "grammar", "duplicate_content"],
    owner: "review angle",
    rationale: "Docs-focused review should validate command references, canonical wording, and duplicated contract text in one pass.",
  },
  {
    key: "link-validator",
    label: "Add or tighten link/path validation",
    categories: ["broken_paths", "placeholder_404"],
    owner: "validator",
    rationale: "Broken relative paths and placeholder links are deterministic and should be caught mechanically rather than via Copilot review.",
  },
  {
    key: "gate-evidence-lens",
    label: "Add explicit gate-evidence enforcement",
    categories: ["gate_evidence"],
    owner: "workflow gate",
    rationale: "The loop should reject ready/merge transitions when draft/pre-approval evidence is missing or points at the wrong head SHA.",
  },
  {
    key: "ci-guard-lens",
    label: "Strengthen CI guard semantics",
    categories: ["ci_guard"],
    owner: "review angle",
    rationale: "CI and workflow semantics need a dedicated correctness lens so reproducibility and failure-precedence issues surface before Copilot review.",
  },
  {
    key: "dead-code-lint",
    label: "Enable dead-code linting",
    categories: ["unused_imports"],
    owner: "linter",
    rationale: "Unused imports and dead locals are cheap to catch with lint rules and should not consume Copilot review budget.",
  },
  {
    key: "config-drift-lens",
    label: "Add a config/schema drift review lens",
    categories: ["config_conflicts"],
    owner: "review angle",
    rationale: "Cross-artifact contract drift is recurring enough to deserve its own review pass, even if some cases remain advisory.",
  },
  {
    key: "workflow-noop-lens",
    label: "Add workflow no-op tool enforcement",
    categories: ["no_op_tool_usage"],
    owner: "review angle",
    rationale: "The workflow should flag tool invocations that look successful but do nothing or silently drop important effects.",
  },
];

function excerptText(body, maxLength = 200) {
  const normalized = String(body ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function parsePrNumberFromPullRequestUrl(pullRequestUrl) {
  const match = String(pullRequestUrl ?? "").match(/\/pulls\/(\d+)$/u);
  return match ? Number(match[1]) : null;
}

function normalizePaginatedArrayPayload(payload, label) {
  if (!Array.isArray(payload)) {
    throw new Error(`Invalid ${label} payload: expected an array`);
  }

  if (payload.every((entry) => Array.isArray(entry))) {
    return payload.flat();
  }

  return payload;
}

function matchesCategory(comment, definition) {
  const haystack = typeof comment?.body === "string" ? comment.body.trim() : "";
  return haystack.length > 0 && definition.patterns.some((pattern) => pattern.test(haystack));
}

export function classifyCopilotComment(comment, definitions = CATEGORY_DEFINITIONS) {
  const matched = definitions
    .filter((definition) => matchesCategory(comment, definition))
    .map((definition) => definition.id);

  const primaryCategory = matched.length > 0
    ? definitions.find((definition) => definition.id === matched[0]) ?? null
    : null;

  return {
    matchedCategoryIds: matched,
    primaryCategoryId: primaryCategory?.id ?? null,
  };
}

function normalizeComment(comment, prMap) {
  const prNumber = parsePrNumberFromPullRequestUrl(comment?.pull_request_url);
  const pr = prNumber !== null ? prMap.get(prNumber) ?? null : null;
  const classification = classifyCopilotComment(comment);

  return {
    id: Number.isInteger(comment?.id) ? comment.id : null,
    prNumber,
    prTitle: pr?.title ?? null,
    prUrl: pr?.html_url ?? comment?.html_url ?? null,
    prState: pr?.merged_at ? "merged" : (pr?.state ?? null),
    path: typeof comment?.path === "string" ? comment.path : null,
    line: Number.isInteger(comment?.line) ? comment.line : (Number.isInteger(comment?.original_line) ? comment.original_line : null),
    body: typeof comment?.body === "string" ? comment.body.trim() : "",
    excerpt: excerptText(comment?.body),
    htmlUrl: typeof comment?.html_url === "string" ? comment.html_url : null,
    createdAt: typeof comment?.created_at === "string" ? comment.created_at : null,
    updatedAt: typeof comment?.updated_at === "string" ? comment.updated_at : null,
    authorLogin: typeof comment?.user?.login === "string" ? comment.user.login : null,
    matchedCategoryIds: classification.matchedCategoryIds,
    primaryCategoryId: classification.primaryCategoryId,
  };
}

function buildPrMap(prs) {
  const map = new Map();
  for (const pr of prs) {
    if (!Number.isInteger(pr?.number)) {
      continue;
    }
    map.set(pr.number, pr);
  }
  return map;
}

function buildCategorySummaries(normalizedComments) {
  const summaries = CATEGORY_DEFINITIONS.map((definition) => {
    const matches = normalizedComments.filter((comment) => comment.primaryCategoryId === definition.id);
    const prSet = new Set(matches.map((comment) => comment.prNumber).filter((value) => Number.isInteger(value)));

    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      recommendedLens: definition.recommendedLens,
      suggestedChecks: definition.suggestedChecks,
      automationFit: definition.automationFit,
      priorityWeight: definition.priorityWeight,
      count: matches.length,
      prCount: prSet.size,
      prNumbers: [...prSet].sort((left, right) => left - right),
      examples: matches.slice(0, 3).map((comment) => ({
        prNumber: comment.prNumber,
        prTitle: comment.prTitle,
        path: comment.path,
        line: comment.line,
        excerpt: comment.excerpt,
        htmlUrl: comment.htmlUrl,
      })),
    };
  });

  return summaries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    if (right.priorityWeight !== left.priorityWeight) {
      return right.priorityWeight - left.priorityWeight;
    }
    return left.label.localeCompare(right.label);
  });
}

function rankRecommendations(categorySummaries) {
  const countsByCategory = new Map(categorySummaries.map((summary) => [summary.id, summary]));

  const active = RECOMMENDATION_DEFINITIONS
    .map((definition) => {
      const related = definition.categories
        .map((categoryId) => countsByCategory.get(categoryId))
        .filter(Boolean);
      const commentCount = related.reduce((sum, summary) => sum + summary.count, 0);
      const prCount = new Set(related.flatMap((summary) => summary.prNumbers ?? [])).size;
      const score = related.reduce((sum, summary) => sum + (summary.count * summary.priorityWeight), 0);

      return {
        key: definition.key,
        label: definition.label,
        owner: definition.owner,
        rationale: definition.rationale,
        categories: related.filter((summary) => summary.count > 0).map((summary) => summary.id),
        commentCount,
        prCount,
        score,
      };
    })
    .filter((entry) => entry.commentCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.commentCount !== left.commentCount) {
        return right.commentCount - left.commentCount;
      }
      return left.label.localeCompare(right.label);
    })
    .map((entry, index) => ({
      ...entry,
      priorityOrder: index + 1,
      priorityBand: index < 3 ? "high" : index < 6 ? "medium" : "low",
    }));

  return active;
}

function buildCopilotOwnedCategories(categorySummaries) {
  return categorySummaries
    .filter((summary) => summary.count > 0 && (summary.automationFit === "copilot" || summary.automationFit === "hybrid"))
    .slice(0, 5)
    .map((summary) => ({
      id: summary.id,
      label: summary.label,
      commentCount: summary.count,
      automationFit: summary.automationFit,
      reason: summary.automationFit === "copilot"
        ? "These comments usually require cross-file judgment or subjective review, so Copilot should stay in the loop even if we add advisory heuristics."
        : "A deterministic check can catch part of this category, but Copilot/human review still adds value for nuance and false-positive control.",
    }));
}

export function buildCopilotAuditSummary({ repo, comments, prs, outputDir = DEFAULT_OUTPUT_DIR, generatedAt = new Date().toISOString() }) {
  const prMap = buildPrMap(prs);
  const normalizedComments = comments
    .filter((comment) => isCopilotLogin(comment?.user?.login))
    .map((comment) => normalizeComment(comment, prMap));

  const categorySummaries = buildCategorySummaries(normalizedComments);
  const uncategorizedComments = normalizedComments.filter((comment) => comment.primaryCategoryId === null);
  const recommendations = rankRecommendations(categorySummaries);
  const prsWithCopilotComments = new Set(normalizedComments.map((comment) => comment.prNumber).filter((value) => Number.isInteger(value))).size;
  const matchedComments = normalizedComments.length - uncategorizedComments.length;

  return {
    ok: true,
    repo,
    generatedAt,
    scope: {
      source: "GitHub REST review comments endpoint",
      includes: "PR review comments authored by Copilot",
      excludes: "PR review summaries and general issue comments",
    },
    totals: {
      reviewCommentsScanned: comments.length,
      copilotComments: normalizedComments.length,
      matchedComments,
      classificationCoverage: normalizedComments.length === 0 ? 0 : Number((matchedComments / normalizedComments.length).toFixed(3)),
      prsWithCopilotComments,
      uncategorizedComments: uncategorizedComments.length,
    },
    categories: categorySummaries,
    uncategorizedExamples: uncategorizedComments.slice(0, 10).map((comment) => ({
      prNumber: comment.prNumber,
      path: comment.path,
      excerpt: comment.excerpt,
      htmlUrl: comment.htmlUrl,
    })),
    recommendations,
    copilotOwnedCategories: buildCopilotOwnedCategories(categorySummaries),
    comments: normalizedComments,
    files: {
      outputDir,
      jsonSummaryPath: path.join(outputDir, DEFAULT_JSON_NAME),
      markdownReportPath: path.join(outputDir, DEFAULT_MARKDOWN_NAME),
    },
  };
}

export function renderMarkdownReport(summary) {
  const lines = [];
  const topCategories = summary.categories.filter((category) => category.count > 0).slice(0, 10);

  lines.push(`# Copilot review comment audit — ${summary.repo}`);
  lines.push("");
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- Source: ${summary.scope.source}`);
  lines.push(`- Included: ${summary.scope.includes}`);
  lines.push(`- Excluded: ${summary.scope.excludes}`);
  lines.push(`- Copilot comments: ${summary.totals.copilotComments}`);
  lines.push(`- Matched to requested taxonomy: ${summary.totals.matchedComments} (${Math.round(summary.totals.classificationCoverage * 100)}%)`);
  lines.push(`- PRs with Copilot comments: ${summary.totals.prsWithCopilotComments}`);
  lines.push(`- Uncategorized comments: ${summary.totals.uncategorizedComments}`);
  lines.push(`- Note: the taxonomy is intentionally limited to the issue's requested categories; broader correctness/refactor comments remain uncategorized.`);
  lines.push("");
  lines.push("## Top categories");
  lines.push("");
  lines.push("| Category | Comments | PRs | Catch earlier with | Fit |");
  lines.push("| --- | ---: | ---: | --- | --- |");
  for (const category of topCategories) {
    lines.push(`| ${category.label} | ${category.count} | ${category.prCount} | ${category.recommendedLens} | ${category.automationFit} |`);
  }
  lines.push("");
  lines.push("## Priority order for missing lenses / linters");
  lines.push("");
  for (const recommendation of summary.recommendations) {
    lines.push(`${recommendation.priorityOrder}. **${recommendation.label}** (${recommendation.priorityBand}) — ${recommendation.commentCount} comments across categories: ${recommendation.categories.join(", ")}.`);
    lines.push(`   - Owner: ${recommendation.owner}`);
    lines.push(`   - Why: ${recommendation.rationale}`);
  }
  lines.push("");
  lines.push("## Category details");
  lines.push("");
  for (const category of summary.categories.filter((entry) => entry.count > 0)) {
    lines.push(`### ${category.label}`);
    lines.push("");
    lines.push(`- Comments: ${category.count}`);
    lines.push(`- PRs: ${category.prCount}`);
    lines.push(`- Recommended lens/linter: ${category.recommendedLens}`);
    lines.push(`- Automation fit: ${category.automationFit}`);
    lines.push(`- Suggested checks: ${category.suggestedChecks.join("; ")}`);
    if (category.examples.length > 0) {
      lines.push("- Example comments:");
      for (const example of category.examples) {
        const location = [example.path, Number.isInteger(example.line) ? `:${example.line}` : null].filter(Boolean).join("");
        lines.push(`  - PR #${example.prNumber}${example.prTitle ? ` — ${example.prTitle}` : ""}${location ? ` (${location})` : ""}: ${example.excerpt}`);
      }
    }
    lines.push("");
  }

  lines.push("## Categories Copilot should still own");
  lines.push("");
  if (summary.copilotOwnedCategories.length === 0) {
    lines.push("- None in this run; the observed issues were mostly deterministic/mechanical.");
  } else {
    for (const category of summary.copilotOwnedCategories) {
      lines.push(`- **${category.label}** (${category.commentCount} comments, ${category.automationFit}) — ${category.reason}`);
    }
  }
  lines.push("");

  if (summary.uncategorizedExamples.length > 0) {
    lines.push("## Uncategorized sample");
    lines.push("");
    for (const example of summary.uncategorizedExamples) {
      lines.push(`- PR #${example.prNumber}${example.path ? ` (${example.path})` : ""}: ${example.excerpt}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function runGhJson(args, { env, ghCommand }) {
  const result = await runChild(ghCommand, args, env);

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh command failed: ${detail}`);
  }

  const commandLabel = `gh ${args.join(" ")}`;
  try {
    return parseJsonText(result.stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from ${commandLabel}`);
  }
}

async function fetchAllReviewComments(repo, { env, ghCommand }) {
  const payload = await runGhJson(["api", "--paginate", "--slurp", `repos/${repo}/pulls/comments?per_page=100`], { env, ghCommand });
  return normalizePaginatedArrayPayload(payload, "Copilot review comments");
}

async function fetchAllPullRequests(repo, { env, ghCommand }) {
  const payload = await runGhJson(["api", "--paginate", "--slurp", `repos/${repo}/pulls?state=all&per_page=100`], { env, ghCommand });
  return normalizePaginatedArrayPayload(payload, "pull requests");
}

async function writeOutputs(summary, markdown) {
  await mkdir(summary.files.outputDir, { recursive: true });
  await writeFile(summary.files.jsonSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summary.files.markdownReportPath, markdown, "utf8");
}

export function parseAuditCopilotCommentsCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    outputDir: DEFAULT_OUTPUT_DIR,
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

    if (token === "--output-dir") {
      options.outputDir = requireOptionValue(args, "--output-dir", parseError).trim();
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.repo === undefined) {
    throw parseError("audit-copilot-comments requires --repo <owner/name>");
  }

  if (options.outputDir.length === 0) {
    throw parseError("--output-dir must be a non-empty path");
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

export async function auditCopilotComments(options, { env = process.env, ghCommand = "gh" } = {}) {
  const comments = await fetchAllReviewComments(options.repo, { env, ghCommand });
  const prs = await fetchAllPullRequests(options.repo, { env, ghCommand });

  const summary = buildCopilotAuditSummary({
    repo: options.repo,
    comments,
    prs,
    outputDir: options.outputDir,
  });
  const markdown = renderMarkdownReport(summary);

  await writeOutputs(summary, markdown);

  return summary;
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, env = process.env, ghCommand = "gh" } = {}) {
  const options = parseAuditCopilotCommentsCliArgs(argv);

  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }

  const summary = await auditCopilotComments(options, { env, ghCommand });
  stdout.write(`${JSON.stringify(summary)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
  });
}

export {
  CATEGORY_DEFINITIONS,
  DEFAULT_JSON_NAME,
  DEFAULT_MARKDOWN_NAME,
  DEFAULT_OUTPUT_DIR,
  RECOMMENDATION_DEFINITIONS,
};

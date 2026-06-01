#!/usr/bin/env node
/**
 * Deterministic gate-review comment poster.
 *
 * Posts a gate-review comment in the exact format expected by
 * parseGateReviewCommentBody / parseGateReviewCommentMarkerBody.
 * Fails if a comment already exists for the same gate + head SHA (#299).
 *
 * Usage:
 *   post-gate-review-comment.mjs --repo <owner/name> --pr <number> \
 *     --gate draft_gate|pre_approval_gate \
 *     --head-sha <sha> \
 *     --verdict clean|findings_present|blocked \
 *     --findings <summary> \
 *     --next-action <action> \
 *     [--body-file <path>]
 *
 * If --body-file is provided, its content is appended after the
 * required structured fields as free-form detail.
 *
 * Exit codes:
 *   0  Comment posted
 *   1  Argument error, duplicate detected, or gh failure
 */

import { writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  formatCliError,
  isDirectCliRun,
  parseJsonText,
} from "../_core-helpers.mjs";
import { parsePrNumber, requireOptionValue, runChild } from "../_cli-primitives.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";
import {
  summarizeGateReviewComments,
} from "@pi-dev-loops/core/github/copilot-helpers";

const USAGE = [
  "Usage: post-gate-review-comment.mjs --repo <owner/name> --pr <number> \\",
  "    --gate draft_gate|pre_approval_gate \\",
  "    --head-sha <sha> \\",
  "    --verdict clean|findings_present|blocked \\",
  "    --findings <summary> \\",
  "    --next-action <action> \\",
  "    [--body-file <path>]",
  "",
  "Posts a deterministic gate-review comment. Fails if a comment for the",
  "same gate + head SHA already exists.",
].join("\n");

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

export function parsePostGateReviewCommentCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    gate: undefined,
    headSha: undefined,
    verdict: undefined,
    findings: undefined,
    nextAction: undefined,
    bodyFile: undefined,
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
      options.gate = requireOptionValue(args, "--gate", parseError).trim();
      continue;
    }

    if (token === "--head-sha") {
      options.headSha = requireOptionValue(args, "--head-sha", parseError).trim();
      continue;
    }

    if (token === "--verdict") {
      options.verdict = requireOptionValue(args, "--verdict", parseError).trim();
      continue;
    }

    if (token === "--findings") {
      options.findings = requireOptionValue(args, "--findings", parseError).trim();
      continue;
    }

    if (token === "--next-action") {
      options.nextAction = requireOptionValue(args, "--next-action", parseError).trim();
      continue;
    }

    if (token === "--body-file") {
      options.bodyFile = requireOptionValue(args, "--body-file", parseError).trim();
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (!options.repo || !options.pr || !options.gate || !options.headSha || !options.verdict || !options.findings || !options.nextAction) {
    throw parseError(
      "post-gate-review-comment requires --repo, --pr, --gate, --head-sha, --verdict, --findings, and --next-action"
    );
  }

  const validGates = new Set(["draft_gate", "pre_approval_gate"]);
  if (!validGates.has(options.gate)) {
    throw parseError(`--gate must be draft_gate or pre_approval_gate, got: ${options.gate}`);
  }

  const validVerdicts = new Set(["clean", "findings_present", "blocked"]);
  if (!validVerdicts.has(options.verdict)) {
    throw parseError(`--verdict must be clean, findings_present, or blocked, got: ${options.verdict}`);
  }

  try {
    parseRepoSlug(options.repo);
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }

  return options;
}

async function fetchPrComments({ repo, pr }, { env = process.env, ghCommand = "gh" } = {}) {
  const result = await runChild(
    ghCommand,
    ["api", `repos/${repo}/issues/${pr}/comments`, "--jq", "."],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh api comments failed: ${detail}`);
  }

  return parseJsonText(result.stdout, { label: "gh api comments" });
}

function buildGateCommentBody({ gate, headSha, verdict, findings, nextAction, extraBody }) {
  const lines = [
    `- gate name: ${gate}`,
    `- head sha reviewed: ${headSha}`,
    `- verdict: ${verdict}`,
    `- findings summary: ${findings}`,
    `- next action: ${nextAction}`,
  ];

  if (extraBody && extraBody.trim().length > 0) {
    lines.push("", extraBody.trim());
  }

  return lines.join("\n");
}

export async function postGateReviewComment(options, runtime = {}) {
  const comments = await fetchPrComments(options, runtime);
  const gateSummary = summarizeGateReviewComments(comments);

  const existing = gateSummary[options.gate];
  if (existing && existing.visible && existing.headSha === options.headSha) {
    throw new Error(
      `Duplicate gate comment: a ${options.gate} comment for head ${options.headSha} already exists (comment ID ${existing.commentId}). Update the existing comment or post for a different head.`
    );
  }

  let extraBody = "";
  if (options.bodyFile) {
    extraBody = await readFile(options.bodyFile, "utf8");
  }

  const body = buildGateCommentBody({
    gate: options.gate,
    headSha: options.headSha,
    verdict: options.verdict,
    findings: options.findings,
    nextAction: options.nextAction,
    extraBody,
  });

  const bodyFile = path.join(tmpdir(), `pi-gate-comment-${randomUUID()}.md`);
  await writeFile(bodyFile, body, "utf8");

  const { env = process.env, ghCommand = "gh" } = runtime;
  const result = await runChild(
    ghCommand,
    ["pr", "comment", String(options.pr), "--repo", options.repo, "--body-file", bodyFile],
    env,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.code}`;
    throw new Error(`gh pr comment failed: ${detail}`);
  }

  return {
    ok: true,
    repo: options.repo,
    pr: options.pr,
    gate: options.gate,
    headSha: options.headSha,
    verdict: options.verdict,
  };
}

export async function runCli(argv = process.argv.slice(2), stdout = process.stdout) {
  const options = parsePostGateReviewCommentCliArgs(argv);
  const result = await postGateReviewComment(options);
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
  });
}

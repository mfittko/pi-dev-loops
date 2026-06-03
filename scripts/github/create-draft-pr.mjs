#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";

const USAGE = `Usage: create-draft-pr.mjs [gh pr create args...]

Thin wrapper around \`gh pr create\` that enforces draft-first PR creation.

Behavior:
  - injects exactly one \`--draft\` when absent
  - rejects \`--ready\` before invoking \`gh\`
  - detects missing \`Closes #N\` / \`Fixes #N\` in \`--body\` or \`--body-file\` content (non-fatal stderr warning)
  - forwards every other argument to \`gh pr create\` unchanged
  - preserves the underlying \`gh pr create\` stdout, stderr, and exit code

Examples:
  node scripts/github/create-draft-pr.mjs --repo owner/repo --assignee @me --base main --head feature --title "..." --body-file pr.md
  node <resolved-skill-scripts>/github/create-draft-pr.mjs --repo owner/repo --assignee @me --base main --head feature --title "..." --body-file pr.md

Notes:
  - Use \`gh pr ready\` later to leave draft state; this wrapper never opens a ready PR.
  - Wrapper-owned validation is limited to \`--ready\`; all other argument validation is left to \`gh pr create\`.
  - Closing-keyword warning is advisory only and does not change exit code.

Exit codes:
  0  \`gh pr create\` succeeded
  1  wrapper validation failed or \`gh\` could not be spawned
  N  same non-zero exit code returned by \`gh pr create\``.trim();

const parseError = buildParseError(USAGE);
const READY_FLAG_PATTERN = /^--ready(?:$|=)/u;
const DRAFT_FLAG_PATTERN = /^--draft(?:=(.*))?$/iu;
const DRAFT_TRUE_VALUE_PATTERN = /^(?:true|1)$/iu;
const CLOSING_KEYWORD_PATTERN = /Closes\s+#\d+|Fixes\s+#\d+/i;
const MAX_BODY_SCAN_BYTES = 16 * 1024;

export function detectClosingKeyword(body) {
  if (!body || typeof body !== "string") return false;
  return CLOSING_KEYWORD_PATTERN.test(body.slice(0, MAX_BODY_SCAN_BYTES));
}

async function resolveBody(args) {
  const bodyIdx = args.indexOf("--body");
  if (bodyIdx !== -1 && bodyIdx + 1 < args.length) {
    return args[bodyIdx + 1];
  }

  const bodyFileIdx = args.indexOf("--body-file");
  if (bodyFileIdx !== -1 && bodyFileIdx + 1 < args.length) {
    try {
      const content = await readFile(args[bodyFileIdx + 1], "utf8");
      return content;
    } catch {
      return "";
    }
  }

  return null; // unreadable → warn
}

async function warnMissingClosingKeyword(args) {
  const body = await resolveBody(args);
  if (body === null) return; // no --body or --body-file, skip

  if (!detectClosingKeyword(body)) {
    process.stderr.write(
      "[create-draft-pr] Warning: PR body missing `Closes #N` or `Fixes #N`. " +
        "GitHub will not auto-close the linked issue on merge.\n",
    );
  }
}

export function buildCreateDraftPrArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    return {
      help: true,
      ghArgs: null,
    };
  }

  if (args.some((token) => READY_FLAG_PATTERN.test(token))) {
    throw parseError("create-draft-pr rejects --ready; open the PR as draft first, then run `gh pr ready` after the draft gate is satisfied");
  }

  const draftTokens = args.filter((token) => DRAFT_FLAG_PATTERN.test(token));
  const lastDraftToken = draftTokens.length > 0 ? draftTokens.at(-1) : null;
  const lastDraftSuppliesDraft = lastDraftToken === "--draft" || (typeof lastDraftToken === "string" && DRAFT_TRUE_VALUE_PATTERN.test(lastDraftToken.slice("--draft=".length)));

  return {
    help: false,
    ghArgs: ["pr", "create", ...args, ...(lastDraftSuppliesDraft ? [] : ["--draft"])],
  };
}

export function spawnCreateDraftPr(ghArgs, { ghCommand = "gh", env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ghCommand, ghArgs, {
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const { help, ghArgs } = buildCreateDraftPrArgs(argv);

  if (help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  await warnMissingClosingKeyword(argv);

  return spawnCreateDraftPr(ghArgs, runtime);
}

if (isDirectCliRun(import.meta.url)) {
  try {
    const exitCode = await main();
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  }
}

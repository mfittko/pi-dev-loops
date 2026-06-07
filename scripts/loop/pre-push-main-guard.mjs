#!/usr/bin/env node
import { createInterface } from "node:readline";
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";

const PI_PREPUSH_BYPASS_VAR = "PI_PREPUSH_BYPASS";
const BLOCKED_REFS = ["refs/heads/main"];

const USAGE = `Usage:
  pre-push-main-guard.mjs

Reads pre-push hook input from stdin (Git pre-push hook protocol).
Blocks direct pushes to protected refs (by default: refs/heads/main).

Exit codes:
  0  Push allowed (non-main ref, or bypassed)
  1  Push blocked (target is a protected ref)

Bypass:
  PI_PREPUSH_BYPASS=1   Skip all checks (for emergencies only).
                         Preferred: push a feature branch and open a PR.`.trim();

const parseError = buildParseError(USAGE);

/**
 * Parse pre-push hook input lines.
 * Each line: <local ref> <local sha> <remote ref> <remote sha>
 */
async function readPushRefs(input) {
  const refs = [];
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(" ");
    if (parts.length >= 3) {
      refs.push({ localRef: parts[0], localSha: parts[1], remoteRef: parts[2], remoteSha: parts[3] || null });
    }
  }
  return refs;
}

/**
 * Check whether any push target is a blocked ref.
 */
function findBlockedRef(refs) {
  for (const ref of refs) {
    if (BLOCKED_REFS.includes(ref.remoteRef)) {
      return ref.remoteRef;
    }
  }
  return null;
}

export function parsePrePushGuardCliArgs(argv) {
  const args = [...argv];
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--help" || token === "-h") return { help: true };
    throw parseError(`Unknown argument: ${token}`);
  }
  return { help: false };
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = process.env } = {}) {
  const options = parsePrePushGuardCliArgs(argv);
  if (options.help) { stdout.write(`${USAGE}\n`); return { ok: true, help: true }; }

  if (env[PI_PREPUSH_BYPASS_VAR] === "1") {
    stdout.write(JSON.stringify({ ok: true, bypassed: true, reason: `${PI_PREPUSH_BYPASS_VAR}=1` }) + "\n");
    return { ok: true, bypassed: true };
  }

  const refs = await readPushRefs(stdin);
  const blockedRef = findBlockedRef(refs);

  if (blockedRef) {
    const payload = {
      ok: false,
      error: "direct_push_to_main_blocked",
      blockedRef,
      message: "Direct pushes to main branch are blocked. Push a feature branch and open a pull request instead.",
    };
    stderr.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const payload = { ok: true, blocked: false, refsChecked: refs.length };
  stdout.write(`${JSON.stringify(payload)}\n`);
  return payload;
}

if (isDirectCliRun(import.meta.url)) {
  runCli().then((result) => { if (result?.ok === false) { process.exitCode = 1; } }).catch((error) => { process.stderr.write(`${formatCliError(error)}\n`); process.exitCode = 1; });
}

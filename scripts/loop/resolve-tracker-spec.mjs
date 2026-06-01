#!/usr/bin/env node
/**
 * Resolve a GitHub tracker issue into a deterministic spec snapshot for
 * tracker-backed local implementation.
 *
 * Fetches the issue via `gh issue view` and normalizes it into a structured
 * spec shape suitable for phase planning.
 *
 * Usage:
 *   resolve-tracker-spec.mjs --issue 294 [--repo mfittko/pi-dev-loops]
 *
 * Success output shape (stdout, JSON):
 *   {
 *     "ok": true,
 *     "spec": {
 *       "objective": "...",
 *       "summary": "...",
 *       "scope": "...",
 *       "nonGoals": "...",
 *       "acceptanceCriteria": "...",
 *       "specBearing": true,
 *       "trackerRef": { "format": "github_issue", "owner": "...", "repo": "...", "number": "..." }
 *     }
 *   }
 *
 *   When --repo is omitted, trackerRef includes format and number only
 *   (owner/repo fields are absent).
 *
 * Exit codes:
 *   0  Success
 *   1  Argument error or runtime failure
 */

import { execFileSync } from "node:child_process";
import { isDirectCliRun, formatCliError } from "../_core-helpers.mjs";
import { parseRepoSlug } from "@pi-dev-loops/core/github/repo-slug";

export async function resolveTrackerSpec({ issue, repo }) {
  const args = ["issue", "view", String(issue), "--json", "title,body,state,number"];
  if (repo) {
    args.push("--repo", repo);
  }

  const raw = execFileSync("gh", args, { encoding: "utf8", timeout: 30_000 });
  const parsed = JSON.parse(raw);

  const { normalizeTrackerSpec, detectTrackerSpecFormat, TRACKER_SPEC_FORMAT } =
    await import("@pi-dev-loops/core/loop/tracker-spec-resolution");

  const trackerRef = repo
    ? detectTrackerSpecFormat(`${repo}#${parsed.number}`)
    : { format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE, number: String(parsed.number) };

  const spec = normalizeTrackerSpec({
    title: parsed.title,
    body: parsed.body,
    trackerRef,
  });

  return { ok: true, spec };
}

export function parseArgs(argv) {
  const args = [...argv];
  const options = { issue: undefined, repo: undefined };

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--issue") {
      const val = args.shift();
      if (!val || val.startsWith("--")) throw new Error("Missing value for --issue");
      const trimmed = val.trim();
      if (!/^[1-9]\d*$/.test(trimmed)) throw new Error(`--issue must be a positive integer, got: ${trimmed}`);
      options.issue = trimmed;
    } else if (token === "--repo") {
      const val = args.shift();
      if (!val || val.startsWith("--")) throw new Error("Missing value for --repo");
      const trimmed = val.trim();
      if (!/^[^/]+\/[^/]+$/.test(trimmed)) throw new Error(`--repo must be owner/name, got: ${trimmed}`);
      try { parseRepoSlug(trimmed); } catch (e) { throw new Error(`--repo validation failed: ${e.message}`); }
      options.repo = trimmed;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!options.issue) throw new Error("Missing required --issue <number>");
  return options;
}

export async function runCli(argv = process.argv.slice(2), stdout = process.stdout) {
  const options = parseArgs(argv);
  const result = await resolveTrackerSpec(options);
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error.message })}\n`
    );
    process.exitCode = 1;
  });
}

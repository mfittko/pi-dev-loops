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
 * Exit codes:
 *   0  Success
 *   1  Argument error or runtime failure
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.resolve(scriptDir, "..", "..", "packages", "core");

async function resolveTrackerSpec({ issue, repo }) {
  const args = ["issue", "view", String(issue), "--json", "title,body,state,number"];
  if (repo) {
    args.push("--repo", repo);
  }

  const raw = execFileSync("gh", args, { encoding: "utf8", timeout: 30_000 });
  const parsed = JSON.parse(raw);

  const { normalizeTrackerSpec, detectTrackerSpecFormat, TRACKER_SPEC_FORMAT } =
    await import(
      path.join(
        packagesRoot,
        "src",
        "loop",
        "tracker-spec-resolution.mjs"
      )
    );

  const repoSlug = repo || "";
  const trackerRef = repoSlug
    ? detectTrackerSpecFormat(`${repoSlug}#${parsed.number}`)
    : { format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE, number: String(parsed.number) };

  const spec = normalizeTrackerSpec({
    title: parsed.title,
    body: parsed.body,
    trackerRef,
  });

  return { ok: true, spec };
}

function parseArgs(argv) {
  const args = [...argv];
  const options = { issue: undefined, repo: undefined };

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--issue") {
      const val = args.shift();
      if (!val || val.startsWith("--")) throw new Error("Missing value for --issue");
      options.issue = val;
    } else if (token === "--repo") {
      const val = args.shift();
      if (!val || val.startsWith("--")) throw new Error("Missing value for --repo");
      options.repo = val;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!options.issue) throw new Error("Missing required --issue <number>");
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await resolveTrackerSpec(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error.message })}\n`
  );
  process.exitCode = 1;
});

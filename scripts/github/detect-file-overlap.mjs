#!/usr/bin/env node
/**
 * detect-file-overlap.mjs — Compute file-touch overlap between queued items.
 *
 * Uses `git diff --stat` projections or issue body file hints to determine
 * which files each issue touches, then computes overlap.
 *
 * Usage:
 *   node detect-file-overlap.mjs --repo <owner/name> --issues <n1,n2,...>
 *   node detect-file-overlap.mjs --repo <owner/name> --input <json-file>
 *
 * Output: JSON with overlap matrix and groups.
 */

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const USAGE = `Usage:
  detect-file-overlap.mjs --repo <owner/name> --issues <n1,n2,...>
  detect-file-overlap.mjs --repo <owner/name> --input <json-file>

Compute file-touch overlap between queued issues.
Exit codes: 0 success, 1 error`.trim();

function parseArgs(argv) {
  const args = { repo: null, issues: [], input: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      args.repo = argv[++i];
    } else if (argv[i] === "--issues" && i + 1 < argv.length) {
      args.issues = argv[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
    } else if (argv[i] === "--input" && i + 1 < argv.length) {
      args.input = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
  }
  return args;
}

/**
 * Get file hints from an issue body (extracts file paths from markdown).
 */
function extractFileHints(body) {
  if (!body) return [];
  const files = new Set();
  // Match backtick-wrapped paths
  const backtickRe = /`([^`]+\.[a-z]{1,10})`/gi;
  let m;
  while ((m = backtickRe.exec(body)) !== null) {
    const f = m[1].trim();
    if (f.includes("/") || f.includes(".")) files.add(f);
  }
  // Match explicit file references in lists
  const listRe = /^\s*[-*]\s+(?:`)?([^\s`]+\.[a-z]{1,10})(?:`)?/gim;
  while ((m = listRe.exec(body)) !== null) {
    files.add(m[1].trim());
  }
  return [...files];
}

async function getIssueFiles(repo, issueNumber) {
  try {
    const raw = execFileSync("gh", [
      "issue", "view", String(issueNumber),
      "--repo", repo,
      "--json", "body,title",
    ], { encoding: "utf8" });
    const issue = JSON.parse(raw);
    const files = extractFileHints(issue.body);
    // Also extract from title
    const titleFiles = extractFileHints(issue.title);
    return { issue: issueNumber, files: [...new Set([...files, ...titleFiles])] };
  } catch {
    return { issue: issueNumber, files: [] };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.repo) {
    console.error("Error: --repo <owner/name> is required");
    process.exit(1);
  }

  let entries = [];

  if (args.input) {
    const raw = await readFile(args.input, "utf8");
    const data = JSON.parse(raw);
    entries = data.entries || data;
  } else if (args.issues.length > 0) {
    entries = await Promise.all(
      args.issues.map((n) => getIssueFiles(args.repo, n))
    );
  } else {
    console.error("Error: --issues or --input required");
    process.exit(1);
  }

  // Compute overlap
  const entryFiles = entries.map((e) => ({
    target: e.issue || e.target,
    files: e.files || [],
  }));

  // Build overlap matrix
  const n = entryFiles.length;
  const overlapMatrix = [];
  for (let i = 0; i < n; i++) {
    overlapMatrix[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        overlapMatrix[i][j] = true;
      } else if (j < i) {
        overlapMatrix[i][j] = overlapMatrix[j][i];
      } else {
        const filesI = new Set(entryFiles[i].files);
        overlapMatrix[i][j] = entryFiles[j].files.some((f) => filesI.has(f));
      }
    }
  }

  // Compute overlap groups via union-find
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlapMatrix[i][j]) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entryFiles[i].target);
  }

  const output = {
    ok: true,
    entries: entryFiles,
    overlapMatrix,
    groups: [...groups.values()],
    groupCount: groups.size,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

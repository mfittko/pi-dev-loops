import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runNode as runNodeHelper,
  writeGhStub as writeGhStubHelper,
  writeJson as writeJsonHelper,
} from "../_helpers.mjs";

const scriptPath = path.resolve("scripts/loop/outer-loop.mjs");

export const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);
export const writeJson = writeJsonHelper;

/**
 * Write a fake `git` stub that responds to specific commands.
 * porcelainOutput: what `git status --porcelain` should return (empty string = clean)
 * headRef: what `git rev-parse --abbrev-ref HEAD` should return (e.g. "main" or "HEAD")
 */
export async function writeGitStub(tempDir, { porcelainOutput = "", headRef = "main", headSha = "abc123" } = {}) {
  const gitPath = path.join(tempDir, "git");
  await writeFile(
    gitPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2).join(' ');",
      `if (args.includes('status') && args.includes('porcelain')) {`,
      `  process.stdout.write(${JSON.stringify(porcelainOutput ? porcelainOutput + "\n" : "")});`,
      `  process.exit(0);`,
      `}`,
      `if (args.includes('rev-parse') && args.includes('abbrev-ref')) {`,
      `  process.stdout.write(${JSON.stringify(headRef + "\n")});`,
      `  process.exit(0);`,
      `}`,
      `if (args === 'rev-parse HEAD') {`,
      `  process.stdout.write(${JSON.stringify(headSha + "\n")});`,
      `  process.exit(0);`,
      `}`,
      `process.exit(0);`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(gitPath, 0o755);

  return {
    ...process.env,
    PATH: [tempDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

export async function writeGhStub(
  tempDir,
  {
    repo = "owner/myrepo",
    pr = 47,
    headSha = "abc123",
    headRefName = "copilot/example-branch",
  } = {},
) {
  const prViewEntry = {
    assertArgs: ["pr", "view", String(pr), "--repo", repo, "--json"],
    stdout: JSON.stringify({ isDraft: false, state: "OPEN", number: pr, headRefOid: headSha, headRefName, reviews: [], statusCheckRollup: [] }) + "\n",
  };
  const requestedReviewersEntry = {
    assertArgs: ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
    stdout: JSON.stringify({ users: [] }) + "\n",
  };
  const reviewsEntry = {
    assertArgs: ["api", `repos/${repo}/pulls/${pr}/reviews`],
    stdout: "[]\n",
  };
  const graphqlEntry = {
    assertArgs: ["api", "graphql"],
    stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }) + "\n",
  };

  const { env } = await writeGhStubHelper(
    tempDir,
    [
      ...Array.from({ length: 6 }, () => prViewEntry),
      ...Array.from({ length: 4 }, () => requestedReviewersEntry),
      ...Array.from({ length: 4 }, () => reviewsEntry),
      ...Array.from({ length: 6 }, () => graphqlEntry),
    ],
    { matchMode: "claims" },
  );

  return env;
}

export const MINIMAL_COPILOT_SNAPSHOT = Object.freeze({
  prExists: true,
  prNumber: 47,
  prDraft: false,
  prMerged: false,
  prClosed: false,
  copilotReviewRequestStatus: "none",
  copilotReviewPresent: false,
  unresolvedThreadCount: 0,
  actionableThreadCount: 0,
  ciStatus: "none",
  agentFixStatus: null,
});

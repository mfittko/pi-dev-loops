import path from "node:path";

import {
  runNode as runNodeHelper,
  writeGhStub as writeGhStubHelper,
  writeJson as writeJsonHelper,
} from "../_helpers.mjs";

const scriptPath = path.resolve("scripts/loop/detect-copilot-loop-state.mjs");

export const fixturePath = path.resolve(
  "packages/core/test/fixtures/github/review-threads/mixed-threads.json",
);

export const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);
export const writeJson = writeJsonHelper;

/**
 * Write a gh stub that matches scripted gh invocations in any order.
 * Each matching entry is claimed at most once via the claims directory.
 * Each entry: { assertArgs?, stdout?, stderr?, exitCode? }
 */
export const writeGhStub = (tempDir, entries) => (
  writeGhStubHelper(tempDir, entries, { matchMode: "claims" })
);

function makeReviewThreadsPayload(nodes = []) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes,
          },
        },
      },
    },
  };
}

export function makeThread({ id, isResolved = false, comments }) {
  return {
    id,
    isResolved,
    comments: {
      nodes: comments,
    },
  };
}

export function makeComment({ id, body, login = "reviewer", type = "User" }) {
  return {
    id,
    body,
    author: {
      login,
      __typename: type,
    },
  };
}

export async function writeAutoDetectGhStub(
  tempDir,
  {
    repo = "owner/repo",
    pr,
    prView = {},
    requestedReviewers = { users: [], teams: [] },
    reviewThreads = [],
    skipRequestedReviewers = false,
  } = {},
) {
  const entries = [
    {
      assertArgs: ["pr", "view", String(pr), "--repo", repo],
      stdout: `${JSON.stringify({
        headRefOid: "abc123",
        isDraft: false,
        state: "OPEN",
        number: pr,
        reviews: [],
        statusCheckRollup: [],
        ...prView,
      })}
`,
    },
  ];

  if (!skipRequestedReviewers) {
    entries.push({
      assertArgs: ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
      stdout: `${JSON.stringify(requestedReviewers)}
`,
    });
  }

  entries.push({
    assertArgs: ["api", "graphql"],
    stdout: `${JSON.stringify(makeReviewThreadsPayload(reviewThreads))}
`,
  });

  return writeGhStub(tempDir, entries);
}

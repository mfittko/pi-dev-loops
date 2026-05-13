import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  isActionableComment,
  isActionableThread,
  parseReviewThreads,
} from "../src/github/review-threads.mjs";

const fixturePath = path.resolve("packages/core/test/fixtures/github/review-threads/mixed-threads.json");

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("isActionableComment filters bot and empty comments deterministically", () => {
  assert.equal(
    isActionableComment({ body: "Please add a test", author: { login: "reviewer", __typename: "User" } }),
    true,
  );
  assert.equal(
    isActionableComment({ body: "Automated note", author: { login: "copilot[bot]", __typename: "Bot" } }),
    false,
  );
  assert.equal(isActionableComment({ body: "   ", author: { login: "reviewer", __typename: "User" } }), false);
  assert.equal(isActionableComment({ body: "System event", author: null }), false);
});

test("isActionableThread requires an unresolved thread with at least one actionable comment", () => {
  assert.equal(
    isActionableThread({
      isResolved: false,
      comments: { nodes: [{ body: "Needs a test", author: { login: "reviewer", __typename: "User" } }] },
    }),
    true,
  );
  assert.equal(
    isActionableThread({
      isResolved: true,
      comments: { nodes: [{ body: "Needs a test", author: { login: "reviewer", __typename: "User" } }] },
    }),
    false,
  );
});

test("parseReviewThreads normalizes fixture-backed review thread data", async () => {
  const payload = await loadFixture();
  const result = parseReviewThreads(payload);

  assert.deepEqual(result.summary, {
    totalThreads: 3,
    unresolvedThreads: 2,
    actionableThreads: 1,
    actionableComments: 1,
  });

  assert.deepEqual(result.threads, [
    {
      id: "t-1",
      isResolved: false,
      isActionable: true,
      commentIds: ["c-1"],
      actionableCommentIds: ["c-1"],
    },
    {
      id: "t-2",
      isResolved: true,
      isActionable: false,
      commentIds: ["c-2"],
      actionableCommentIds: [],
    },
    {
      id: "t-3",
      isResolved: false,
      isActionable: false,
      commentIds: ["c-3", "c-4"],
      actionableCommentIds: [],
    },
  ]);

  assert.deepEqual(result.comments, [
    {
      id: "c-1",
      threadId: "t-1",
      author: { login: "reviewer", type: "User", isBot: false },
      body: "Please add regression coverage.",
      isActionable: true,
    },
    {
      id: "c-2",
      threadId: "t-2",
      author: { login: "maintainer", type: "User", isBot: false },
      body: "Resolve after the docs update lands.",
      isActionable: true,
    },
    {
      id: "c-3",
      threadId: "t-3",
      author: { login: "copilot-pull-request-reviewer[bot]", type: "Bot", isBot: true },
      body: "Automated summary from Copilot.",
      isActionable: false,
    },
    {
      id: "c-4",
      threadId: "t-3",
      author: { login: "", type: "System", isBot: false },
      body: "Thread metadata event.",
      isActionable: false,
    },
  ]);
});

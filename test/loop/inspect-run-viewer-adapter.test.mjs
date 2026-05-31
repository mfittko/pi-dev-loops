import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { createInspectionViewerAdapter, parseGhJsonOutput } from "../../scripts/loop/_inspect-run-viewer-adapter.mjs";
test("createInspectionViewerAdapter loadSnapshot validates target deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "owner/repo", pr: "nope" }),
    /positive integer/,
  );
  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "../../bad", pr: 55 }),
    /target\.repo must match <owner\/name>/,
  );
});

test("createInspectionViewerAdapter keeps normalized target authoritative over options", async () => {
  let inspectRunCall;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async (input) => {
      inspectRunCall = input;
      return { ok: true };
    },
  });

  await adapter.loadSnapshot(
    { repo: "owner/repo", pr: "55" },
    { repo: "other/repo", pr: 99, reviewerLogin: "reviewer" },
  );

  assert.deepEqual(inspectRunCall, {
    repo: "owner/repo",
    pr: 55,
    reviewerLogin: "reviewer",
  });
});

test("createInspectionViewerAdapter omits --updated when updatedWithinDays is null", async () => {
  const seenArgs = [];
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async (args) => {
      seenArgs.push(args);
      return [];
    },
  });

  await adapter.listAssignedPullRequests({ repo: "owner/repo", updatedWithinDays: null });

  assert.deepEqual(seenArgs[0], [
    "search",
    "prs",
    "--assignee",
    "@me",
    "--repo",
    "owner/repo",
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    "25",
    "--json",
    "number,title,repository,updatedAt,state,isDraft",
  ]);
  for (const args of seenArgs) {
    assert.equal(args.includes("--updated"), false);
  }
});

test("createInspectionViewerAdapter refreshes expired assigned PR cache entries", async () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  let ghCalls = 0;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    nowImpl: () => nowMs,
    runGhJsonImpl: async (args) => {
      ghCalls += 1;
      if (args.includes("changes_requested") || args.includes("failure") || args.includes("pending") || args.includes("approved")) {
        return [];
      }
      return [
        {
          number: 55,
          title: "Primary PR",
          repository: { nameWithOwner: "owner/repo" },
          state: "OPEN",
          isDraft: false,
        },
      ];
    },
  });

  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 5);

  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 5);

  nowMs += 16_000;
  await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.equal(ghCalls, 10);
});

test("createInspectionViewerAdapter lists assigned open PRs for the current user", async () => {
  const seenArgs = [];
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    nowImpl: () => Date.parse("2026-05-21T00:00:00.000Z"),
    runGhJsonImpl: async (args) => {
      seenArgs.push(args);
      if (args.includes("changes_requested")) {
        return [
          { number: 77, repository: { owner: { login: "other" }, name: "repo" } },
        ];
      }
      if (args.includes("failure")) {
        return [];
      }
      if (args.includes("pending")) {
        return [];
      }
      if (args.includes("approved")) {
        return [
          { number: 55, repository: { nameWithOwner: "owner/repo" } },
        ];
      }
      return [
        {
          number: 77,
          title: "Needs attention PR",
          repository: { owner: { login: "other" }, name: "repo" },
          state: "OPEN",
          isDraft: false,
        },
        {
          number: 55,
          title: "Primary PR",
          repository: { nameWithOwner: "owner/repo" },
          state: "OPEN",
          isDraft: false,
        },
      ];
    },
  });

  const assigned = await adapter.listAssignedPullRequests({ repo: "owner/repo" });

  assert.deepEqual(seenArgs[0], [
    "search",
    "prs",
    "--assignee",
    "@me",
    "--repo",
    "owner/repo",
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--updated",
    ">=2026-05-14",
    "--limit",
    "25",
    "--json",
    "number,title,repository,updatedAt,state,isDraft",
  ]);
  assert.equal(seenArgs.length, 5);
  assert.deepEqual(assigned, [
    { target: { repo: "other/repo", pr: 77 }, title: "Needs attention PR", updatedAt: null, signal: "attention" },
    { target: { repo: "owner/repo", pr: 55 }, title: "Primary PR", updatedAt: null, signal: "ready" },
  ]);
});

test("parseGhJsonOutput wraps invalid gh JSON deterministically", () => {
  assert.throws(
    () => parseGhJsonOutput("not json\n"),
    /Invalid JSON from gh: not json/,
  );
});

test("createInspectionViewerAdapter listAssignedPullRequests reports invalid gh JSON deterministically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inspect-viewer-gh-"));

  try {
    const fakeGh = path.join(dir, "fake-gh.sh");
    await writeFile(fakeGh, "#!/bin/sh\nprintf 'not json\n'\n", "utf8");
    await chmod(fakeGh, 0o755);

    const adapter = createInspectionViewerAdapter({
      inspectRunImpl: async () => ({ ok: true }),
    });

    await assert.rejects(
      () => adapter.listAssignedPullRequests({ repo: "owner/repo", ghCommand: fakeGh }),
      /Invalid JSON from gh: not json/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("createInspectionViewerAdapter listAssignedPullRequests wraps malformed repo filters deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async () => {
      throw new Error("should not reach gh");
    },
  });

  await assert.rejects(
    () => adapter.listAssignedPullRequests({ repo: "owner" }),
    (error) => error?.code === "MALFORMED_TARGET" && /repo must match <owner\/name>/.test(String(error?.message)),
  );
});

test("createInspectionViewerAdapter listAssignedPullRequests skips malformed search rows", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
    runGhJsonImpl: async (args) => {
      if (args.includes("changes_requested") || args.includes("failure") || args.includes("pending") || args.includes("approved")) {
        return [];
      }
      return [
        { number: 0, repository: { nameWithOwner: "owner/repo" } },
        { number: 12, repository: null },
        { number: 44, repository: { owner: { login: "owner" }, name: "repo" }, state: "OPEN", isDraft: false },
      ];
    },
  });

  const assigned = await adapter.listAssignedPullRequests({ repo: "owner/repo" });
  assert.deepEqual(assigned, [
    { target: { repo: "owner/repo", pr: 44 }, title: null, updatedAt: null, signal: "waiting" },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadBoardConfig,
  syncBoardStatus,
  nonSuccessBoardColumn,
} from "../src/loop/queue-board-sync.mjs";

async function makeRepo(configYaml) {
  const dir = await mkdtemp(path.join(tmpdir(), "queue-board-sync-"));
  if (configYaml) {
    await writeFile(path.join(dir, ".devloops"), configYaml);
  }
  return dir;
}

test("loadBoardConfig returns disabled when no .devloops", async () => {
  const dir = await makeRepo(null);
  try {
    assert.deepEqual(loadBoardConfig(dir), { enabled: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBoardConfig enabled by projectNumber", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 7\n");
  try {
    assert.deepEqual(loadBoardConfig(dir), { enabled: true, projectNumber: 7 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBoardConfig enabled by boardTitle", async () => {
  const dir = await makeRepo('queue:\n  boardTitle: "My Queue"\n');
  try {
    assert.deepEqual(loadBoardConfig(dir), { enabled: true, boardTitle: "My Queue" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syncBoardStatus skips when board not configured", async () => {
  const dir = await makeRepo(null);
  try {
    const result = await syncBoardStatus("owner/repo", dir, 42, "In Progress", {});
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "board not configured");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syncBoardStatus moves item when configured", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 5\n");
  try {
    const moved = [];
    const result = await syncBoardStatus(
      "owner/repo",
      dir,
      42,
      "In Progress",
      { GH_TOKEN: "mock" },
      {
        moveQueueItem: async (args, _ctx) => {
          moved.push(args);
          return { ok: true, item: { newColumn: args.toColumn } };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(moved.length, 1);
    assert.deepEqual(moved[0], {
      repo: "owner/repo",
      project: 5,
      item: 42,
      toColumn: "In Progress",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syncBoardStatus fail-open when move fails", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 5\n");
  try {
    const result = await syncBoardStatus(
      "owner/repo",
      dir,
      42,
      "Done",
      { GH_TOKEN: "mock" },
      {
        moveQueueItem: async () => {
          throw new Error("API rate limit");
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "API rate limit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nonSuccessBoardColumn uses default", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 5\n");
  try {
    assert.equal(nonSuccessBoardColumn(dir), "Backlog");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nonSuccessBoardColumn uses configured value", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 5\n  nonSuccessStatus: Todo\n");
  try {
    assert.equal(nonSuccessBoardColumn(dir), "Todo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBoardConfig surfaces config read errors", async () => {
  const dir = await makeRepo(null);
  try {
    await writeFile(path.join(dir, ".devloops"), "queue: [invalid yaml");
    const result = loadBoardConfig(dir);
    assert.equal(result.enabled, false);
    assert.match(result.reason, /config read\/parse error/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

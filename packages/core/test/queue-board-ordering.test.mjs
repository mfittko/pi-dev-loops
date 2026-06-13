import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveNextUpOrder } from "../src/loop/queue-board-ordering.mjs";

async function makeRepo(configYaml) {
  const dir = await mkdtemp(path.join(tmpdir(), "queue-board-ordering-"));
  if (configYaml) {
    await writeFile(path.join(dir, ".devloops"), configYaml);
  }
  return dir;
}

test("resolveNextUpOrder returns empty when board not configured", async () => {
  const dir = await makeRepo(null);
  try {
    const result = await resolveNextUpOrder("owner/repo", dir, {});
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, []);
    assert.equal(result.reason, "board not configured");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveNextUpOrder returns order from mocked list helper", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 3\n");
  try {
    const result = await resolveNextUpOrder(
      "owner/repo",
      dir,
      { GH_TOKEN: "mock" },
      {
        listQueueItems: async (args) => {
          assert.deepEqual(args, { repo: "owner/repo", project: 3, column: "Next Up" });
          return {
            ok: true,
            items: [
              { issueNumber: 10, prNumber: null },
              { issueNumber: null, prNumber: 20 },
              { issueNumber: 30 },
            ],
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, [10, 20, 30]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveNextUpOrder fail-open on list error", async () => {
  const dir = await makeRepo("queue:\n  projectNumber: 3\n");
  try {
    const result = await resolveNextUpOrder(
      "owner/repo",
      dir,
      { GH_TOKEN: "mock" },
      {
        listQueueItems: async () => {
          throw new Error("GraphQL timeout");
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, []);
    assert.equal(result.reason, "GraphQL timeout");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

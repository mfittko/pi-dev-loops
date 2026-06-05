import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";

import { runNode as runNodeHelper } from "../_helpers.mjs";
import {
  buildRetrospectiveCheckpointPayload,
  parseCheckpointContractCliArgs,
} from "../../scripts/loop/checkpoint-contract.mjs";

const scriptPath = path.resolve("scripts/loop/checkpoint-contract.mjs");
const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

test("parseCheckpointContractCliArgs requires --state", () => {
  assert.throws(() => parseCheckpointContractCliArgs([]), /requires --state/i);
});

test("parseCheckpointContractCliArgs enforces state-specific metadata", () => {
  assert.throws(() => parseCheckpointContractCliArgs(["--state", "complete"]), /requires --notes/i);
  assert.throws(() => parseCheckpointContractCliArgs(["--state", "skipped"]), /requires --reason/i);
});

test("buildRetrospectiveCheckpointPayload writes complete payload shape", () => {
  const now = new Date("2026-06-05T00:00:00.000Z");
  const payload = buildRetrospectiveCheckpointPayload({ state: "complete", notes: "all good" }, now);
  assert.deepEqual(payload, {
    state: "complete",
    completedAt: "2026-06-05T00:00:00.000Z",
    notes: "all good",
  });
});

test("checkpoint-contract CLI writes checkpoint file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "checkpoint-contract-test-"));
  try {
    const { code, stdout, stderr } = await runNode(
      ["--state", "complete", "--notes", "Retrospective documented after merge"],
      { cwd: tempDir },
    );

    assert.equal(code, 0);
    assert.equal(stderr, "");
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.path, ".pi/dev-loop-retrospective-checkpoint.json");
    assert.equal(output.checkpoint.state, "complete");
    assert.equal(typeof output.checkpoint.completedAt, "string");

    const checkpointPath = path.join(tempDir, ".pi", "dev-loop-retrospective-checkpoint.json");
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    assert.equal(checkpoint.state, "complete");
    assert.equal(checkpoint.notes, "Retrospective documented after merge");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

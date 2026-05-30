import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);

test("packages/core exports public loop contract modules in package metadata", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  assert.equal(
    packageJson.exports["./loop/conductor-ownership"],
    "./src/loop/conductor-ownership.mjs",
  );
  assert.equal(
    packageJson.exports["./loop/outer-loop-state"],
    "./src/loop/outer-loop-state.mjs",
  );
  assert.equal(
    packageJson.exports["./loop/public-dev-loop-routing"],
    "./src/loop/public-dev-loop-routing.mjs",
  );
  assert.equal(
    packageJson.exports["./loop/retrospective-checkpoint"],
    "./src/loop/retrospective-checkpoint.mjs",
  );
  assert.equal(
    packageJson.exports["./loop/tracker-pr-state"],
    "./src/loop/tracker-pr-state.mjs",
  );
  assert.equal(
    packageJson.exports["./loop/conductor-pr-projection"],
    "./src/loop/conductor-pr-projection.mjs",
  );
});

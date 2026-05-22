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
    packageJson.exports["./loop/public-dev-loop-routing"],
    "./src/loop/public-dev-loop-routing.mjs",
  );
});

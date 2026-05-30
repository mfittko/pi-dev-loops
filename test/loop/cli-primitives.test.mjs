import assert from "node:assert/strict";
import test from "node:test";

import { parsePrNumber, requireOptionValue, runChild } from "../../scripts/_cli-primitives.mjs";

test("requireOptionValue returns next value", () => {
  const args = ["abc"];
  assert.equal(requireOptionValue(args, "--repo"), "abc");
});

test("requireOptionValue uses provided parseError", () => {
  assert.throws(
    () => requireOptionValue([], "--repo", (message) => Object.assign(new Error(message), { usage: "usage" })),
    (error) => error.message === "Missing value for --repo" && error.usage === "usage",
  );
});

test("parsePrNumber validates positive integer with custom error", () => {
  assert.throws(
    () => parsePrNumber("0", (message) => Object.assign(new Error(message), { usage: "usage" })),
    (error) => error.message === "--pr must be a positive integer" && error.usage === "usage",
  );
});

test("runChild captures stdout and stderr", async () => {
  const result = await runChild(
    process.execPath,
    ["-e", "process.stdout.write('ok'); process.stderr.write('warn');"],
    process.env,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "warn");
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/loop/resolve-tracker-spec.mjs"
);

describe("resolve-tracker-spec.mjs integration", () => {
  it("exits with error on missing --issue", () => {
    try {
      execFileSync("node", [scriptPath], { encoding: "utf8", timeout: 5000 });
      assert.fail("Expected non-zero exit");
    } catch (error) {
      const stderr = error.stderr || "";
      const parsed = JSON.parse(stderr);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error.includes("Missing required"));
      assert.ok(typeof parsed.usage === "string");
    }
  });

  it("exits with error on non-numeric --issue", () => {
    try {
      execFileSync("node", [scriptPath, "--issue", "abc"], { encoding: "utf8", timeout: 5000 });
      assert.fail("Expected non-zero exit");
    } catch (error) {
      const stderr = error.stderr || "";
      const parsed = JSON.parse(stderr);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error.includes("positive integer"));
      assert.ok(typeof parsed.usage === "string");
    }
  });

  it("exits with error on invalid --repo", () => {
    try {
      execFileSync("node", [scriptPath, "--issue", "1", "--repo", "bad"], { encoding: "utf8", timeout: 5000 });
      assert.fail("Expected non-zero exit");
    } catch (error) {
      const stderr = error.stderr || "";
      const parsed = JSON.parse(stderr);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error.includes("owner/name"));
      assert.ok(typeof parsed.usage === "string");
    }
  });

  it("exits with error on unknown argument", () => {
    try {
      execFileSync("node", [scriptPath, "--unknown"], { encoding: "utf8", timeout: 5000 });
      assert.fail("Expected non-zero exit");
    } catch (error) {
      const stderr = error.stderr || "";
      const parsed = JSON.parse(stderr);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error.includes("Unknown argument"));
      assert.ok(typeof parsed.usage === "string");
    }
  });
});

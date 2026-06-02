import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";

import {
  DevLoopConfigSchema,
  BUILT_IN_DEFAULTS,
} from "../src/config/schema.mjs";
import { resolveConductorModel } from "../src/config/model-resolution.mjs";
// ============================================================================
// Schema validation tests (S1–S26)
// ============================================================================

describe("schema validation", () => {
  test("S1: full valid config parses successfully", () => {
    const input = {
      version: 1,
      strategy: { default: "local-first" },
      models: { conductor: "gpt-5", roles: { security: "gpt-5" } },
      refinement: { fanOut: 5, mode: "sequential", roles: ["security"] },
      gates: {
        draft: { angles: ["style", "correctness"], required: true },
        preApproval: { angles: ["dry", "kiss", "yagni"], required: false },
      },
      autonomy: { stopAt: ["draft-pr", "merge"] },
    };
    const result = DevLoopConfigSchema.safeParse(input);
    assert.ok(result.success, "full config should parse");
    assert.equal(result.data.version, 1);
  });

  test("S2: minimal config (only version: 1) parses successfully", () => {
    const result = DevLoopConfigSchema.safeParse({ version: 1 });
    assert.ok(result.success);
    assert.equal(result.data.version, 1);
    // Optional families are undefined — BUILT_IN_DEFAULTS fills gaps at load time
    assert.equal(result.data.strategy, undefined);
    assert.equal(result.data.refinement, undefined);
  });

  test("S3: missing version field", () => {
    const result = DevLoopConfigSchema.safeParse({});
    assert.ok(!result.success);
  });

  test("S4: wrong version (version: 2)", () => {
    const result = DevLoopConfigSchema.safeParse({ version: 2 });
    assert.ok(!result.success);
  });

  test("S5: unknown top-level key rejected", () => {
    const result = DevLoopConfigSchema.safeParse({ version: 1, unknownKey: true });
    assert.ok(!result.success);
  });

  test("S6: unknown nested key inside strategy rejected", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      strategy: { default: "github-first", unknownKey: true },
    });
    assert.ok(!result.success);
  });

  test("S7: unknown nested key inside models rejected", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      models: { conductor: "gpt-5", unknownKey: true },
    });
    assert.ok(!result.success);
  });

  test("S8: unknown nested key inside refinement rejected", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: 3, unknownKey: true },
    });
    assert.ok(!result.success);
  });

  test("S9: unknown nested key inside gates rejected", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      gates: { unknownKey: true },
    });
    assert.ok(!result.success);
  });

  test("S10: unknown nested key inside autonomy rejected", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      autonomy: { stopAt: ["merge"], unknownKey: true },
    });
    assert.ok(!result.success);
  });

  test("S11: strategy.default bad enum", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      strategy: { default: "neither" },
    });
    assert.ok(!result.success);
  });

  test("S12: refinement.mode bad enum", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: 3, mode: "async" },
    });
    assert.ok(!result.success);
  });

  test("S13: refinement.fanOut is 0", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: 0 },
    });
    assert.ok(!result.success);
  });

  test("S14: refinement.fanOut is 11", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: 11 },
    });
    assert.ok(!result.success);
  });

  test("S15: refinement.fanOut is a float", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: 2.5 },
    });
    assert.ok(!result.success);
  });

  test("S16: refinement.fanOut is negative", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: -1 },
    });
    assert.ok(!result.success);
  });

  test("S17: refinement.fanOut is a string", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      refinement: { fanOut: "three" },
    });
    assert.ok(!result.success);
  });

  test("S18: autonomy.stopAt contains unknown gate name", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      autonomy: { stopAt: ["bad-gate"] },
    });
    assert.ok(!result.success);
  });

  test("S19: autonomy.stopAt is a string instead of array", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      autonomy: { stopAt: "merge" },
    });
    assert.ok(!result.success);
  });

  test("S20: root is null", () => {
    const result = DevLoopConfigSchema.safeParse(null);
    assert.ok(!result.success);
  });

  test("S21: root is array", () => {
    const result = DevLoopConfigSchema.safeParse([{ version: 1 }]);
    assert.ok(!result.success);
  });

  test("S22: root is string", () => {
    const result = DevLoopConfigSchema.safeParse("not-an-object");
    assert.ok(!result.success);
  });

  test("S23: empty object", () => {
    const result = DevLoopConfigSchema.safeParse({});
    assert.ok(!result.success);
  });

  test("S24: strategy.byWorkflow rejected as unknown key", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      strategy: { default: "github-first", byWorkflow: { x: "local-first" } },
    });
    assert.ok(!result.success);
  });

  test("S25: models.roles has empty string value", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      models: { roles: { security: "" } },
    });
    assert.ok(!result.success);
  });

  test("S26: deeply nested unknown key inside gates.draft", () => {
    const result = DevLoopConfigSchema.safeParse({
      version: 1,
      gates: { draft: { angles: ["style"], unknownNested: true } },
    });
    assert.ok(!result.success);
  });
});

// ============================================================================
// DevLoopConfigSchema.safeParse tests
// ============================================================================

describe("DevLoopConfigSchema.safeParse", () => {
  test("returns { success: true, data } for valid config", () => {
    const result = DevLoopConfigSchema.safeParse({ version: 1 });
    assert.ok(result.success);
  });

  test("returns { success: false, error } for invalid config", () => {
    const result = DevLoopConfigSchema.safeParse({});
    assert.ok(!result.success);
    assert.ok(result.error !== undefined);
  });
});

// ============================================================================
// BUILT_IN_DEFAULTS tests
// ============================================================================

describe("BUILT_IN_DEFAULTS", () => {
  test("is frozen", () => {
    assert.throws(() => { BUILT_IN_DEFAULTS.version = 2; }, TypeError);
  });

  test("has version 1", () => {
    assert.equal(BUILT_IN_DEFAULTS.version, 1);
  });

  test("strategy.default is github-first", () => {
    assert.equal(BUILT_IN_DEFAULTS.strategy.default, "github-first");
  });

  test("refinement.fanOut is 3 and mode is parallel", () => {
    assert.equal(BUILT_IN_DEFAULTS.refinement.fanOut, 3);
    assert.equal(BUILT_IN_DEFAULTS.refinement.mode, "parallel");
  });

  test("autonomy.stopAt is [merge]", () => {
    assert.deepEqual(BUILT_IN_DEFAULTS.autonomy.stopAt, ["merge"]);
  });
});

// ============================================================================
// Loader — graceful degradation tests (L1–L17)
// ============================================================================

describe("loader — graceful degradation", () => {
  /** @type {import("../src/config/loader.mjs").loadDevLoopConfig} */
  let loadDevLoopConfig;

  test("loader module imports without I/O", async () => {
    // Schema module must not throw on import
    const schema = await import("../src/config/schema.mjs");
    assert.ok(schema.DevLoopConfigSchema);
  });

  test("L1: both defaults.json and overrides.json missing", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L1-"));
    try {
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.warnings.length > 0, "should warn about missing defaults.json");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L2: only defaults.json present, valid", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L2-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "local-first");
      assert.equal(result.warnings.length, 0);
      assert.equal(result.errors.length, 0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L3: both files present, valid", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L3-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" }, refinement: { fanOut: 5 } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, strategy: { default: "github-first" } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      // overrides.json beats defaults.json for strategy, but refinement falls through
      assert.equal(result.config.strategy.default, "github-first");
      assert.equal(result.config.refinement.fanOut, 5);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L4: defaults.json exists but is not valid JSON", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L4-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"), "not json {{{");
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.errors.length > 0, "should have errors for invalid JSON");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L5: defaults.json is valid JSON but fails schema", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L5-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, unknownKey: true }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.errors.length > 0, "should error for schema violation");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L6: overrides.json exists but is not valid JSON", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L6-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      await writeFile(path.join(piDir, "overrides.json"), "broken json [[[");
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "local-first");
      assert.ok(result.errors.length > 0, "should error for broken overrides");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L7: overrides.json is valid JSON but fails schema", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L7-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, unknownKey: true }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "local-first");
      assert.ok(result.errors.length > 0, "should error for bad overrides schema");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L8: defaults.json is a directory (EISDIR)", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L8-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      // create a directory where defaults.json should be
      await mkdir(path.join(piDir, "defaults.json"));
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.errors.length > 0, "should error for EISDIR");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L10: defaults.json is empty file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L10-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"), "");
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.errors.length > 0, "empty JSON should error");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L12: defaults.json has only version: 1 — all else defaulted", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L12-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"), JSON.stringify({ version: 1 }));
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "github-first");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L13: overrides.json has only refinement.fanOut: 7", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L13-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, refinement: { fanOut: 7 } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.refinement.fanOut, 7);
      assert.equal(result.config.strategy.default, "local-first");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L14: both files invalid — still returns built-in defaults", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L14-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"), "bad json");
      await writeFile(path.join(piDir, "overrides.json"), "also bad");
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.equal(result.config.strategy.default, "github-first");
      assert.ok(result.errors.length >= 2, "should have errors for both files");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L15: defaults.json has version: 1 but overrides.json has version: 2", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L15-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 2, strategy: { default: "github-first" } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      // overrides.json rejected, defaults.json applied
      assert.equal(result.config.strategy.default, "local-first");
      assert.ok(result.errors.length > 0, "should error for version mismatch");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L16: .pi/ exists but no dev-loop/ subdirectory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L16-"));
    try {
      await mkdir(path.join(tmpDir, ".pi"));
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.warnings.length > 0, "should warn about missing defaults");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("L17: defaults.json with only version: 1 — all families from built-in", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L17-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"), JSON.stringify({ version: 1 }));
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "github-first");
      assert.equal(result.config.refinement.fanOut, 3);
      assert.equal(result.config.refinement.mode, "parallel");
      assert.deepEqual(result.config.autonomy.stopAt, ["merge"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Loader — precedence tests (M1–M6)
// ============================================================================

describe("loader — precedence", () => {
  test("M1: defaults.json overrides built-in strategy.default", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M1-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.equal(result.config.strategy.default, "local-first");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("M2: overrides.json beats defaults.json", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M2-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, refinement: { fanOut: 5 } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, refinement: { fanOut: 7 } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.equal(result.config.refinement.fanOut, 7);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("M3: missing key in overrides falls through to defaults", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M3-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, refinement: { fanOut: 5, mode: "sequential" } }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, refinement: { fanOut: 7 } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.equal(result.config.refinement.fanOut, 7);
      assert.equal(result.config.refinement.mode, "sequential");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("M4: missing key in both falls through to built-in", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M4-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1 }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.deepEqual(result.config.autonomy.stopAt, ["merge"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("M5: overrides.json sets a key defaults.json doesn't mention", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M5-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1 }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({ version: 1, models: { conductor: "gpt-5" } }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.equal(result.config.models.conductor, "gpt-5");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("M6: shallow merge — models.roles in overrides replaces entire models.roles", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M6-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({
          version: 1,
          models: { roles: { security: "gpt-5", style: "claude" } },
        }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({
          version: 1,
          models: { roles: { correctness: "gpt-4" } },
        }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      const roles = result.config.models.roles;
      // Shallow merge: overrides replaces entire models.roles
      assert.ok(roles.correctness, "should have correctness from overrides");
      assert.ok(!roles.security, "should NOT have security (replaced by shallow merge)");
      assert.ok(!roles.style, "should NOT have style (replaced by shallow merge)");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Role resolution tests (R1–R9)
// ============================================================================

describe("role resolution", () => {
  /** @type {import("../src/config/roles.mjs").resolveReviewerRole} */
  let resolveReviewerRole;

  test("roles module imports without error", async () => {
    const mod = await import("../src/config/roles.mjs");
    resolveReviewerRole = mod.resolveReviewerRole;
    assert.ok(typeof resolveReviewerRole === "function");
  });

  test("R1: all angles fall back when registry is empty", () => {
    const result = resolveReviewerRole({}, "security");
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.fallback, true);
  });

  test("R2: unknown angle falls back", () => {
    const result = resolveReviewerRole({}, "custom-lens");
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.fallback, true);
  });

  test("R3: angle with model override applies override even when falling back", () => {
    const result = resolveReviewerRole(
      { models: { roles: { style: "gpt-5" } } },
      "style",
    );
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.model, "gpt-5");
    assert.equal(result.fallback, true);
  });

  test("R4: unknown angle with model override", () => {
    const result = resolveReviewerRole(
      { models: { roles: { unknown: "claude-opus" } } },
      "unknown",
    );
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.model, "claude-opus");
    assert.equal(result.fallback, true);
  });

  test("R5: empty config — all angles resolve to built-in defaults (fallback)", () => {
    const result = resolveReviewerRole({}, "security");
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.model, null);
    assert.equal(result.fallback, true);
  });

  test("R6: missing models.roles in config", () => {
    const result = resolveReviewerRole({ models: {} }, "security");
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.model, null);
  });

  test("R7: null or undefined angle returns fallback", () => {
    const r1 = resolveReviewerRole({}, null);
    assert.equal(r1.persona, "default-reviewer");
    assert.equal(r1.fallback, true);

    const r2 = resolveReviewerRole({}, undefined);
    assert.equal(r2.persona, "default-reviewer");
    assert.equal(r2.fallback, true);
  });

  test("R9: model override with empty string ignored", () => {
    const result = resolveReviewerRole(
      { models: { roles: { security: "" } } },
      "security",
    );
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.model, null);
  });

  // Conductor model resolution
  test("resolveConductorModel returns model when present in config", () => {
    const result = resolveConductorModel({ version: 1, models: { conductor: "gpt-5" } });
    assert.equal(result, "gpt-5");
  });

  test("resolveConductorModel returns null when models key is missing", () => {
    const result = resolveConductorModel({ version: 1 });
    assert.equal(result, null);
  });

  test("resolveConductorModel returns null when models.conductor is absent", () => {
    const result = resolveConductorModel({ version: 1, models: { roles: { security: "gpt-5" } } });
    assert.equal(result, null);
  });

  test("resolveConductorModel returns null for empty string", () => {
    const result = resolveConductorModel({ version: 1, models: { conductor: "" } });
    assert.equal(result, null);
  });


  test("resolveConductorModel returns trimmed value for whitespace-padded string", () => {
    const result = resolveConductorModel({ version: 1, models: { conductor: "  gpt-5  " } });
    assert.equal(result, "gpt-5");
  });

  test("resolveConductorModel returns null for whitespace-only string", () => {
    const result = resolveConductorModel({ version: 1, models: { conductor: "   " } });
    assert.equal(result, null);
  });

  test("resolveConductorModel returns null when models is empty object", () => {
    const result = resolveConductorModel({ version: 1, models: {} });
    assert.equal(result, null);
  });
});

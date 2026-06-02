import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";

import {
  DevLoopConfigSchema,
  BUILT_IN_DEFAULTS,
} from "../src/config/schema.mjs";
import { resolveConductorModel, resolveAutonomyStopAt, resolveRefinement, resolveGateAngles } from "../src/config/model-resolution.mjs";
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

  test("L1: both config files missing", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L1-"));
    try {
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.version, 1);
      assert.ok(result.warnings.length > 0, "should warn about missing config");
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

  test("Y1: defaults.yaml loads with YAML comments and parses correctly", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L7-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.yaml"), [
        "version: 1",
        "# This is a comment",
        "strategy:",
        "  default: local-first",
        "gates:",
        "  draft:",
        "    angles:",
        "      - scope",
        "      - coverage",
        "    required: true",
        "personas:",
        "  scope:",
        "    persona: review",
        "    prompt: Check scope",
        "    defaultModel: null",
      ].join("\n"));
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.ok(result.config);
      assert.equal(result.config.strategy.default, "local-first");
      assert.deepEqual(result.config.gates.draft.angles, ["scope", "coverage"]);
      assert.equal(result.config.personas.scope.prompt, "Check scope");
      assert.equal(result.warnings.length, 0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("Y2: YAML preferred over JSON when both exist", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-L8-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(path.join(piDir, "defaults.json"),
        JSON.stringify({ version: 1, strategy: { default: "local-first" } }));
      await writeFile(path.join(piDir, "defaults.yaml"),
        "version: 1\nstrategy:\n  default: github-first");
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.equal(result.config.strategy.default, "github-first", "YAML should take priority over JSON");
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

  test("M7: persona override may omit prompt without failing merged validation", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "devloop-config-M7-"));
    try {
      const piDir = path.join(tmpDir, ".pi", "dev-loop");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        path.join(piDir, "defaults.json"),
        JSON.stringify({
          version: 1,
          personas: {
            dry: { persona: "review", prompt: "Built-in DRY prompt", defaultModel: null },
          },
        }),
      );
      await writeFile(
        path.join(piDir, "overrides.json"),
        JSON.stringify({
          version: 1,
          personas: {
            dry: { persona: "custom-dry-reviewer" },
          },
        }),
      );
      const { loadDevLoopConfig } = await import("../src/config/loader.mjs");
      const result = await loadDevLoopConfig({ repoRoot: tmpDir });
      assert.deepEqual(result.errors, []);
      assert.equal(result.config.personas.dry.persona, "custom-dry-reviewer");
      assert.equal(result.config.personas.dry.prompt, undefined);
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

  // --- Known angles (populated registry) ---

  test("R10: known draft-gate angle resolves to review persona", () => {
    const result = resolveReviewerRole({}, "scope");
    assert.equal(result.persona, "review");
    assert.equal(result.model, null);
    assert.equal(result.fallback, false);
  });

  test("R11: known pre-approval angle resolves to review persona", () => {
    const result = resolveReviewerRole({}, "dry");
    assert.equal(result.persona, "review");
    assert.equal(result.model, null);
    assert.equal(result.fallback, false);
  });

  test("R12: all 12 known angles resolve without fallback", () => {
    for (const angle of ["scope", "coverage", "correctness", "dry", "kiss", "srp", "ocp", "lsp", "isp", "dip", "soc", "yagni"]) {
      const result = resolveReviewerRole({}, angle);
      assert.equal(result.persona, "review", `angle ${angle}`);
      assert.equal(result.fallback, false, `angle ${angle}`);
    }
  });

  test("R13: known angle with model override applies override", () => {
    const result = resolveReviewerRole(
      { models: { roles: { dry: "gpt-5" } } },
      "dry",
    );
    assert.equal(result.persona, "review");
    assert.equal(result.model, "gpt-5");
    assert.equal(result.fallback, false);
  });

  // --- Config-driven persona overrides ---

  test("R14: config personas override built-in persona for same angle", () => {
    const result = resolveReviewerRole(
      { personas: { dry: { persona: "custom-dry-reviewer", defaultModel: null } } },
      "dry",
    );
    assert.equal(result.persona, "custom-dry-reviewer");
    assert.equal(result.fallback, false);
  });

  test("R15: config personas add new angle not in built-in registry", () => {
    const result = resolveReviewerRole(
      { personas: { security: { persona: "security-reviewer", defaultModel: "claude-opus" } } },
      "security",
    );
    assert.equal(result.persona, "security-reviewer");
    assert.equal(result.model, "claude-opus");
    assert.equal(result.fallback, false);
  });

  test("R16: model override in models.roles takes priority over config persona defaultModel", () => {
    const result = resolveReviewerRole(
      {
        personas: { dry: { persona: "review", defaultModel: "gpt-4" } },
        models: { roles: { dry: "gpt-5" } },
      },
      "dry",
    );
    assert.equal(result.persona, "review");
    assert.equal(result.model, "gpt-5");
  });

  test("R17: unknown angle without config personas still falls back to BUILTIN_PERSONAS", () => {
    // Empty personas map — should fall back to built-in for known angles
    const result = resolveReviewerRole(
      { personas: {} },
      "scope",
    );
    assert.equal(result.persona, "review");
    assert.equal(result.fallback, false);
  });

  test("R18: consumer overrides built-in persona and replaces model", () => {
    const result = resolveReviewerRole(
      {
        personas: { correctness: { persona: "my-correctness-agent", defaultModel: "claude-sonnet" } },
      },
      "correctness",
    );
    assert.equal(result.persona, "my-correctness-agent");
    assert.equal(result.model, "claude-sonnet");
    assert.equal(result.fallback, false);
  });

  test("R19: built-in fallback returns null prompt when config personas absent", () => {
    const result = resolveReviewerRole({}, "dry");
    assert.equal(result.persona, "review");
    assert.equal(result.prompt, null, "prompt should be null when config.personas is absent");
    assert.equal(result.fallback, false);
  });

  test("R20: config personas provide prompts; fallback does not duplicate them", () => {
    // Without config: persona resolves, prompt is null (lives in config only)
    const noConfig = resolveReviewerRole({}, "dry");
    assert.equal(noConfig.prompt, null);
    // With config: persona resolves with prompt from config
    const withConfig = resolveReviewerRole(
      { personas: { dry: { persona: "review", prompt: "Check duplication" } } },
      "dry",
    );
    assert.equal(withConfig.prompt, "Check duplication");
    assert.equal(withConfig.fallback, false);
  });

  test("R21: config persona prompt overrides built-in prompt", () => {
    const result = resolveReviewerRole(
      { personas: { dry: { persona: "review", prompt: "Custom DRY prompt for this project" } } },
      "dry",
    );
    assert.equal(result.prompt, "Custom DRY prompt for this project");
    assert.equal(result.fallback, false);
  });

  test("R22: fallback angles return null prompt", () => {
    const result = resolveReviewerRole({}, "unknown-angle");
    assert.equal(result.persona, "default-reviewer");
    assert.equal(result.prompt, null);
    assert.equal(result.fallback, true);
  });

  test("R23: config persona without prompt resolves with null prompt", () => {
    const result = resolveReviewerRole(
      { personas: { dry: { persona: "custom-dry-reviewer" } } },
      "dry",
    );
    assert.equal(result.persona, "custom-dry-reviewer");
    assert.equal(result.prompt, null);
    assert.equal(result.fallback, false);
  });

  describe("model and config resolution", () => {
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

    test("resolveConductorModel returns null for whitespace-only string", () => {
      const result = resolveConductorModel({ version: 1, models: { conductor: "   " } });
      assert.equal(result, null);
    });

    test("resolveConductorModel returns trimmed value for whitespace-padded string", () => {
      const result = resolveConductorModel({ version: 1, models: { conductor: "  gpt-5  " } });
      assert.equal(result, "gpt-5");
    });


    test("resolveConductorModel returns null when models is empty object", () => {
      const result = resolveConductorModel({ version: 1, models: {} });
      assert.equal(result, null);
    });

    // Autonomy stop-at resolution
    test("resolveAutonomyStopAt returns configured gates when present", () => {
      const result = resolveAutonomyStopAt({ version: 1, autonomy: { stopAt: ["draft-pr", "merge"] } });
      assert.deepEqual(result, ["draft-pr", "merge"]);
    });

    test("resolveAutonomyStopAt defaults to ['merge'] when autonomy key is missing", () => {
      const result = resolveAutonomyStopAt({ version: 1 });
      assert.deepEqual(result, ["merge"]);
    });

    test("resolveAutonomyStopAt returns empty array when stopAt is explicitly empty", () => {
      const result = resolveAutonomyStopAt({ version: 1, autonomy: { stopAt: [] } });
      assert.deepEqual(result, []);
    });

    test("resolveAutonomyStopAt returns new array (not reference to config)", () => {
      const config = { version: 1, autonomy: { stopAt: ["merge"] } };
      const result = resolveAutonomyStopAt(config);
      result.push("draft-pr");
      assert.deepEqual(config.autonomy.stopAt, ["merge"]);
    });

    test("resolveAutonomyStopAt returns all four gates when configured", () => {
      const result = resolveAutonomyStopAt({
        version: 1,
        autonomy: { stopAt: ["refinement", "draft-pr", "pre-approval", "merge"] },
      });
      assert.deepEqual(result, ["refinement", "draft-pr", "pre-approval", "merge"]);
    });

    // Refinement resolution
    test("resolveRefinement returns defaults when config is absent", () => {
      const result = resolveRefinement({ version: 1 });
      assert.equal(result.fanOut, 3);
      assert.equal(result.mode, "parallel");
      assert.equal(result.roles, null);
    });

    test("resolveRefinement returns configured values", () => {
      const result = resolveRefinement({
        version: 1,
        refinement: { fanOut: 5, mode: "sequential", roles: ["security", "style"] }
      });
      assert.equal(result.fanOut, 5);
      assert.equal(result.mode, "sequential");
      assert.deepEqual(result.roles, ["security", "style"]);
    });

    test("resolveRefinement returns empty roles array when explicitly empty", () => {
      const result = resolveRefinement({ version: 1, refinement: { fanOut: 2, mode: "parallel", roles: [] } });
      assert.deepEqual(result.roles, []);
    });

    // Gate angles resolution
    test("resolveGateAngles returns null when gates config is absent", () => {
      const result = resolveGateAngles({ version: 1 }, "draft");
      assert.deepEqual(result, null);
    });

    test("resolveGateAngles returns configured draft angles", () => {
      const result = resolveGateAngles({
        version: 1,
        gates: { draft: { angles: ["scope", "coverage"], required: true } }
      }, "draft");
      assert.deepEqual(result, ["scope", "coverage"]);
    });

    test("resolveGateAngles returns configured preApproval angles", () => {
      const result = resolveGateAngles({
        version: 1,
        gates: { preApproval: { angles: ["dry", "kiss"], required: false } }
      }, "preApproval");
      assert.deepEqual(result, ["dry", "kiss"]);
    });

    test("resolveGateAngles returns null for missing gate config", () => {
      const result = resolveGateAngles({
        version: 1,
        gates: { draft: { angles: ["scope"], required: true } }
      }, "preApproval");
      assert.deepEqual(result, null);
    });

    test("resolveGateAngles returns empty array when angles explicitly empty", () => {
      const result = resolveGateAngles({
        version: 1,
        gates: { draft: { angles: [], required: true } }
      }, "draft");
      assert.deepEqual(result, []);
    });

    test("resolveGateAngles returns new array (not reference to config)", () => {
      const config = { version: 1, gates: { draft: { angles: ["scope"] } } };
      const result = resolveGateAngles(config, "draft");
      result.push("coverage");
      assert.deepEqual(config.gates.draft.angles, ["scope"]);
    });

    test("resolveRefinement returns new roles array (not reference to config)", () => {
      const config = { version: 1, refinement: { fanOut: 2, mode: "parallel", roles: ["security"] } };
      const result = resolveRefinement(config);
      result.roles.push("style");
      assert.deepEqual(config.refinement.roles, ["security"]);
    });
  });

});

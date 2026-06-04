import assert from "node:assert/strict";
import test from "node:test";

import { ChangeCategory, resolveDynamicAngles } from "../src/analysis/change-classifier.mjs";

const DRAFT_ANGLES = [
  "scope", "coverage", "correctness", "ci-guard", "contract-surface",
  "input-validation", "determinism", "no-op", "link-check",
  "packaging-runtime", "state-concurrency", "config-drift", "gate-evidence",
];

const PREAPPROVAL_ANGLES = [
  "dry", "kiss", "yagni", "srp", "soc", "deep",
  "docs", "ocp", "lsp", "isp", "dip", "renderer-security",
];

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

test("resolveDynamicAngles: fallbackToAll when ambiguous", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: ["LOGIC_CHANGE"],
    ambiguous: true,
  });
  assert.equal(result.fallbackToAll, true);
  assert.equal(result.recommendedAngles.length, DRAFT_ANGLES.length);
  assert.equal(result.skippedAngles.length, 0);
});

test("resolveDynamicAngles: fallbackToAll when no categories", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [],
  });
  assert.equal(result.fallbackToAll, true);
  assert.equal(result.recommendedAngles.length, DRAFT_ANGLES.length);
});

// ---------------------------------------------------------------------------
// Category-specific
// ---------------------------------------------------------------------------

test("resolveDynamicAngles: rename-only skips structural angles", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.RENAME_ONLY],
  });
  assert.ok(result.recommendedAngles.includes("scope"));
  assert.ok(result.recommendedAngles.includes("contract-surface"));
  assert.ok(result.skippedAngles.includes("config-drift"));
  assert.ok(result.skippedAngles.includes("packaging-runtime"));
  assert.equal(result.fallbackToAll, false);
});

test("resolveDynamicAngles: docs-only skips most angles", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.DOCS_ONLY],
  });
  assert.ok(result.recommendedAngles.includes("docs") || result.recommendedAngles.includes("link-check"));
  assert.ok(result.skippedAngles.includes("coverage"));
  assert.ok(result.skippedAngles.includes("correctness"));
});

test("resolveDynamicAngles: config-only includes config-drift", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.CONFIG_ONLY],
  });
  assert.ok(result.recommendedAngles.includes("config-drift"));
  assert.ok(result.recommendedAngles.includes("scope"));
});

test("resolveDynamicAngles: test-only includes coverage + determinism", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.TEST_ONLY],
  });
  assert.ok(result.recommendedAngles.includes("coverage"));
  assert.ok(result.recommendedAngles.includes("determinism"));
});

test("resolveDynamicAngles: logic change includes many angles", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.LOGIC_CHANGE],
  });
  assert.ok(result.recommendedAngles.includes("correctness"));
  assert.ok(result.recommendedAngles.includes("scope"));
  assert.ok(result.recommendedAngles.length >= 5);
});

// ---------------------------------------------------------------------------
// Always-include
// ---------------------------------------------------------------------------

test("resolveDynamicAngles: gate-evidence always included", () => {
  for (const cat of Object.values(ChangeCategory)) {
    const result = resolveDynamicAngles({
      configuredAngles: DRAFT_ANGLES,
      changeCategories: [cat],
    });
    assert.ok(
      result.recommendedAngles.includes("gate-evidence"),
      `gate-evidence should be included for category ${cat}`,
    );
  }
});

test("resolveDynamicAngles: renderer-security always included", () => {
  const result = resolveDynamicAngles({
    configuredAngles: PREAPPROVAL_ANGLES,
    changeCategories: [ChangeCategory.RENAME_ONLY],
  });
  assert.ok(result.recommendedAngles.includes("renderer-security"));
});

// ---------------------------------------------------------------------------
// Respects configured angles
// ---------------------------------------------------------------------------

test("resolveDynamicAngles: only recommends configured angles", () => {
  const result = resolveDynamicAngles({
    configuredAngles: ["scope", "docs"],
    changeCategories: [ChangeCategory.LOGIC_CHANGE],
  });
  // LOGIC_CHANGE maps to many angles, but only "scope" is configured
  assert.ok(result.recommendedAngles.includes("scope"));
  assert.ok(!result.recommendedAngles.includes("correctness")); // not configured
  assert.ok(!result.skippedAngles.includes("scope"));
});

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

test("resolveDynamicAngles: provides reasons for skipped angles", () => {
  const result = resolveDynamicAngles({
    configuredAngles: DRAFT_ANGLES,
    changeCategories: [ChangeCategory.DOCS_ONLY],
  });
  assert.ok(Object.keys(result.reasons).length > 0);
  assert.equal(typeof result.reasons[result.skippedAngles[0]], "string");
});

import { z } from "zod";

// ============================================================================
// Sub-schemas (no .default() wrappers — defaults handled by BUILT_IN_DEFAULTS)
// ============================================================================

const StrategyConfig = z.strictObject({
  default: z.enum(["local-first", "github-first"]).default("github-first"),
  byWorkflow: z.record(z.string(), z.enum(["local-first", "github-first"])).optional(),
});

const ModelsConfig = z.strictObject({
  conductor: z.string().min(1).optional(),
  roles: z.record(z.string(), z.string().min(1)).optional(),
});

const RefinementConfig = z.strictObject({
  fanOut: z.number().int().min(1).max(10).default(3),
  mode: z.enum(["parallel", "sequential"]).default("parallel"),
  roles: z.array(z.string().min(1)).optional(),
});

const GateConfig = z.strictObject({
  angles: z.array(z.string().min(1)),
  required: z.boolean().default(true),
});

const GatesConfig = z.strictObject({
  draft: GateConfig.optional(),
  preApproval: GateConfig.optional(),
});

const AutonomyConfig = z.strictObject({
  stopAt: z.array(
    z.enum(["refinement", "draft-pr", "pre-approval", "merge"])
  ).default(["merge"]),
});

// ============================================================================
// Full schema — families are optional (BUILT_IN_DEFAULTS provides fallback)
// ============================================================================

/**
 * @typedef {z.infer<typeof DevLoopConfigSchema>} DevLoopConfig
 */

export const DevLoopConfigSchema = z.strictObject({
  version: z.literal(1),
  strategy: StrategyConfig.optional(),
  models: ModelsConfig.optional(),
  refinement: RefinementConfig.optional(),
  gates: GatesConfig.optional(),
  autonomy: AutonomyConfig.optional(),
});

// ============================================================================
// Built-in defaults — frozen canonical fallback
// ============================================================================

export const BUILT_IN_DEFAULTS = Object.freeze({
  version: 1,
  strategy: Object.freeze({ default: "github-first" }),
  models: Object.freeze({}),
  refinement: Object.freeze({ fanOut: 3, mode: "parallel" }),
  gates: Object.freeze({}),
  autonomy: Object.freeze({ stopAt: Object.freeze(["merge"]) }),
});

// ============================================================================
// Validation helpers
// ============================================================================

/**
 * Validate a complete config object. Returns zod SafeParseReturnType.
 * @param {unknown} input
 * @returns {import("zod").SafeParseReturnType<unknown, import("zod").infer<typeof DevLoopConfigSchema>>}
 */
export function validateConfig(input) {
  return DevLoopConfigSchema.safeParse(input);
}

/**
 * Validate a partial config layer (e.g. a single file before merging).
 * All top-level and nested fields are optional, but unknown keys are still rejected.
 * @param {unknown} input
 * @returns {import("zod").SafeParseReturnType<unknown, unknown>}
 */
export function validatePartialConfig(input) {
  const partialSchema = DevLoopConfigSchema.partial().strict();
  return partialSchema.safeParse(input);
}

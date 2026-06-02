import { z } from "zod";

// ============================================================================
// Sub-schemas
//
// No field-level defaults. BUILT_IN_DEFAULTS is the single source of truth
// for all default values. The loader populates missing families from it.
// ============================================================================

const StrategyConfig = z.strictObject({
  default: z.enum(["local-first", "github-first"]),
});

const ModelsConfig = z.strictObject({
  conductor: z.string().trim().min(1).optional(),
  roles: z.record(z.string(), z.string().trim().min(1)).optional(),
});

const RefinementConfig = z.strictObject({
  fanOut: z.number().int().min(1).max(10),
  mode: z.enum(["parallel", "sequential"]),
  roles: z.array(z.string().trim().min(1)).optional(),
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
  ),
});

const PersonaEntry = z.strictObject({
  persona: z.string().min(1),
  // Optional in the merged/full schema so consumer overrides can replace
  // only persona/defaultModel without having to restate the inherited prompt.
  prompt: z.string().min(1).optional().describe("Short focused instruction for the reviewer agent — what to look for and how to judge this angle"),
  defaultModel: z.string().trim().min(1).nullable().default(null),
});

const PersonasConfig = z.record(z.string().min(1), PersonaEntry);

// Partial persona entries for file-level config (allows omitting fields)
const FilePersonasConfig = z.record(z.string().min(1), PersonaEntry.partial());

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
  personas: PersonasConfig.optional(),
});

// ============================================================================
// Built-in defaults — frozen canonical single source of truth
// ============================================================================

export const BUILT_IN_DEFAULTS = Object.freeze({
  version: 1,
  strategy: Object.freeze({ default: "github-first" }),
  models: Object.freeze({}),
  refinement: Object.freeze({ fanOut: 3, mode: "parallel" }),
  gates: Object.freeze({}),
  autonomy: Object.freeze({ stopAt: Object.freeze(["merge"]) }),
  personas: Object.freeze({}),
});

// ============================================================================
// File-level validation schema — allows partial family objects
// ============================================================================

export const FileConfigSchema = z.strictObject({
  version: z.literal(1),
  strategy: StrategyConfig.partial().optional(),
  models: ModelsConfig.partial().optional(),
  refinement: RefinementConfig.partial().optional(),
  gates: GatesConfig.partial().optional(),
  autonomy: AutonomyConfig.partial().optional(),
  personas: FilePersonasConfig.optional(),
});

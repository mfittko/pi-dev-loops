import { z } from "zod";

// ============================================================================
// Sub-schemas
//
// BUILT_IN_DEFAULTS remains the canonical shipped default surface for loader
// fallbacks. Select field-level defaults may still exist where merged-schema
// callers need a stable value even when they construct config objects directly.
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
  maxCopilotRounds: z.number().int().positive().default(5),
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

const WorkflowConfig = z.strictObject({
  requireRetrospective: z.boolean(),
  requireDraftFirst: z.boolean(),
  devModeDefault: z.boolean(),
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
  workflow: WorkflowConfig.optional(),
  personas: PersonasConfig.optional(),
});

// ============================================================================
// Built-in defaults — frozen canonical single source of truth
// ============================================================================

export const BUILT_IN_DEFAULTS = Object.freeze({
  version: 1,
  strategy: Object.freeze({ default: "github-first" }),
  models: Object.freeze({}),
  refinement: Object.freeze({ fanOut: 3, mode: "parallel", maxCopilotRounds: 5 }),
  gates: Object.freeze({}),
  autonomy: Object.freeze({ stopAt: Object.freeze(["merge"]) }),
  workflow: Object.freeze({
    requireRetrospective: false,
    requireDraftFirst: false,
    devModeDefault: false,
  }),
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
  workflow: WorkflowConfig.partial().optional(),
  personas: FilePersonasConfig.optional(),
});

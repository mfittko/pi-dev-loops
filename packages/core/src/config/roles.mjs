// ============================================================================
// Built-in persona registry
// ============================================================================

const BUILTIN_PERSONAS = Object.freeze({
  security: Object.freeze({ persona: "security-reviewer", defaultModel: null }),
  style: Object.freeze({ persona: "style-reviewer", defaultModel: null }),
  correctness: Object.freeze({ persona: "correctness-reviewer", defaultModel: null }),
  dry: Object.freeze({ persona: "dry-reviewer", defaultModel: null }),
  kiss: Object.freeze({ persona: "kiss-reviewer", defaultModel: null }),
  yagni: Object.freeze({ persona: "yagni-reviewer", defaultModel: null }),
});

const DEFAULT_REVIEWER_PERSONA = "default-reviewer";

// ============================================================================
// Role resolution
// ============================================================================

/**
 * @typedef {object} RoleResolutionResult
 * @property {string} persona - Agent persona name to use
 * @property {string|null} model - Effective model (null = use persona default)
 * @property {boolean} fallback - True when no specialized persona was found
 */

/**
 * Resolve a gate angle name to a reviewer persona and model.
 *
 * Resolution order:
 * 1. Look up angle in built-in persona registry
 * 2. If found, apply model override from config.models.roles[angle] if present
 * 3. If not found, fall back to default reviewer with angle as focus lens,
 *    still applying any model override from config
 *
 * @param {object} config - DevLoopConfig (or partial with models.roles)
 * @param {string|null|undefined} angle - Gate angle / lens name
 * @returns {RoleResolutionResult}
 */
export function resolveReviewerRole(config, angle) {
  // Null/undefined/empty angle → fallback
  if (angle == null || angle === "") {
    return {
      persona: DEFAULT_REVIEWER_PERSONA,
      model: null,
      fallback: true,
    };
  }

  const persona = BUILTIN_PERSONAS[angle] ?? null;
  const modelOverride = config?.models?.roles?.[angle] || null;
  const effectiveModel = modelOverride || persona?.defaultModel || null;

  if (persona) {
    return {
      persona: persona.persona,
      model: effectiveModel,
      fallback: false,
    };
  }

  // Unknown angle — fall back to default reviewer, but still apply model override
  return {
    persona: DEFAULT_REVIEWER_PERSONA,
    model: effectiveModel,
    fallback: true,
  };
}

/**
 * Expose the built-in persona registry for inspection.
 * @returns {Readonly<Record<string, { persona: string, defaultModel: string|null }>>}
 */
export function listBuiltinPersonas() {
  return BUILTIN_PERSONAS;
}

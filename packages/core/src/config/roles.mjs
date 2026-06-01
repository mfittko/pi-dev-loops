// ============================================================================
// Built-in persona registry
//
// Initially empty. Add entries as dedicated reviewer agent personas are
// created. The resolution algorithm handles unknown angles by falling
// back to the default reviewer with the angle as a focus lens.
// ============================================================================

const BUILTIN_PERSONAS = Object.freeze({});

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

  if (persona) {
    return {
      persona: persona.persona,
      model: modelOverride || persona.defaultModel || null,
      fallback: false,
    };
  }

  // Unknown angle — fall back to default reviewer, but still apply model override
  return {
    persona: DEFAULT_REVIEWER_PERSONA,
    model: modelOverride || null,
    fallback: true,
  };
}

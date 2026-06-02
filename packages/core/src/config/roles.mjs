// ============================================================================
// Built-in persona registry — fallback when config.personas is absent
//
// Maps gate-review angle names to reviewer personas. Each entry defines:
//   persona       — agent persona name (must exist in .pi/agents/)
//   prompt        — focused instruction for the reviewer agent
//   defaultModel  — optional model override (null = use persona default)
//
// Consumers can extend or override these by adding personas entries to
// their .pi/dev-loop/defaults.json or overrides.json. Config-resolved
// personas take priority over this built-in registry.
//
// Angle names come from the gate-angle config (gates.draft.angles /
// gates.preApproval.angles in .pi/dev-loop/defaults.json).
// ============================================================================

const BUILTIN_PERSONAS = Object.freeze({
  scope:       { persona: "review", prompt: "Check whether every changed file belongs in this PR. Flag unrelated or out-of-scope changes. The PR description's scope section is the contract.", defaultModel: null },
  coverage:    { persona: "review", prompt: "Check whether tests cover the changed behavior adequately. Look for missing edge cases, untested error paths, and acceptance-criteria gaps.", defaultModel: null },
  correctness: { persona: "review", prompt: "Check whether the implementation matches the acceptance criteria and PR description. Flag logic errors, contract violations, and behavior mismatches.", defaultModel: null },
  dry:         { persona: "review", prompt: "Flag duplicated logic, repeated patterns, and copy-pasted code. Prefer one canonical path. Check for restated policies across docs and skills.", defaultModel: null },
  kiss:        { persona: "review", prompt: "Flag over-engineering and unnecessary complexity. Prefer simple solutions. Question extra layers, abstractions, and indirection that don't earn their keep.", defaultModel: null },
  yagni:       { persona: "review", prompt: "Flag speculative features, future-proofing, and compatibility shims not required by the current acceptance criteria. YAGNI = You Aren't Gonna Need It.", defaultModel: null },
});

const DEFAULT_REVIEWER_PERSONA = "default-reviewer";

// ============================================================================
// Role resolution
// ============================================================================

/**
 * @typedef {object} RoleResolutionResult
 * @property {string} persona - Agent persona name to use
 * @property {string|null} model - Effective model (null = use persona default)
 * @property {string|null} prompt - Focused review instruction for this angle (null when fallback)
 * @property {boolean} fallback - True when no specialized persona was found
 */

/**
 * Resolve a gate angle name to a reviewer persona and model.
 *
 * Resolution order:
 * 1. Look up angle in config.personas[angle] (consumer overrides)
 * 2. If not found in config, look up in BUILTIN_PERSONAS
 * 3. If found in either, apply model override from config.models.roles[angle] if present
 * 4. If not found anywhere, fall back to default reviewer with angle as focus lens,
 *    still applying any model override from config
 *
 * @param {object} config - DevLoopConfig (or partial with personas, models.roles)
 * @param {string|null|undefined} angle - Gate angle / lens name
 * @returns {RoleResolutionResult}
 */
export function resolveReviewerRole(config, angle) {
  // Null/undefined/empty angle → fallback
  if (angle == null || angle === "") {
    return {
      persona: DEFAULT_REVIEWER_PERSONA,
      model: null,
      prompt: null,
      fallback: true,
    };
  }

  // Resolution: config.personas > BUILTIN_PERSONAS > default-reviewer
  const configPersona = config?.personas?.[angle] ?? null;
  const builtinPersona = BUILTIN_PERSONAS[angle] ?? null;
  const persona = configPersona ?? builtinPersona;
  const modelOverride = config?.models?.roles?.[angle] || null;

  if (persona) {
    return {
      persona: persona.persona,
      model: modelOverride || persona.defaultModel || null,
      prompt: persona.prompt || null,
      fallback: false,
    };
  }

  // Unknown angle — fall back to default reviewer, but still apply model override
  return {
    persona: DEFAULT_REVIEWER_PERSONA,
    model: modelOverride || null,
    prompt: null,
    fallback: true,
  };
}

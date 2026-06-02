import { BUILT_IN_DEFAULTS } from "./schema.mjs";

/**
 * Resolve the conductor model from the merged dev-loop config.
 *
 * Returns the configured model string if present, or null when the config
 * does not specify a conductor model override (caller falls back to its
 * own built-in default).
 *
 * Accepts the validated DevLoopConfig from {@link loadDevLoopConfig}.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @returns {string|null}
 */
export function resolveConductorModel(config) {
  const raw = config?.models?.conductor;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

/**
 * Resolve the autonomy stop-at list from the merged dev-loop config.
 *
 * Returns the set of gates that require operator confirmation. Gates not in
 * the returned list may proceed automatically once their review conditions
 * are satisfied.
 *
 * Defaults to `["merge"]` when the config does not specify `autonomy.stopAt`
 * (the conservative built-in posture: everything auto-continues until merge).
 *
 * Accepts the validated DevLoopConfig from {@link loadDevLoopConfig}.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @returns {string[]}
 */
export function resolveAutonomyStopAt(config) {
  if (config?.autonomy?.stopAt && Array.isArray(config.autonomy.stopAt)) {
    return [...config.autonomy.stopAt];
  }
  return ["merge"];
}

const DEFAULT_REFINEMENT_CONFIG = BUILT_IN_DEFAULTS.refinement;
const DEFAULT_WORKFLOW_CONFIG = BUILT_IN_DEFAULTS.workflow;

/**
 * Resolve one refinement configuration value from the merged dev-loop config.
 *
 * Returns the configured value when present, or the built-in default for the
 * requested key.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @param {"fanOut"|"mode"|"roles"|"maxCopilotRounds"} key
 * @returns {number|"parallel"|"sequential"|string[]|null}
 */
export function resolveRefinementConfig(config, key) {
  if (key === "roles") {
    return config?.refinement?.roles && Array.isArray(config.refinement.roles)
      ? [...config.refinement.roles]
      : null;
  }

  if (key === "fanOut") {
    return config?.refinement?.fanOut ?? DEFAULT_REFINEMENT_CONFIG.fanOut;
  }

  if (key === "mode") {
    return config?.refinement?.mode ?? DEFAULT_REFINEMENT_CONFIG.mode;
  }

  if (key === "maxCopilotRounds") {
    return config?.refinement?.maxCopilotRounds ?? DEFAULT_REFINEMENT_CONFIG.maxCopilotRounds;
  }

  throw new Error(`Unknown refinement config key: ${key}`);
}

/**
 * Resolve the refinement configuration from the merged dev-loop config.
 *
 * Returns `{ fanOut, mode, roles, maxCopilotRounds }` with sensible built-in
 * defaults (`fanOut: 3`, `mode: "parallel"`, `roles: null`,
 * `maxCopilotRounds: 5`).
 *
 * Accepts the validated DevLoopConfig from {@link loadDevLoopConfig}.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @returns {{ fanOut: number, mode: "parallel"|"sequential", roles: string[]|null, maxCopilotRounds: number }}
 */
export function resolveRefinement(config) {
  const fanOut = /** @type {number} */ (resolveRefinementConfig(config, "fanOut"));
  const mode = /** @type {"parallel"|"sequential"} */ (resolveRefinementConfig(config, "mode"));
  const roles = /** @type {string[]|null} */ (resolveRefinementConfig(config, "roles"));
  const maxCopilotRounds = /** @type {number} */ (resolveRefinementConfig(config, "maxCopilotRounds"));
  return { fanOut, mode, roles, maxCopilotRounds };
}

/**
 * Resolve one gate configuration object from the merged dev-loop config.
 *
 * Returns the configured gate angles when present, or null for angles when the
 * config omits them (caller falls back to skill-defined defaults). Boolean gate
 * flags always resolve to stable defaults.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @param {"draft"|"preApproval"} gate
 * @returns {{ angles: string[]|null, required: boolean, requireCi: boolean }}
 */
export function resolveGateConfig(config, gate) {
  const gateConfig = config?.gates?.[gate];
  return {
    angles: gateConfig?.angles && Array.isArray(gateConfig.angles)
      ? [...gateConfig.angles]
      : null,
    required: gateConfig?.required ?? true,
    requireCi: gateConfig?.requireCi ?? true,
  };
}

/**
 * Resolve review angles for a specific gate from the merged dev-loop config.
 *
 * Returns the configured angle names for the given gate, or null when the
 * config does not specify angles for that gate (caller falls back to its
 * skill-defined defaults).
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @param {"draft"|"preApproval"} gate
 * @returns {string[]|null}
 */
export function resolveGateAngles(config, gate) {
  return resolveGateConfig(config, gate).angles;
}

/**
 * Resolve one workflow configuration value from the merged dev-loop config.
 *
 * Returns the configured boolean when present, or the built-in default for the
 * requested key.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @param {"requireRetrospective"|"requireDraftFirst"|"devModeDefault"} key
 * @returns {boolean}
 */
export function resolveWorkflowConfig(config, key) {
  if (key === "requireRetrospective") {
    return config?.workflow?.requireRetrospective ?? DEFAULT_WORKFLOW_CONFIG.requireRetrospective;
  }

  if (key === "requireDraftFirst") {
    return config?.workflow?.requireDraftFirst ?? DEFAULT_WORKFLOW_CONFIG.requireDraftFirst;
  }

  if (key === "devModeDefault") {
    return config?.workflow?.devModeDefault ?? DEFAULT_WORKFLOW_CONFIG.devModeDefault;
  }

  throw new Error(`Unknown workflow config key: ${key}`);
}

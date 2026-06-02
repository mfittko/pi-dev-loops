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

/**
 * Resolve the refinement configuration from the merged dev-loop config.
 *
 * Returns `{ fanOut, mode, roles }` with sensible built-in defaults
 * (`fanOut: 3`, `mode: "parallel"`, `roles: null`).
 *
 * Accepts the validated DevLoopConfig from {@link loadDevLoopConfig}.
 *
 * @param {import("./schema.mjs").DevLoopConfig} config
 * @returns {{ fanOut: number, mode: "parallel"|"sequential", roles: string[]|null }}
 */
export function resolveRefinement(config) {
  const fanOut = config?.refinement?.fanOut ?? 3;
  const mode = config?.refinement?.mode ?? "parallel";
  const roles = config?.refinement?.roles && Array.isArray(config.refinement.roles)
    ? [...config.refinement.roles]
    : null;
  return { fanOut, mode, roles };
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
  const gateConfig = config?.gates?.[gate];
  if (gateConfig?.angles && Array.isArray(gateConfig.angles)) {
    return [...gateConfig.angles];
  }
  return null;
}

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
  if (config?.autonomy?.stopAt && Array.isArray(config.autonomy.stopAt) && config.autonomy.stopAt.length > 0) {
    return [...config.autonomy.stopAt];
  }
  return ["merge"];
}

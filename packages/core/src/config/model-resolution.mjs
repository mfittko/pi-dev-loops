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
  const model = config?.models?.conductor;
  if (typeof model === "string" && model.length > 0) {
    return model;
  }
  return null;
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUILT_IN_DEFAULTS, validateConfig, validatePartialConfig } from "./schema.mjs";

// ============================================================================
// Error types
// ============================================================================

/**
 * @typedef {object} ConfigLoadError
 * @property {string} path - Human-readable file path or layer name
 * @property {string} message - Error description
 * @property {"defaults"|"overrides"} layer - Which config layer failed
 */

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shallow-merge two objects. Keys in `source` override keys in `target`.
 * Nested objects are replaced wholesale, not deep-merged.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
function shallowMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      key !== "version" &&
      typeof source[key] === "object" &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      // Shallow-merge nested objects (strategy, models, refinement, gates, autonomy)
      result[key] = { ...(result[key] || {}), ...(source[key] || {}) };
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Try to read and parse a JSON file.
 * Returns the parsed object or null if the file doesn't exist.
 * Throws on read errors other than ENOENT.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    // EACCES, EISDIR, etc. — rethrow as a structured error
    throw Object.assign(
      new Error(`Cannot read config file: ${err.message}`),
      { code: err.code, path: filePath },
    );
  }

  if (raw.trim() === "") {
    throw Object.assign(
      new Error("Config file is empty"),
      { code: "EMPTY_FILE", path: filePath },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw Object.assign(
      new Error(`Invalid JSON in config file: ${err.message}`),
      { code: "INVALID_JSON", path: filePath },
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(
      new Error("Config file must be a JSON object"),
      { code: "NOT_AN_OBJECT", path: filePath },
    );
  }

  return parsed;
}

// ============================================================================
// Loader
// ============================================================================

/**
 * @typedef {object} LoadResult
 * @property {import("zod").infer<import("./schema.mjs").DevLoopConfigSchema>} config
 * @property {string[]} warnings
 * @property {ConfigLoadError[]} errors
 */

/**
 * @typedef {object} LoadOptions
 * @property {string} [repoRoot] - Path to repository root (default: process.cwd())
 */

/**
 * Load the dev-loop configuration with full precedence:
 *   overrides.json > defaults.json > built-in defaults
 *
 * Never throws for config-related problems.
 * Returns built-in defaults even when all files are missing or broken.
 *
 * @param {LoadOptions} [options]
 * @returns {Promise<LoadResult>}
 */
export async function loadDevLoopConfig(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const configDir = path.join(repoRoot, ".pi", "dev-loop");
  const defaultsPath = path.join(configDir, "defaults.json");
  const overridesPath = path.join(configDir, "overrides.json");

  /** @type {string[]} */
  const warnings = [];
  /** @type {ConfigLoadError[]} */
  const errors = [];

  // Start with built-in defaults
  let merged = { ...BUILT_IN_DEFAULTS };

  // Layer 1: repo defaults
  let repoDefaults = null;
  try {
    repoDefaults = await readJsonFile(defaultsPath);
  } catch (err) {
    errors.push({
      path: defaultsPath,
      message: err.message,
      layer: "defaults",
    });
  }

  if (repoDefaults === null && errors.length === 0) {
    // File doesn't exist — warn because defaults.json should be committed
    warnings.push("Committed defaults.json not found, using built-in defaults");
  }

  if (repoDefaults !== null) {
    const validation = validatePartialConfig(repoDefaults);
    if (validation.success) {
      // Merge raw data (not zod-filled) so inner defaults don't overwrite lower layers
      merged = shallowMerge(merged, repoDefaults);
    } else {
      errors.push({
        path: defaultsPath,
        message: `Schema validation failed: ${validation.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        layer: "defaults",
      });
    }
  }

  // Layer 2: session overrides
  let sessionOverrides = null;
  try {
    sessionOverrides = await readJsonFile(overridesPath);
  } catch (err) {
    errors.push({
      path: overridesPath,
      message: err.message,
      layer: "overrides",
    });
  }

  if (sessionOverrides !== null) {
    const validation = validatePartialConfig(sessionOverrides);
    if (validation.success) {
      // Merge raw data (not zod-filled) so inner defaults don't overwrite lower layers
      merged = shallowMerge(merged, sessionOverrides);
    } else {
      errors.push({
        path: overridesPath,
        message: `Schema validation failed: ${validation.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        layer: "overrides",
      });
    }
  }

  // Final validation of merged config (defensive — should never fail if layers were valid)
  const finalCheck = validateConfig(merged);
  if (!finalCheck.success) {
    // This shouldn't happen if layers validated individually, but catch it defensively
    errors.push({
      path: "<merged>",
      message: `Merged config validation failed: ${finalCheck.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      layer: "defaults",
    });
    return { config: { ...BUILT_IN_DEFAULTS }, warnings, errors };
  }

  return { config: finalCheck.data, warnings, errors };
}

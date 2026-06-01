import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUILT_IN_DEFAULTS, DevLoopConfigSchema, FileConfigSchema } from "./schema.mjs";

// ============================================================================
// Error types
// ============================================================================

/**
 * @typedef {object} ConfigLoadError
 * @property {string} path - Human-readable file path or layer name
 * @property {string} message - Error description
 * @property {"defaults"|"overrides"|"merged"} layer - Which config layer failed
 */

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shallow-merge two config objects. Keys in `source` override keys in `target`.
 * Nested family objects are merged at one level, not deep-merged.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
function mergeConfigLayers(target, source) {
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
    throw configError(`Cannot read config file: ${err.message}`, err.code, filePath);
  }

  if (raw.trim() === "") {
    throw configError("Config file is empty", "EMPTY_FILE", filePath);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw configError(`Invalid JSON in config file: ${err.message}`, "INVALID_JSON", filePath);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configError("Config file must be a JSON object", "NOT_AN_OBJECT", filePath);
  }

  return parsed;
}

/**
 * @param {string} message
 * @param {string} code
 * @param {string} filePath
 * @returns {Error & { code: string, path: string }}
 */
function configError(message, code, filePath) {
  return Object.assign(new Error(message), { code, path: filePath });
}

/**
 * Try to load and merge one config layer (defaults or overrides).
 * @param {Record<string, unknown>} merged - Current merged config
 * @param {string} filePath - Path to the config file
 * @param {"defaults"|"overrides"} layer - Layer name
 * @param {string[]} warnings
 * @param {ConfigLoadError[]} errors
 * @param {{ warnOnMissing?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function applyLayer(merged, filePath, layer, warnings, errors, options = {}) {
  let data = null;
  try {
    data = await readJsonFile(filePath);
  } catch (err) {
    errors.push({ path: filePath, message: err.message, layer });
    return merged;
  }

  if (data === null) {
    if (options.warnOnMissing) {
      warnings.push(`Committed ${layer}.json not found, using built-in defaults`);
    }
    return merged;
  }

  // Validate the file's structure before merging
  const validation = FileConfigSchema.safeParse(data);
  if (!validation.success) {
    errors.push({
      path: filePath,
      message: `Schema validation failed: ${validation.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      layer,
    });
    return merged;
  }

  return mergeConfigLayers(merged, data);
}

// ============================================================================
// Loader
// ============================================================================

/**
 * @typedef {object} LoadResult
 * @property {import("./schema.mjs").DevLoopConfig} config
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

  let merged = { ...BUILT_IN_DEFAULTS };

  merged = await applyLayer(merged, defaultsPath, "defaults", warnings, errors, {
    warnOnMissing: true,
  });

  merged = await applyLayer(merged, overridesPath, "overrides", warnings, errors);

  // Validate final merged config
  const result = DevLoopConfigSchema.safeParse(merged);
  if (!result.success) {
    errors.push({
      path: "<merged>",
      message: `Config validation failed: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      layer: "merged",
    });
    // Return merged as-is — caller gets validation errors but still has config with all layers applied
    return { config: /** @type {*} */ (merged), warnings, errors };
  }

  return { config: result.data, warnings, errors };
}

// ============================================================================
// Debt signal clustering logic
//
// Groups debt_signal objects into debt_finding clusters.
//
// Clustering rules:
//   - file: signals share the same location.filePath
//   - module: signals share the same parent directory of filePath (or signalKind
//     as fallback when no filePath)
//   - theme: signals share the same signalKind category
//   - Precedence: file > module > theme
//   - A signal belongs to exactly one cluster.
//   - Signals with no file, module, or theme form singleton clusters.
//
// Output: array of debt_finding objects with embedded signal references,
// signalIds, and aggregated score.
// ============================================================================

import { randomUUID } from "node:crypto";
import { scoreCluster } from "./score.mjs";

/**
 * Extract the file key from a signal: location.filePath, or undefined.
 * @param {object} signal
 * @returns {string|undefined}
 */
function fileKey(signal) {
  return signal.location?.filePath || undefined;
}

/**
 * Extract the module key from a signal:
 * parent directory of filePath (dirname), or signalKind as fallback.
 * @param {object} signal
 * @returns {string|undefined}
 */
function moduleKey(signal) {
  const fp = signal.location?.filePath;
  if (fp) {
    const lastSlash = fp.lastIndexOf("/");
    if (lastSlash >= 0) return fp.slice(0, lastSlash);
    return fp; // no directory separator — treat as its own module
  }
  // Fallback: use signalKind as module
  return signal.signalKind || undefined;
}

/**
 * Extract the theme key from a signal: signalKind category.
 * @param {object} signal
 * @returns {string|undefined}
 */
function themeKey(signal) {
  return signal.signalKind || undefined;
}

/**
 * Group signals by a key extraction function.
 * Returns Map<key, signal[]> where key may be undefined for signals lacking that dimension.
 *
 * @param {Array<object>} signals
 * @param {(signal: object) => string|undefined} keyFn
 * @returns {Map<string|undefined, Array<object>>}
 */
function groupByKey(signals, keyFn) {
  const map = new Map();
  for (const signal of signals) {
    const key = keyFn(signal);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(signal);
  }
  return map;
}

/**
 * Create a debt_finding from a cluster of signals.
 *
 * @param {Array<object>} signals — debt_signal-compatible objects
 * @param {string} clusterReason — "file", "module", "theme", or "singleton"
 * @returns {object} debt_finding shape
 */
function buildFinding(signals, clusterReason) {
  const now = new Date().toISOString();
  const score = scoreCluster(signals);

  // Build title from cluster reason + primary category
  const categories = [...new Set(signals.map(s => s.signalKind).filter(Boolean))];
  const primaryCategory = categories[0] || "unknown";

  // Build location summary
  const filePaths = [...new Set(
    signals.map(s => s.location?.filePath).filter(Boolean)
  )];

  const title = filePaths.length === 1
    ? `${clusterReason}: ${primaryCategory} in ${filePaths[0]}`
    : `${clusterReason}: ${primaryCategory} (${signals.length} signals)`;

  const description = `Clustered by ${clusterReason}. ` +
    `Categories: ${categories.join(", ")}. ` +
    `Files: ${filePaths.length > 0 ? filePaths.join(", ") : "none"}.`;

  return {
    id: randomUUID(),
    signalIds: signals.map(s => s.id),
    validationStatus: "pending",
    score,
    remediationShape: "watch_only", // placeholder; shaped later
    title: title.slice(0, 200),
    description: description.slice(0, 500),
    locationSummary: filePaths.length > 0
      ? { filePaths, primaryFilePath: filePaths[0] }
      : undefined,
    createdAt: now,
    updatedAt: now,
    // Internal fields for shaping (not in the schema output)
    _clusterReason: clusterReason,
    _signalCount: signals.length,
  };
}

/**
 * Cluster debt_signal objects into debt_finding arrays.
 *
 * Multi-pass algorithm:
 *   1. Group by file (location.filePath exact match)
 *   2. From remaining, group by module (directory of filePath, or signalKind)
 *   3. From remaining, group by theme (signalKind)
 *   4. Remaining → singleton clusters
 *
 * Each signal appears in exactly one cluster.
 * Clusters with only one signal when grouped by a dimension
 * are deferred to the next pass (no singleton clusters when a shared key exists
 * for multiple signals at that pass).
 *
 * @param {Array<object>} signals — array of debt_signal-compatible objects
 * @returns {Array<object>} array of debt_finding shapes (minus internal fields)
 */
export function clusterSignals(signals) {
  if (!Array.isArray(signals)) return [];
  if (signals.length === 0) return [];

  const findings = [];
  let remaining = [...signals];

  // Pass 1: file
  const fileGroups = groupByKey(remaining, fileKey);
  remaining = [];
  for (const [key, group] of fileGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "file"));
    }
  }

  // Pass 2: module
  const moduleGroups = groupByKey(remaining, moduleKey);
  remaining = [];
  for (const [key, group] of moduleGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "module"));
    }
  }

  // Pass 3: theme
  const themeGroups = groupByKey(remaining, themeKey);
  remaining = [];
  for (const [key, group] of themeGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "theme"));
    }
  }

  // Pass 4: singletons for any remaining
  for (const signal of remaining) {
    findings.push(buildFinding([signal], "singleton"));
  }

  // Strip internal fields before returning
  return findings.map(f => {
    const { _clusterReason, _signalCount, ...clean } = f;
    return clean;
  });
}

/**
 * Cluster signals and return findings enriched with internal metadata
 * for shaping.
 *
 * @param {Array<object>} signals — array of debt_signal-compatible objects
 * @returns {Array<object>} array of debt_finding shapes with _clusterReason and _signalCount
 */
export function clusterSignalsEnriched(signals) {
  if (!Array.isArray(signals)) return [];
  if (signals.length === 0) return [];

  const findings = [];
  let remaining = [...signals];

  const fileGroups = groupByKey(remaining, fileKey);
  remaining = [];
  for (const [key, group] of fileGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "file"));
    }
  }

  const moduleGroups = groupByKey(remaining, moduleKey);
  remaining = [];
  for (const [key, group] of moduleGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "module"));
    }
  }

  const themeGroups = groupByKey(remaining, themeKey);
  remaining = [];
  for (const [key, group] of themeGroups) {
    if (key === undefined || group.length <= 1) {
      remaining.push(...group);
    } else {
      findings.push(buildFinding(group, "theme"));
    }
  }

  for (const signal of remaining) {
    findings.push(buildFinding([signal], "singleton"));
  }

  return findings;
}

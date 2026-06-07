/**
 * Parallel execution helper for queue mode.
 *
 * When --parallel is set:
 *   1. Compute file-touch overlap matrix for all queued items
 *   2. Items with no overlap → dispatch in parallel (up to concurrency cap)
 *   3. Items with overlapping files → serialize within overlap groups
 *   4. Dependency chains (--after) → always serialize within chain
 */

import { topologicalOrder } from "./queue-state.mjs";

/**
 * Compute overlap groups from a set of entries and their file lists.
 *
 * @param {Array<{target: number, files: string[]}>} entryFiles
 * @returns {Array<Array<number>>} Array of groups (each group is serialized internally)
 */
export function computeOverlapGroups(entryFiles) {
  const n = entryFiles.length;
  if (n === 0) return [];

  // Build overlap matrix
  const overlap = Array.from({ length: n }, () => Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const filesI = new Set(entryFiles[i].files);
      const filesJ = entryFiles[j].files;
      const hasOverlap = filesJ.some((f) => filesI.has(f));
      overlap[i][j] = hasOverlap;
      overlap[j][i] = hasOverlap;
    }
  }

  // Union-find to group overlapping entries
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlap[i][j]) union(i, j);
    }
  }

  // Collect groups preserving original order
  const groups = new Map();
  const groupOrder = [];
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
      groupOrder.push(root);
    }
    groups.get(root).push(entryFiles[i].target);
  }

  return groupOrder.map((root) => groups.get(root));
}

/**
 * Given overlap groups, compute which groups can run in parallel.
 * Returns an array of "waves" where each wave contains groups that can run concurrently.
 *
 * @param {Array<Array<number>>} groups
 * @param {number} maxParallel - Concurrency cap
 * @returns {Array<Array<Array<number>>>} Array of waves
 */
export function scheduleParallelWaves(groups, maxParallel = 3) {
  if (groups.length === 0) return [];

  const waves = [];
  let i = 0;

  while (i < groups.length) {
    const wave = [];
    while (wave.length < maxParallel && i < groups.length) {
      wave.push(groups[i]);
      i++;
    }
    waves.push(wave);
  }

  return waves;
}

/**
 * Compute the full parallel schedule for a queue.
 *
 * @param {Array<{target: number, files: string[], dependsOn: number[]}>} entries
 * @param {number} maxParallel
 * @returns {{waves: Array<Array<Array<number>>>, groups: Array<Array<number>>}}
 */
export function computeParallelSchedule(entries, maxParallel = 3) {
  // First, topological sort for dependency ordering
  const ordered = topologicalOrder(
    entries.map((e) => ({
      target: e.target,
      dependsOn: e.dependsOn,
    }))
  );

  // Map back to full entries in topological order
  const orderedEntries = ordered.map((o) =>
    entries.find((e) => e.target === o.target)
  ).filter(Boolean);

  // For dependency chains, ensure they're in same group
  const depChains = new Map();
  for (const entry of orderedEntries) {
    for (const dep of entry.dependsOn || []) {
      depChains.set(entry.target, dep);
    }
  }

  // Compute file overlap groups
  const entryFiles = orderedEntries.map((e) => ({
    target: e.target,
    files: e.files || [],
    dependsOn: e.dependsOn || [],
  }));

  // Merge dependency chains into overlap groups
  const groups = computeOverlapGroups(entryFiles);

  // Expand groups to include dependency chains
  const expandedGroups = groups.map((group) => {
    const expanded = new Set(group);
    for (const target of group) {
      let chainTarget = depChains.get(target);
      while (chainTarget != null) {
        expanded.add(chainTarget);
        chainTarget = depChains.get(chainTarget);
      }
    }
    return [...expanded];
  });

  const waves = scheduleParallelWaves(expandedGroups, maxParallel);

  return { waves, groups: expandedGroups };
}

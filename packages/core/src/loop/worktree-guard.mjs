/**
 * Shared worktree and subagent guard primitives.
 *
 * Extracted from `scripts/loop/pre-commit-branch-guard.mjs` so that both the
 * pre-commit guard and the new pre-flight gate share one implementation.
 *
 * This module is intentionally pure and side-effect free.
 */

// ---------------------------------------------------------------------------
// Worktree path helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `cwd` is under a tmp/worktrees path segment.
 *
 * @param {string} cwd - Absolute or relative path to the current working directory.
 * @returns {boolean}
 */
export function isUnderWorktreePath(cwd) {
  const normalized = cwd.replace(/\\/g, "/");
  return /(?:^|\/)tmp\/worktrees(?:\/|$)/.test(normalized);
}

/**
 * Parse the main (primary) git worktree path from `git worktree list` output.
 *
 * The first line of `git worktree list` is the primary worktree.
 * Format: `<path>  <sha> [<branch>]`
 *
 * @param {string} worktreeListOutput - Raw stdout from `git worktree list`.
 * @returns {string | null} The main worktree path, or null if it cannot be parsed.
 */
export function parseMainWorktreePath(worktreeListOutput) {
  const firstLine = worktreeListOutput.split("\n")[0].trim();
  if (!firstLine) return null;
  // Find the last hex SHA (7+ chars) in the line and take everything before it as the path.
  const shaIdx = firstLine.search(/\s[0-9a-f]{7,64}\b/iu);
  if (shaIdx === -1) return null;
  return firstLine.slice(0, shaIdx).trim();
}

/**
 * Check whether `cwd` is the main git checkout (or a subdirectory of it).
 *
 * @param {string} cwd - Absolute or relative path to the current working directory.
 * @param {string | null} mainWorktreePath - The main worktree path from `parseMainWorktreePath`.
 * @returns {boolean}
 */
export function isMainCheckout(cwd, mainWorktreePath) {
  if (!mainWorktreePath) return false;
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/u, "");
  const normalizedMain = mainWorktreePath.replace(/\\/g, "/").replace(/\/+$/u, "");
  return normalizedCwd === normalizedMain || normalizedCwd.startsWith(normalizedMain + "/");
}

// ---------------------------------------------------------------------------
// Subagent availability
// ---------------------------------------------------------------------------

/**
 * Environment variable name checked by `detectSubagentAvailability`.
 *
 * Set `PI_SUBAGENT_AVAILABLE=1` when the runtime supports subagent dispatch.
 * This is consistent with the `PI_WORKTREE_BYPASS` and `PI_ASYNC_START_BYPASS`
 * patterns already present in the repo.
 */
export const PI_SUBAGENT_AVAILABLE_VAR = "PI_SUBAGENT_AVAILABLE";

/**
 * Detect whether subagent dispatch is available in the current runtime.
 *
 * This is an env-var-based heuristic, consistent with other bypass/availability
 * patterns in the repo. It is intentionally simple — the gate's subagent check
 * is advisory (fails-open) and never hard-blocks on subagent absence.
 *
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {boolean}
 */
export function detectSubagentAvailability({ env = process.env } = {}) {
  return (env[PI_SUBAGENT_AVAILABLE_VAR] ?? "").trim() === "1";
}

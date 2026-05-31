/**
 * Checkpoint I/O helpers shared between outer-loop and inspect-run.
 *
 * Consolidates the checkpoint fallback resolution logic that was previously
 * duplicated across scripts/loop/outer-loop.mjs and
 * scripts/loop/inspect-run.mjs:
 *
 *   Fallback order (when no explicit checkpointDir is provided):
 *   1. Default repo-qualified path: tmp/copilot-loop/<owner>/<name>/pr-<n>/outer-loop-state.json
 *   2. Legacy path: tmp/copilot-loop/pr-<n>/outer-loop-state.json
 *      (only accepted when the file's repo+pr fields match the target)
 */
import { readFile } from "node:fs/promises";

import { parseJsonText } from "../_core-helpers.mjs";
import {
  buildCheckpointFilePath,
  buildDefaultCheckpointDir,
  buildLegacyDefaultCheckpointDir,
} from "./_checkpoint-paths.mjs";

/**
 * Read the existing checkpoint with standard fallback resolution.
 *
 * @param {string} repo
 *   Repository slug (owner/name). Normalized to lowercase internally.
 * @param {number} pr
 *   Pull request number.
 * @param {object} [options]
 * @param {string} [options.checkpointDir]
 *   Explicit checkpoint directory. When provided, the fallback chain is
 *   skipped and only this directory is consulted.
 * @param {boolean} [options.failSilently=false]
 *   When false (default), I/O errors other than ENOENT are thrown so the
 *   caller can surface them (outer-loop behavior).
 *   When true, all I/O errors return { checkpoint: null, filePath: null }
 *   so inspection can proceed with whatever evidence is available.
 * @returns {Promise<{ checkpoint: object|null, filePath: string|null }>}
 *   checkpoint is null when not found or on a silenced error.
 *   filePath is the path from which the checkpoint was read, or null when
 *   no checkpoint was found.
 */
export async function readExistingCheckpoint(repo, pr, { checkpointDir, failSilently = false } = {}) {
  const normalizedRepo = typeof repo === "string" ? repo.trim().toLowerCase() : repo;

  // When an explicit directory override is provided, use it directly.
  if (checkpointDir !== undefined) {
    const filePath = buildCheckpointFilePath(checkpointDir);
    try {
      const text = await readFile(filePath, "utf8");
      return { checkpoint: parseJsonText(text), filePath };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return { checkpoint: null, filePath: null };
      }
      if (failSilently) {
        return { checkpoint: null, filePath: null };
      }
      throw new Error(`Failed to read checkpoint '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Try the default repo-qualified path.
  const preferredDir = buildDefaultCheckpointDir(normalizedRepo, pr);
  const preferredPath = buildCheckpointFilePath(preferredDir);

  try {
    const text = await readFile(preferredPath, "utf8");
    return { checkpoint: parseJsonText(text), filePath: preferredPath };
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      if (failSilently) {
        return { checkpoint: null, filePath: null };
      }
      throw new Error(`Failed to read checkpoint '${preferredPath}': ${error instanceof Error ? error.message : String(error)}`);
    }
    // ENOENT: fall through to legacy path.
  }

  // Fall back to the legacy path, validated against repo+pr.
  const legacyPath = buildCheckpointFilePath(buildLegacyDefaultCheckpointDir(pr));
  try {
    const text = await readFile(legacyPath, "utf8");
    const checkpoint = parseJsonText(text);
    if (checkpoint?.repo === normalizedRepo && checkpoint?.pr === pr) {
      return { checkpoint, filePath: legacyPath };
    }
    return { checkpoint: null, filePath: null };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { checkpoint: null, filePath: null };
    }
    if (failSilently) {
      return { checkpoint: null, filePath: null };
    }
    throw new Error(`Failed to read checkpoint '${legacyPath}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

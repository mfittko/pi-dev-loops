import { parseRepoSlugParts } from "../../packages/core/src/github/repo-slug.mjs";
import { inspectRun } from "./inspect-run.mjs";

function malformedTargetError(message) {
  const error = new Error(message);
  error.code = "MALFORMED_TARGET";
  return error;
}

function parsePositivePr(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) {
    return Number(value);
  }

  throw malformedTargetError("target.pr must be a positive integer");
}

export function normalizeInspectionTarget(target) {
  if (target === null || typeof target !== "object") {
    throw malformedTargetError("target must be an object with repo and pr");
  }

  const rawRepo = typeof target.repo === "string" ? target.repo.trim() : "";
  if (rawRepo.length === 0) {
    throw malformedTargetError("target.repo is required");
  }

  try {
    parseRepoSlugParts(rawRepo, { errorMessage: "target.repo must match <owner/name>" });
  } catch (error) {
    throw malformedTargetError(error instanceof Error ? error.message : String(error));
  }

  return {
    repo: rawRepo,
    pr: parsePositivePr(target.pr),
  };
}

export function createInspectionViewerAdapter({ inspectRunImpl = inspectRun } = {}) {
  return {
    async loadSnapshot(target, options = {}) {
      const normalizedTarget = normalizeInspectionTarget(target);
      return inspectRunImpl({ ...options, ...normalizedTarget });
    },
  };
}

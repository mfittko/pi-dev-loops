import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export {
  formatCliError,
  parseJsonText,
  classifyReviewThreadsSignal,
  parseReviewThreads,
  readInput,
} from "@pi-dev-loops/core/github/review-threads";

export {
  buildPhasePaths,
  readJsonIfExists,
} from "@pi-dev-loops/core/loop/phase-files";

export {
  extractReviewCommitSha,
  isCopilotLogin,
  normalizeTimestamp,
  parseGateReviewCommentBody,
  parseGateReviewCommentMarkerBody,
  summarizeCopilotReviews,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "@pi-dev-loops/core/github/copilot-helpers";

export function buildParseError(usage) {
  return function parseError(message) {
    return Object.assign(new Error(message), { usage });
  };
}

export function isDirectCliRun(importMetaUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== "string" || argv1.length === 0) {
    return false;
  }

  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

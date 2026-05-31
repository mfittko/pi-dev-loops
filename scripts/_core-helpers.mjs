import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export {
  formatCliError,
  parseJsonText,
  parseReviewThreads,
  readInput,
} from "../packages/core/src/github/review-threads.mjs";

export {
  buildPhasePaths,
  readJsonIfExists,
} from "../packages/core/src/loop/phase-files.mjs";

export {
  extractReviewCommitSha,
  isCopilotLogin,
  normalizeTimestamp,
  parseGateReviewCommentBody,
  parseGateReviewCommentMarkerBody,
  summarizeCopilotReviews,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "../packages/core/src/github/copilot-helpers.mjs";

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

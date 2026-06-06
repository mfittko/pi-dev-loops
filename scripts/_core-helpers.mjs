// Re-exports from shared library (Phase 2, issue #548)

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

export {
  buildParseError,
  isDirectCliRun,
} from "@pi-dev-loops/core/cli/helpers";

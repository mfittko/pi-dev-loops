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


const SUBMITTED_REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);

export function isCopilotLogin(login) {
  return typeof login === "string" && /^copilot(?:[^a-z]|$)/i.test(login);
}

export function extractReviewCommitSha(review) {
  const graphqlSha = typeof review?.commit?.oid === "string" ? review.commit.oid.trim() : "";
  const restSha = typeof review?.commit_id === "string" ? review.commit_id.trim() : "";
  const sha = graphqlSha || restSha;
  return sha.length > 0 ? sha : null;
}

export function summarizeCopilotReviews(reviews, { headSha } = {}) {
  const allReviews = Array.isArray(reviews) ? reviews : [];
  const copilotReviews = allReviews.filter((review) => isCopilotLogin(review?.author?.login));

  let hasPendingReviewOnCurrentHead = false;
  let hasSubmittedReviewOnCurrentHead = false;

  for (const review of copilotReviews) {
    const state = typeof review?.state === "string" ? review.state.toUpperCase() : "";
    const reviewCommitSha = extractReviewCommitSha(review);
    const reviewOnCurrentHead = headSha !== null && reviewCommitSha === headSha;

    if (!reviewOnCurrentHead) {
      continue;
    }

    if (state === "PENDING") {
      hasPendingReviewOnCurrentHead = true;
      continue;
    }

    if (SUBMITTED_REVIEW_STATES.has(state)) {
      hasSubmittedReviewOnCurrentHead = true;
    }
  }

  const hasCleanSubmittedReview = copilotReviews.some((review) => {
    const state = typeof review?.state === "string" ? review.state.toUpperCase() : "";
    const body = typeof review?.body === "string" ? review.body : "";
    return state !== "PENDING" && /generated no new comments/i.test(body);
  });

  return {
    copilotReviews,
    hasCleanSubmittedReview,
    copilotReviewIds: copilotReviews
      .map((review) => review?.id)
      .filter((id) => id !== null && id !== undefined)
      .map((id) => String(id)),
    copilotReviewPresent: copilotReviews.length > 0,
    hasPendingReviewOnCurrentHead,
    hasSubmittedReviewOnCurrentHead,
  };
}

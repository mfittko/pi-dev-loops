import { parseRepoSlugParts } from "../../packages/core/src/github/repo-slug.mjs";

export function parseRepoSlug(repo) {
  return parseRepoSlugParts(repo, { errorMessage: "--repo must match <owner/name>" });
}

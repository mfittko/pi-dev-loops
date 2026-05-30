export function isSafeRepoSegment(segment) {
  return typeof segment === "string"
    && segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[\\/]/.test(segment)
    && !/\s/.test(segment);
}

export function parseRepoSlug(
  repo,
  { errorMessage = "--repo must match <owner/name>", lowercase = false } = {},
) {
  return parseRepoSlugParts(repo, { errorMessage, lowercase });
}

export function parseRepoSlugParts(
  repo,
  { errorMessage = "repo must match <owner/name>", lowercase = false } = {},
) {
  if (typeof repo !== "string") {
    throw new Error(errorMessage);
  }

  const trimmed = repo.trim();
  const [rawOwner, rawName, ...rest] = trimmed.split("/");

  if (rest.length > 0 || !isSafeRepoSegment(rawOwner) || !isSafeRepoSegment(rawName)) {
    throw new Error(errorMessage);
  }

  const owner = lowercase ? rawOwner.toLowerCase() : rawOwner;
  const name = lowercase ? rawName.toLowerCase() : rawName;
  return { owner, name };
}

export function normalizeRepoSlug(
  repo,
  { errorMessage = "repo must match <owner/name>" } = {},
) {
  const { owner, name } = parseRepoSlugParts(repo, { errorMessage, lowercase: true });
  return `${owner}/${name}`;
}

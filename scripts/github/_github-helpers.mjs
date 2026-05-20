function isSafeRepoSegment(segment) {
  return typeof segment === "string"
    && segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[\\/]/.test(segment)
    && !/\s/.test(segment);
}

export function parseRepoSlug(repo) {
  if (typeof repo !== "string") {
    throw new Error("--repo must match <owner/name>");
  }

  const [owner, name, ...rest] = repo.split("/");
  if (rest.length > 0 || !isSafeRepoSegment(owner) || !isSafeRepoSegment(name)) {
    throw new Error("--repo must match <owner/name>");
  }

  return { owner, name };
}

export function normalizeRepoSlug(slug) {
  if (typeof slug !== "string") {
    return null;
  }
  const trimmed = slug.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export function repoSlugEquals(left, right) {
  const normalizedLeft = normalizeRepoSlug(left);
  const normalizedRight = normalizeRepoSlug(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return left === right;
  }
  return normalizedLeft === normalizedRight;
}

export function dedupeRepoSlugOptions(options) {
  const uniqueOptions = [];
  const seen = new Set();
  for (const option of options) {
    if (typeof option !== "string") {
      continue;
    }
    const trimmed = option.trim();
    const normalized = normalizeRepoSlug(trimmed);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueOptions.push(trimmed);
  }
  return uniqueOptions;
}

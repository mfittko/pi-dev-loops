export function parseRepoSlug(repo) {
  if (typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("--repo must match <owner/name>");
  }

  const [owner, name] = repo.split("/");
  return { owner, name };
}

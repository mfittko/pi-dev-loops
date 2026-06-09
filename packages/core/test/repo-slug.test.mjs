import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeRepoSlugOptions,
  isSafeRepoSegment,
  normalizeRepoSlug,
  parseRepoSlug,
  parseRepoSlugParts,
  repoSlugEquals,
  tryNormalizeRepoSlug,
  detectRepoSlug,
} from "../src/github/repo-slug.mjs";

// ---------------------------------------------------------------------------
// isSafeRepoSegment
// ---------------------------------------------------------------------------

test("isSafeRepoSegment accepts a normal segment", () => {
  assert.equal(isSafeRepoSegment("owner"), true);
  assert.equal(isSafeRepoSegment("my-repo"), true);
  assert.equal(isSafeRepoSegment("Repo.Name"), true);
});

test("isSafeRepoSegment rejects empty string", () => {
  assert.equal(isSafeRepoSegment(""), false);
});

test("isSafeRepoSegment rejects dot segments", () => {
  assert.equal(isSafeRepoSegment("."), false);
  assert.equal(isSafeRepoSegment(".."), false);
});

test("isSafeRepoSegment rejects segments with slashes or backslashes", () => {
  assert.equal(isSafeRepoSegment("a/b"), false);
  assert.equal(isSafeRepoSegment("a\\b"), false);
});

test("isSafeRepoSegment rejects segments with whitespace", () => {
  assert.equal(isSafeRepoSegment("a b"), false);
  assert.equal(isSafeRepoSegment(" owner"), false);
});

// ---------------------------------------------------------------------------
// parseRepoSlug / parseRepoSlugParts
// ---------------------------------------------------------------------------

test("parseRepoSlug returns owner and name", () => {
  assert.deepEqual(parseRepoSlug("owner/repo"), { owner: "owner", name: "repo" });
});

test("parseRepoSlug lowercases when option is set", () => {
  assert.deepEqual(parseRepoSlug("Owner/Repo", { lowercase: true }), { owner: "owner", name: "repo" });
});

test("parseRepoSlug trims surrounding whitespace", () => {
  assert.deepEqual(parseRepoSlug("  owner/repo  "), { owner: "owner", name: "repo" });
});

test("parseRepoSlug throws for non-string", () => {
  assert.throws(() => parseRepoSlug(null), /--repo must match/);
});

test("parseRepoSlug throws for missing name part", () => {
  assert.throws(() => parseRepoSlug("owner"), /--repo must match/);
});

test("parseRepoSlug throws for extra slash", () => {
  assert.throws(() => parseRepoSlug("owner/repo/extra"), /--repo must match/);
});

test("parseRepoSlugParts uses custom error message", () => {
  assert.throws(() => parseRepoSlugParts(42, { errorMessage: "custom error" }), /custom error/);
});

// ---------------------------------------------------------------------------
// normalizeRepoSlug (strict)
// ---------------------------------------------------------------------------

test("normalizeRepoSlug returns lowercase owner/name", () => {
  assert.equal(normalizeRepoSlug("Owner/Repo"), "owner/repo");
});

test("normalizeRepoSlug trims surrounding whitespace", () => {
  assert.equal(normalizeRepoSlug("  owner/repo  "), "owner/repo");
});

test("normalizeRepoSlug throws for non-string", () => {
  assert.throws(() => normalizeRepoSlug(null), /repo must match/);
});

test("normalizeRepoSlug throws for bare owner without name", () => {
  assert.throws(() => normalizeRepoSlug("owner"), /repo must match/);
});

// ---------------------------------------------------------------------------
// tryNormalizeRepoSlug (lenient)
// ---------------------------------------------------------------------------

test("tryNormalizeRepoSlug returns null for non-string", () => {
  assert.equal(tryNormalizeRepoSlug(null), null);
  assert.equal(tryNormalizeRepoSlug(undefined), null);
  assert.equal(tryNormalizeRepoSlug(42), null);
});

test("tryNormalizeRepoSlug returns null for empty string", () => {
  assert.equal(tryNormalizeRepoSlug(""), null);
  assert.equal(tryNormalizeRepoSlug("   "), null);
});

test("tryNormalizeRepoSlug lowercases and trims valid slug", () => {
  assert.equal(tryNormalizeRepoSlug("Owner/Repo"), "owner/repo");
  assert.equal(tryNormalizeRepoSlug("  owner/repo  "), "owner/repo");
});

test("tryNormalizeRepoSlug does not validate owner/name structure", () => {
  assert.equal(tryNormalizeRepoSlug("bareword"), "bareword");
});

// ---------------------------------------------------------------------------
// repoSlugEquals
// ---------------------------------------------------------------------------

test("repoSlugEquals returns true for identical slugs", () => {
  assert.equal(repoSlugEquals("owner/repo", "owner/repo"), true);
});

test("repoSlugEquals is case-insensitive", () => {
  assert.equal(repoSlugEquals("Owner/Repo", "owner/repo"), true);
});

test("repoSlugEquals trims surrounding whitespace", () => {
  assert.equal(repoSlugEquals(" owner/repo ", "owner/repo"), true);
});

test("repoSlugEquals returns false for different slugs", () => {
  assert.equal(repoSlugEquals("owner/repo", "other/repo"), false);
});

test("repoSlugEquals returns false when left is null", () => {
  assert.equal(repoSlugEquals(null, "owner/repo"), false);
});

test("repoSlugEquals returns false when right is null", () => {
  assert.equal(repoSlugEquals("owner/repo", null), false);
});

test("repoSlugEquals returns true for two nulls (identity)", () => {
  assert.equal(repoSlugEquals(null, null), true);
});

// ---------------------------------------------------------------------------
// dedupeRepoSlugOptions
// ---------------------------------------------------------------------------

test("dedupeRepoSlugOptions returns unique entries in order", () => {
  assert.deepEqual(dedupeRepoSlugOptions(["owner/repo", "other/repo"]), ["owner/repo", "other/repo"]);
});

test("dedupeRepoSlugOptions dedupes case-insensitively keeping first occurrence", () => {
  assert.deepEqual(
    dedupeRepoSlugOptions([" Owner/Repo ", "owner/repo", "other/repo"]),
    ["Owner/Repo", "other/repo"],
  );
});

test("dedupeRepoSlugOptions skips non-strings", () => {
  assert.deepEqual(dedupeRepoSlugOptions([null, "owner/repo", 42, undefined]), ["owner/repo"]);
});

test("dedupeRepoSlugOptions skips empty/whitespace-only strings", () => {
  assert.deepEqual(dedupeRepoSlugOptions(["", "  ", "owner/repo"]), ["owner/repo"]);
});

test("dedupeRepoSlugOptions returns empty array for empty input", () => {
  assert.deepEqual(dedupeRepoSlugOptions([]), []);
});
// ---------------------------------------------------------------------------
// detectRepoSlug
// ---------------------------------------------------------------------------

test("detectRepoSlug returns owner/repo from git remote get-url origin", () => {
  // Run from repo root to get real git remote
  const slug = detectRepoSlug(process.cwd());
  assert.ok(typeof slug === "string");
  assert.match(slug, /^[^/]+\/[^/]+$/);
  assert.equal(slug, slug.trim());
});

test("detectRepoSlug throws for non-git directory", () => {
  assert.throws(
    () => detectRepoSlug("/tmp"),
    /Repo auto-detection failed/,
  );
});

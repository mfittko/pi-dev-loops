import assert from "node:assert/strict";
import test from "node:test";

import {
  isUnderWorktreePath,
  parseMainWorktreePath,
  isMainCheckout,
  detectSubagentAvailability,
  PI_SUBAGENT_AVAILABLE_VAR,
} from "../src/loop/worktree-guard.mjs";

// ---------------------------------------------------------------------------
// isUnderWorktreePath
// ---------------------------------------------------------------------------

test("isUnderWorktreePath: true when under tmp/worktrees/foo", () => {
  assert.equal(isUnderWorktreePath("/home/user/repo/tmp/worktrees/issue-1"), true);
});

test("isUnderWorktreePath: true when exactly tmp/worktrees", () => {
  assert.equal(isUnderWorktreePath("/home/user/repo/tmp/worktrees"), true);
});

test("isUnderWorktreePath: true with trailing slash", () => {
  assert.equal(isUnderWorktreePath("/home/user/repo/tmp/worktrees/issue-1/"), true);
});

test("isUnderWorktreePath: true with Windows backslashes", () => {
  assert.equal(isUnderWorktreePath("C:\\repo\\tmp\\worktrees\\issue-1"), true);
});

test("isUnderWorktreePath: false for main checkout", () => {
  assert.equal(isUnderWorktreePath("/home/user/repo"), false);
});

test("isUnderWorktreePath: false for tmp/ but not worktrees", () => {
  assert.equal(isUnderWorktreePath("/home/user/repo/tmp/phases"), false);
});

test("isUnderWorktreePath: false for path containing worktrees as substring elsewhere", () => {
  assert.equal(isUnderWorktreePath("/home/user/not-tmp/worktrees/issue-1"), false);
});

// ---------------------------------------------------------------------------
// parseMainWorktreePath
// ---------------------------------------------------------------------------

test("parseMainWorktreePath: parses standard git worktree list output", () => {
  const output = "/home/user/repo  535a18a [main]\n/home/user/repo/tmp/worktrees/issue-1  535a18a [issue-1]\n";
  assert.equal(parseMainWorktreePath(output), "/home/user/repo");
});

test("parseMainWorktreePath: parses without branch annotation", () => {
  const output = "/home/user/repo  535a18a\n";
  assert.equal(parseMainWorktreePath(output), "/home/user/repo");
});

test("parseMainWorktreePath: parses path with spaces", () => {
  const output = "/home/user/my repo  535a18a [main]\n";
  assert.equal(parseMainWorktreePath(output), "/home/user/my repo");
});

test("parseMainWorktreePath: returns null for empty output", () => {
  assert.equal(parseMainWorktreePath(""), null);
});

test("parseMainWorktreePath: returns null for whitespace-only output", () => {
  assert.equal(parseMainWorktreePath("   \n  "), null);
});

test("parseMainWorktreePath: returns null for malformed output (no SHA)", () => {
  assert.equal(parseMainWorktreePath("/home/user/repo"), null);
});

test("parseMainWorktreePath: returns null for output without path", () => {
  assert.equal(parseMainWorktreePath("535a18a [main]"), null);
});

// ---------------------------------------------------------------------------
// isMainCheckout
// ---------------------------------------------------------------------------

test("isMainCheckout: true when cwd matches main worktree path exactly", () => {
  assert.equal(isMainCheckout("/home/user/repo", "/home/user/repo"), true);
});

test("isMainCheckout: true when cwd is subdirectory of main worktree", () => {
  assert.equal(isMainCheckout("/home/user/repo/src", "/home/user/repo"), true);
});

test("isMainCheckout: true with trailing slash on cwd", () => {
  assert.equal(isMainCheckout("/home/user/repo/", "/home/user/repo"), true);
});

test("isMainCheckout: true with trailing slash on main path", () => {
  assert.equal(isMainCheckout("/home/user/repo", "/home/user/repo/"), true);
});

test("isMainCheckout: true with Windows separators", () => {
  assert.equal(isMainCheckout("C:\\repo\\src", "C:\\repo"), true);
});

test("isMainCheckout: false when cwd is a sibling directory", () => {
  assert.equal(isMainCheckout("/home/user/other-repo", "/home/user/repo"), false);
});

test("isMainCheckout: true even for worktree path (caller filters with isUnderWorktreePath)", () => {
  // isMainCheckout uses startsWith — worktree paths are technically subdirectories.
  // Callers must combine with !isUnderWorktreePath() to exclude worktree paths.
  assert.equal(isMainCheckout("/home/user/repo/tmp/worktrees/issue-1", "/home/user/repo"), true);
});

test("isMainCheckout: false when mainWorktreePath is null", () => {
  assert.equal(isMainCheckout("/home/user/repo", null), false);
});

test("isMainCheckout: false when mainWorktreePath is empty", () => {
  assert.equal(isMainCheckout("/home/user/repo", ""), false);
});

// ---------------------------------------------------------------------------
// detectSubagentAvailability
// ---------------------------------------------------------------------------

test("detectSubagentAvailability: true when PI_SUBAGENT_AVAILABLE=1", () => {
  assert.equal(detectSubagentAvailability({ env: { PI_SUBAGENT_AVAILABLE: "1" } }), true);
});

test("detectSubagentAvailability: false when PI_SUBAGENT_AVAILABLE is not set", () => {
  assert.equal(detectSubagentAvailability({ env: {} }), false);
});

test("detectSubagentAvailability: false when PI_SUBAGENT_AVAILABLE is empty", () => {
  assert.equal(detectSubagentAvailability({ env: { PI_SUBAGENT_AVAILABLE: "" } }), false);
});

test("detectSubagentAvailability: false when PI_SUBAGENT_AVAILABLE is zero", () => {
  assert.equal(detectSubagentAvailability({ env: { PI_SUBAGENT_AVAILABLE: "0" } }), false);
});

test("detectSubagentAvailability: false when PI_SUBAGENT_AVAILABLE is whitespace", () => {
  assert.equal(detectSubagentAvailability({ env: { PI_SUBAGENT_AVAILABLE: "  " } }), false);
});

test("detectSubagentAvailability: defaults to process.env when no arg", () => {
  // Trivial smoke: call without args to confirm no throw.
  const result = detectSubagentAvailability();
  assert.equal(typeof result, "boolean");
});

// ---------------------------------------------------------------------------
// PI_SUBAGENT_AVAILABLE_VAR constant
// ---------------------------------------------------------------------------

test("PI_SUBAGENT_AVAILABLE_VAR: matches the env var name", () => {
  assert.equal(PI_SUBAGENT_AVAILABLE_VAR, "PI_SUBAGENT_AVAILABLE");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("copilot skill does not contain known imported blocker phrases", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.doesNotMatch(content, /repo-wiki/);
  assert.doesNotMatch(content, /copilot-review-followup/);
  assert.doesNotMatch(content, /async-review-fix-push/);
});

test("review agent does not hardcode reviewer identity or stale plan path", async () => {
  const content = await readRepo("agents/review.agent.md");

  assert.doesNotMatch(content, /mfittko/);
  assert.doesNotMatch(content, /docs\/plans\//);
});

test("coordinator agent does not contain stale docs/plans path", async () => {
  const content = await readRepo("agents/coordinator.agent.md");

  assert.doesNotMatch(content, /docs\/plans\//);
});

test("copilot skill still contains its core workflow guidance", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /Before planning, review, or automation:/);
  assert.match(content, /Before any GitHub mutation/);
  assert.match(content, /Preferred defaults for this repo:/);
  assert.match(content, /Default validation should match or approximate/);
});

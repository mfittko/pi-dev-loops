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
  assert.match(content, /relative to this skill directory/i);
  assert.match(content, /~\/.pi\/agent\/skills/i);
  assert.match(content, /1 minute/i);
  assert.match(content, /24 hours/i);
  assert.match(content, /Default validation should match or approximate/);
});

test("copilot skill requires github reply/resolve follow-up and gates waiting on confirmed review-request state", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /reply\/resolve work is done for the addressed threads/);
  assert.match(content, /wait\/watch loop if the request result is confirmed as `requested` or `already-requested`/);
  assert.match(content, /`requested`: if another Copilot pass is actually desired/);
  assert.match(content, /`already-requested`: if another Copilot pass is actually desired/);
  assert.match(content, /`unavailable`: report the limitation and stop/);
  assert.match(content, /stop and report the error rather than (?:entering a sleep\/watch loop|sleeping and hoping for a new review)/);
});

test("copilot skill forbids detached bash watcher loops for async follow-up", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /Pi async subagent|designated async follow-up skill/);
  assert.match(content, /do not use `nohup`, detached shell jobs, tmux\/screen sessions, or ad hoc `while`\/`sleep` bash loops/);
  assert.match(content, /stop and report rather than improvising a shell watcher/);
});

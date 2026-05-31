import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRepo(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("sub-issue decomposition docs keep dev-loop public surface and thin helper boundary explicit", async () => {
  const content = await readRepo("docs/github-sub-issue-decomposition.md");

  assert.match(content, /`dev-loop` remains the only public workflow entrypoint/i);
  assert.match(content, /Use existing `gh issue create` for child issue creation/i);
  assert.match(content, /scripts\/github\/sub-issue-tree\.mjs/i);
  assert.match(content, /parent issue body lean/i);
  assert.match(content, /plain related-issue references/i);
});

test("GitHub-first skill guidance prefers real sub-issue trees over parent-body checklists", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /prefer a real GitHub sub-issue tree as the durable execution structure/i);
  assert.match(content, /sub-issue linkage over a parent-body execution checklist/i);
  assert.match(content, /use `gh issue create` for child issue creation/i);
  assert.match(content, /keep the parent issue body lean once the tree exists/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRepo(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("GitHub-first dev-loop startup guidance prefers real sub-issue trees for bounded decomposition", async () => {
  const content = await readRepo("skills/dev-loop/SKILL.md");

  assert.match(content, /prefer real GitHub sub-issue trees as the durable execution structure/i);
  assert.match(content, /keep parent issue bodies lean/i);
  assert.match(content, /plain related-issue references/i);
});

test("coordinator guidance prefers real sub-issue trees over duplicated parent-body checklists", async () => {
  const content = await readRepo("agents/coordinator.agent.md");

  assert.match(content, /prefer real GitHub sub-issue trees as the durable execution structure/i);
  assert.match(content, /keep parent issue bodies lean/i);
  assert.match(content, /duplicating order in checklist prose/i);
});

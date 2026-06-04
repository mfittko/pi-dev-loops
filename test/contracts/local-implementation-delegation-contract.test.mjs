import {
  assert,
  assertMatchesAll,
  readRepo,
  test,
} from "../imported-assets-helpers.mjs";

test("local-implementation skill includes task breakdown & delegation section", async () => {
  const content = await readRepo("skills/local-implementation/SKILL.md");

  assertMatchesAll(content, [
    /## Task breakdown & delegation/i,
    /### Task decomposition/i,
    /### Delegation contract/i,
    /### Status monitoring/i,
    /### Consolidation/i,
    /Dispatch implementation tasks to dedicated specialist agents/i,
    /Code changes, refactors, tests, bug fixes, feature work[\s\S]*`developer`/i,
    /Build systems, CI, test runners, type-checking, linting[\s\S]*`quality`/i,
    /README, plan docs, agent docs, migration notes[\s\S]*`docs`/i,
    /Review-comment follow-up, PR fix commits[\s\S]*`fixer`/i,
    /give the subagent one focused task with exact success criteria/i,
    /avoid circular delegation and overlapping scopes/i,
    /if a subagent exits while the task is still non-terminal, resume or re-dispatch/i,
  ], "skills/local-implementation/SKILL.md");
});

test("local-implementation skill does not reference the removed coordinator agent", async () => {
  const content = await readRepo("skills/local-implementation/SKILL.md");

  assert.doesNotMatch(content, /coordinator/i);
});

test("local-implementation skill owns workflow handoff template delegation", async () => {
  const content = await readRepo("skills/local-implementation/SKILL.md");

  assert.match(content, /`local-implementation` skill uses this template when delegating/i);
  assert.doesNotMatch(content, /coordinator must use this template/i);
});

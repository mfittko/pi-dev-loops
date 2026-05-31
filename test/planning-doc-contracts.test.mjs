import {
  assert,
  assertMatchesAll,
  parseFrontmatter,
  readRepo,
  test,
} from "./imported-assets-helpers.mjs";

const SUB_ISSUE_TREE_GUIDANCE = [
  /prefer real GitHub sub-issue trees as the durable execution structure/i,
  /keep parent issue bodies lean/i,
];

test("refiner agent frontmatter keeps the refinement role explicit", async () => {
  const content = await readRepo("agents/refiner.agent.md");
  const frontmatter = parseFrontmatter(content);

  assert.equal(frontmatter.name, "refiner");
  assert.equal(frontmatter["user-invocable"], false);
  assert.match(frontmatter.description ?? "", /phase refinement/i);
  assert.match(frontmatter.description ?? "", /acceptance criteria/i);
  assert.match(frontmatter.description ?? "", /definition of done/i);
  assert.match(frontmatter.description ?? "", /RFC escalation/i);
});

test("refiner agent defines the approved phase-refinement contract", async () => {
  const content = await readRepo("agents/refiner.agent.md");

  assertMatchesAll(content, [
    /## Purpose/i,
    /## Scope boundaries/i,
    /## Refinement contract/i,
    /## RFC escalation boundary/i,
    /complete acceptance criteria/i,
    /complete definition of done/i,
    /explicit non-goals/i,
    /explicit risks, watchpoints, and unresolved questions/i,
    /validation steps and tests to write first/i,
    /parallel fresh-context fan-out\/fan-in/i,
    /variant-a.+variant-b|variant-b.+variant-a/is,
    /one persona or refinement angle/i,
    /different persona or angle/i,
    /through the coordinator/i,
    /lead dev/i,
    /specialized dev/i,
    /systems architect/i,
  ], "agents/refiner.agent.md");
  assert.doesNotMatch(content, /execute RFC work itself|run the RFC team|implement the RFC team/i);
});

test("dev-loop skill uses the refiner for phase planning without replacing the coordinator", async () => {
  const content = await readRepo("skills/dev-loop/SKILL.md");

  assertMatchesAll(content, [
    /refiner/i,
    /parallel fresh-context subagents/i,
    /concise written briefing summary|concise briefing summary/i,
    /do not fork the parent session/i,
    /stable inner fan-out shape|anchored to one persona or refinement angle/i,
    /different persona or angle/i,
    /Definition of done/i,
    /RFC-worthy technical decisions/i,
    /through the coordinator/i,
    /keeps? the coordinator as the escalation\/decision owner|coordinator as the escalation and decision owner/i,
  ], "skills/dev-loop/SKILL.md");
});

test("coordinator agent remains the RFC receiving boundary and decision owner", async () => {
  const content = await readRepo("agents/coordinator.agent.md");

  assertMatchesAll(content, [
    /RFC/i,
    /receiv/i,
    /decision owner/i,
    /lead dev/i,
    /specialized dev/i,
    /systems architect/i,
  ], "agents/coordinator.agent.md");
});

test("planning guidance keeps sub-issue trees as the durable decomposition owner", async () => {
  const [devLoopSkill, coordinatorAgent, subIssueTreeContract, docsIndex] = await Promise.all([
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("agents/coordinator.agent.md"),
    readRepo("docs/sub-issue-tree-contract.md"),
    readRepo("docs/index.md"),
  ]);

  assertMatchesAll(devLoopSkill, [
    ...SUB_ISSUE_TREE_GUIDANCE,
    /plain related-issue references/i,
  ], "skills/dev-loop/SKILL.md");
  assertMatchesAll(coordinatorAgent, [
    ...SUB_ISSUE_TREE_GUIDANCE,
    /duplicating order in checklist prose/i,
  ], "agents/coordinator.agent.md");
  assertMatchesAll(subIssueTreeContract, [
    /manage-sub-issues\.mjs/i,
    /When to use sub-issues vs plain related-issue references/i,
    /do not maintain.*checklist.*duplicates|not.*maintain.*ordered checklist.*duplicates/i,
  ], "docs/sub-issue-tree-contract.md");
  assert.match(docsIndex, /docs\/sub-issue-tree-contract\.md/i);
});

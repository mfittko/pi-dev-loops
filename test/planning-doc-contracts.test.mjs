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
    /coverage matrix/i,
    /Type \(AC\/DoD\/Non-goal\)/i,
    /Status \(Met\/Partial\/Unmet\/Unverified\)/i,
    /use exact wording from the source issue\(s\)/i,
    /include every explicit acceptance criterion, definition-of-done item, and non-goal/i,
    /Proposed DoD/i,
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
    /A refinement is complete only when no item.+Partial.+Unmet.+Unverified/is,
  ], "agents/refiner.agent.md");
  assert.doesNotMatch(content, /execute RFC work itself|run the RFC team|implement the RFC team/i);
});


test("defaults config exposes a customizable refiner coverage-matrix prompt", async () => {
  const content = await readRepo(".pi/dev-loop/defaults.yaml");

  assertMatchesAll(content, [
    /personas:\n  refiner:\n    persona: refiner/m,
    /AC\/DoD\/Non-goal coverage matrix/i,
    /\| Item \| Type \(AC\/DoD\/Non-goal\) \| Status \(Met\/Partial\/Unmet\/Unverified\) \| Evidence \| Notes \|/i,
    /Use exact wording from the source issue\(s\); when the governing input is a phase doc or other spec instead of an issue, use that source wording exactly for every explicit item/i,
    /Include every explicit acceptance criterion, definition-of-done item, and non-goal; do not skip items/i,
    /If no explicit definition of done exists, add a `Proposed DoD` subsection before the matrix/i,
    /A refinement is complete only when no item has `Partial`, `Unmet`, or `Unverified` status/i,
  ], ".pi/dev-loop/defaults.yaml");
});

test("local-implementation skill uses the refiner for phase planning without replacing the coordinator", async () => {
  const content = await readRepo("skills/local-implementation/SKILL.md");

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
  ], "skills/local-implementation/SKILL.md");
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
  const [localImplementationSkill, coordinatorAgent, subIssueTreeContract, docsIndex] = await Promise.all([
    readRepo("skills/local-implementation/SKILL.md"),
    readRepo("agents/coordinator.agent.md"),
    readRepo("docs/sub-issue-tree-contract.md"),
    readRepo("docs/index.md"),
  ]);

  assertMatchesAll(localImplementationSkill, [
    ...SUB_ISSUE_TREE_GUIDANCE,
    /plain related-issue references/i,
  ], "skills/local-implementation/SKILL.md");
  assertMatchesAll(coordinatorAgent, [
    ...SUB_ISSUE_TREE_GUIDANCE,
    /duplicating order in checklist prose/i,
  ], "agents/coordinator.agent.md");
  assertMatchesAll(subIssueTreeContract, [
    /manage-sub-issues\.mjs/i,
    /When to use sub-issues vs plain related-issue references/i,
    /do not maintain.*checklist.*duplicates|not.*maintain.*ordered checklist.*duplicates/i,
  ], "docs/sub-issue-tree-contract.md");
  assert.match(docsIndex, /sub-issue-tree-contract\.md/i);
});

test("local workflow docs define tracker-backed local canonicality and no-dup rules", async () => {
  const [workflowDoc, localImplSkill, scriptsReadme] = await Promise.all([
    readRepo("docs/IMPLEMENTATION_WORKFLOW.md"),
    readRepo("skills/local-implementation/SKILL.md"),
    readRepo("scripts/README.md"),
  ]);

  assertMatchesAll(workflowDoc, [
    /Tracker-backed local issue spec/i,
    /tracker issue is the durable canonical spec/i,
    /resolve-tracker-local-spec\.mjs/i,
    /do \*\*not\*\* also maintain.*Phase Plan.*for that same tracker-backed session/i,
  ], "docs/IMPLEMENTATION_WORKFLOW.md");

  assertMatchesAll(localImplSkill, [
    /Local implementation supports two durable spec inputs/i,
    /phase-doc-backed local sessions/i,
    /tracker-backed local sessions/i,
    /do not create or read \[Phase Plan\]\(\.\.\/\.\.\/docs\/phases\/phase-x\.md\) for that same tracker-backed session/i,
    /keep `tmp\/` as temporary local execution state only/i,
  ], "skills/local-implementation/SKILL.md");

  assertMatchesAll(scriptsReadme, [
    /resolve-tracker-local-spec\.mjs/i,
    /bounded GitHub-backed path/i,
    /localPhaseDocAllowed: false/i,
  ], "scripts/README.md");
});

test("worktree guidance docs define the canonical checkout-isolation contract", async () => {
  const [worktreeGuidance, agentsDoc, docsIndex, coordinatorAgent] = await Promise.all([
    readRepo("docs/worktree-guidance.md"),
    readRepo("AGENTS.md"),
    readRepo("docs/index.md"),
    readRepo("agents/coordinator.agent.md"),
  ]);

  assertMatchesAll(worktreeGuidance, [
    /## Purpose and scope/i,
    /## Canonical location and naming/i,
    /## Default rule: use a worktree for mutating local work/i,
    /## Create or reuse flow/i,
    /## Dependency and install expectations/i,
    /## Coordination and collision checks/i,
    /## Cleanup and prune flow/i,
    /## Fallback when worktrees are unavailable/i,
    /## Non-goals/i,
    /tmp\/worktrees\//i,
    /git worktree list/i,
    /origin\/main/i,
    /npm install|npm ci/i,
    /git worktree remove --force/i,
    /git worktree prune/i,
    /worktrees are unavailable/i,
  ], "docs/worktree-guidance.md");

  assert.match(agentsDoc, /docs\/worktree-guidance\.md/i);
  assert.match(docsIndex, /worktree-guidance\.md/i);

  assertMatchesAll(coordinatorAgent, [
    /docs\/worktree-guidance\.md/i,
    /tmp\/worktrees\/<issue-or-branch-slug>\//i,
    /git worktree list/i,
    /git worktree remove --force/i,
    /git worktree prune/i,
    /worktrees are unavailable/i,
  ], "agents/coordinator.agent.md");
  assert.doesNotMatch(coordinatorAgent, /ONLY use worktrees when they improve isolation/i);
  assert.doesNotMatch(coordinatorAgent, /Prefer the current working tree for a single small task/i);
});


test("phase-truth docs agree that Phase 8 is active and Phase 7 is deferred", async () => {
  const [plan, readme, docsIndex, implementationState, phase7, phase8] = await Promise.all([
    readRepo("PLAN.md"),
    readRepo("README.md"),
    readRepo("docs/index.md"),
    readRepo("docs/IMPLEMENTATION_STATE.md"),
    readRepo("docs/phases/phase-7.md"),
    readRepo("docs/phases/phase-8.md"),
  ]);

  assert.match(plan, /Current active phase[\s\S]*Phase 8/i);
  assert.match(plan, /Phase 7[\s\S]*deferred/i);

  assert.match(readme, /Phase 8 is the active durable phase/i);
  assert.match(readme, /Phase 7 second-repo pilot is deferred/i);

  assert.match(docsIndex, /Active local phase doc[\s\S]*phase-8\.md/i);

  assert.match(implementationState, /Phase 7 second-repo pilot is deferred, not completed/i);
  assert.match(implementationState, /Phase 8 is the active durable phase/i);
  assert.match(implementationState, /explicit deviation from the repo's normal one-phase-at-a-time guidance/i);
  assert.match(implementationState, /Active phase: `phase-8`/i);
  assert.match(implementationState, /Status: `active \(slice-1-implemented; additional Phase 8 closure work pending\)`/i);
  assert.doesNotMatch(implementationState, /Active phase: `phase-7`/i);

  assert.match(phase7, /## Status[\s\S]*deferred/i);
  assert.match(phase7, /Phase 8 was pulled forward ahead of this pilot/i);

  assert.match(phase8, /## Status[\s\S]*active \(slice-1-implemented; additional Phase 8 closure work pending\)/i);
  assert.match(phase8, /Phase 8 was pulled forward ahead of the deferred Phase 7 pilot/i);
  assert.match(phase8, /\.pi\/dev-loop\/defaults\.yaml/i);
  assert.match(phase8, /\.pi\/dev-loop\/settings\.yaml/i);
  assert.doesNotMatch(phase8, /defaults\.json|overrides\.json/i);
});

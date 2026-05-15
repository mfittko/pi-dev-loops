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

test("coordinator agent does not contain stale docs/plans path and requires fresh-context review briefings", async () => {
  const content = await readRepo("agents/coordinator.agent.md");

  assert.doesNotMatch(content, /docs\/plans\//);
  assert.match(content, /Do not fork the parent session for review subagents/i);
  assert.match(content, /concise briefing summary/i);
  assert.match(content, /fresh context/i);
});

test("review workflow documents DRY/KISS/YAGNI as default pre-approval gate with explicit fallback requirement", async () => {
  const [devLoopSkill, copilotSkill, reviewAgent, coordinatorAgent, reviewTemplate, reviewerGraph] = await Promise.all([
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("skills/copilot-dev-loop/SKILL.md"),
    readRepo("agents/review.agent.md"),
    readRepo("agents/coordinator.agent.md"),
    readRepo("skills/dev-loop/templates/review.md"),
    readRepo("docs/reviewer-loop-state-graph.md"),
  ]);

  const gateDocuments = [
    ["skills/dev-loop/SKILL.md", devLoopSkill, /default pre-approval gate/i],
    ["skills/copilot-dev-loop/SKILL.md", copilotSkill, /default pre-approval gate/i],
    ["agents/review.agent.md", reviewAgent, /default pre-approval gate contract/i],
    ["agents/coordinator.agent.md", coordinatorAgent, /default pre-approval review fan-out/i],
    ["skills/dev-loop/templates/review.md", reviewTemplate, /^## Default pre-approval gate \(DRY \/ KISS \/ YAGNI\)$/m],
    ["docs/reviewer-loop-state-graph.md", reviewerGraph, /default pre-approval gate/i],
  ];

  for (const [label, content, gatePhrase] of gateDocuments) {
    assert.match(content, gatePhrase, `${label} should assert the gate phrasing explicitly`);
    assert.match(content, /DRY/i, `${label} should mention the DRY lens`);
    assert.match(content, /KISS/i, `${label} should mention the KISS lens`);
    assert.match(content, /YAGNI/i, `${label} should mention the YAGNI lens`);
  }

  for (const [label, content] of [
    ["skills/dev-loop/SKILL.md", devLoopSkill],
    ["skills/copilot-dev-loop/SKILL.md", copilotSkill],
    ["agents/review.agent.md", reviewAgent],
    ["agents/coordinator.agent.md", coordinatorAgent],
    ["docs/reviewer-loop-state-graph.md", reviewerGraph],
  ]) {
    assert.match(
      content,
      /review-complete, approval-ready, merge-ready, or ready for final handoff/i,
      `${label} should keep the gate boundary wording aligned`,
    );
  }

  assert.match(reviewTemplate, /^## Default pre-approval gate \(DRY \/ KISS \/ YAGNI\)$/m);
  assert.match(reviewTemplate, /fallback note:[^\n]*if parallel execution of the three review lenses is impractical/i);
  assert.match(devLoopSkill, /if parallel execution is impractical[\s\S]*run all three lenses sequentially and explicitly record why parallel execution was impractical/i);
  assert.match(copilotSkill, /fresh context and in parallel when practical/i);
  assert.match(copilotSkill, /if parallel execution is impractical[\s\S]*still run all three lenses and explicitly record the limitation/i);
  assert.match(reviewAgent, /if parallel execution is impractical[\s\S]*still cover all three lenses and explicitly record the limitation/i);
  assert.match(coordinatorAgent, /default pre-approval review fan-out must use the DRY, KISS, and YAGNI lenses/i);
  assert.match(coordinatorAgent, /if parallel execution is impractical[\s\S]*still run all three lenses and record that limitation explicitly/i);
  assert.match(reviewerGraph, /workflow lenses that reviewer\s+runs must cover for the change/i);
  assert.match(reviewerGraph, /do not replace the state machine's supported\s+review-angle taxonomy/i);
});

test("copilot skill still contains its core workflow guidance", async () => {
  const content = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /Before planning, review, or automation:/);
  assert.match(content, /Skill asset path resolution/);
  assert.match(content, /Do not assume `scripts\/\.\.\.` is repo-local to the target codebase/i);
  assert.match(content, /source repository the skill scripts directory is `\.\.\/scripts\//);
  assert.match(content, /Before any GitHub mutation/);
  assert.match(content, /Preferred defaults for this repo:/);
  assert.match(content, /Default validation should match or approximate/);
  assert.match(content, /start each reviewer in fresh context/i);
  assert.match(content, /concise focus-specific briefing summary/i);
  assert.match(content, /do not fork the parent session/i);
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

test("copilot-autopilot skill requires unattended resume-from-state behavior when authorized", async () => {
  const content = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(content, /unattended execution/i);
  assert.match(content, /automatically detect the current lifecycle entrypoint/i);
  assert.match(content, /deterministic helper\/state-machine surface/i);
  assert.match(content, /If a PR already exists, route to the existing PR follow-up path immediately/i);
  assert.match(content, /draft-stage PR tightening \/ local review \/ fix path automatically/i);
  assert.match(content, /pre-existing PR.*not.*stop-by-default condition/is);
  assert.match(content, /continue unattended until the final approval gate/i);
  assert.match(content, /stop for human approval\/merge by default/i);
  assert.match(content, /does \*\*not\*\* imply unattended merge by default/i);
  assert.match(content, /materially unclear, contradictory, off-trail/i);
  assert.match(content, /stop and ask for human direction rather than guessing/i);
  assert.match(content, /local facts, GitHub facts, and helper\/state-machine output do not agree/i);
});

test("copilot-autopilot agent treats autopilot as automatic resume from detected state", async () => {
  const content = await readRepo("agents/copilot-autopilot.agent.md");

  assert.match(content, /Interpret `autopilot` literally/i);
  assert.match(content, /resume from the current GitHub\/PR state automatically/i);
  assert.match(content, /state-machine\/helper surface is the authority/i);
  assert.match(content, /must stay thin/i);
  assert.match(content, /do not restate the skill's phase sequencing or workflow policy here/i);
  assert.match(content, /final approval gate remains a required human-decision stop by default/i);
  assert.match(content, /materially unclear, contradictory, off-trail/i);
  assert.match(content, /stop and ask for human direction rather than guessing/i);
  assert.match(content, /local facts, GitHub facts, and helper\/state-machine output do not agree/i);
  assert.match(content, /not as a reason to halt at every intermediate state-changing step/i);
});

test("copilot-autopilot docs keep issue refinement separate from the phase-scoped refiner and explain thin entrypoint agents", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");
  const agentContent = await readRepo("agents/copilot-autopilot.agent.md");
  const planContent = await readRepo("PLAN.md");

  assert.doesNotMatch(skillContent, /ask the refiner to emit/i);
  assert.doesNotMatch(agentContent, /Use the `refiner` agent for issue-refinement fan-out/i);
  assert.match(skillContent, /issue-refinement specialist/i);
  assert.match(planContent, /Thin workflow entrypoint agents are still allowed/i);
  assert.match(planContent, /must stay thin, defer sequencing and workflow policy to the skill/i);
});

test("copilot-autopilot normalization docs require issue state checks and avoid the stale top-level-workflow roadmap question", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");
  const planContent = await readRepo("PLAN.md");

  assert.match(skillContent, /gh issue view <number> --repo <(?:owner\/name|resolved-repo)> --json number,title,body,state,labels,assignees,milestone/);
  assert.match(skillContent, /If a matching issue exists:[\s\S]*if the matching issue is closed, stop for a user decision[\s\S]*if a PR already exists, route immediately into the existing PR follow-up path/i);
  assert.doesNotMatch(planContent, /remain a mode of `copilot-dev-loop`, or become a separate top-level workflow/i);
});

test("copilot-autopilot docs cover issue URLs, state-all issue search, and abstract ideas without plan docs", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(skillContent, /if the input is a full GitHub issue URL, parse `<owner\/name>` and `<number>`/i);
  assert.match(skillContent, /gh issue view <number> --repo <owner\/name> --json number,title,body,state,labels,assignees,milestone/);
  assert.match(skillContent, /gh issue list --repo <resolved-repo> --state all --search/);
  assert.match(skillContent, /if a governing plan doc or roadmap section actually applies, follow the plan-doc normalization path above/i);
  assert.match(skillContent, /otherwise search existing issues directly/i);
  assert.match(skillContent, /if a matching issue exists, follow the issue-number\/URL normalization path/i);
});

test("copilot-autopilot carries the resolved repo slug through later GitHub issue and PR commands", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(skillContent, /Carry that resolved repo slug through every later GitHub issue\/PR command/i);
  assert.match(skillContent, /gh issue edit <number> --repo <resolved-repo> --body-file <updated-body-file>/);
  assert.match(skillContent, /gh issue edit <number> --repo <resolved-repo> --add-assignee copilot-swe-agent/);
  assert.match(skillContent, /gh pr edit <pr-number> --repo <resolved-repo> --title/);
  assert.match(skillContent, /gh pr ready <pr-number> --repo <resolved-repo>/);
  assert.match(skillContent, /gh pr review <pr-number> --repo <resolved-repo> --approve/);
  assert.match(skillContent, /gh pr merge <pr-number> --repo <resolved-repo> --squash --delete-branch/);
});

test("copilot-autopilot docs define closed-match handling and keep the handoff helper on the resolved repo", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(skillContent, /if the matching issue is closed, stop for a user decision before proceeding/i);
  assert.match(skillContent, /if that matching issue turns out to be closed, stop for a user decision/i);
  assert.match(skillContent, /copilot-pr-handoff\.mjs --repo <resolved-repo> --pr <number>/);
});

test("copilot-autopilot docs define the closed direct-issue branch and keep searches/discovery scoped to the target issue repo", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(skillContent, /If the issue is closed, stop for a user decision before proceeding/i);
  assert.match(skillContent, /gh issue list --repo <resolved-repo> --state all --search/);
  assert.match(skillContent, /detect-linked-issue-pr\.mjs --repo <resolved-repo> --issue <number>/);
  assert.match(skillContent, /treat the helper output as authoritative for linked-PR detection\/selection/i);
  assert.match(skillContent, /If the helper returns an open linked PR in `<resolved-repo>`, resume from that PR and do not retrigger Copilot for the same scope/i);
  assert.doesNotMatch(skillContent, /gh pr list --repo <resolved-repo> --state open --search "copilot\/ <issue-number>"/);
});

test("copilot-autopilot delegates linked-PR detection mechanics to deterministic helper tooling", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");

  assert.match(skillContent, /deterministic linked-PR helper/i);
  assert.match(skillContent, /do not re-implement linked-event query behavior, pagination, repo filtering, or tie-break logic/i);
  assert.match(skillContent, /<resolved-skill-scripts>\/github\/detect-linked-issue-pr\.mjs/i);
  assert.match(skillContent, /do not rely only on PR title\/body containing a literal issue number/i);
  assert.match(skillContent, /treat an open linked PR(?: reported by the helper)? as the active implementation for this issue/i);
});

test("copilot-autopilot docs resolve the target repo for non-issue inputs and README documents thin entrypoint agents", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");
  const readmeContent = await readRepo("README.md");

  assert.match(skillContent, /Resolve the target repository slug for this work item before any GitHub search or mutation/i);
  assert.match(skillContent, /default to the current repository slug/i);
  assert.match(skillContent, /if the plan-doc reference explicitly points at another GitHub repository/i);
  assert.match(skillContent, /resolve `<resolved-repo>` for this work item using the same rule as the plan-doc path/i);
  assert.match(readmeContent, /generic role agents plus thin workflow entrypoint agents where needed/i);
  assert.match(readmeContent, /thin workflow entrypoint agents allowed when they only load a skill and defer policy to it/i);
});

test("copilot-autopilot safety layer contract is documented", async () => {
  const skillContent = await readRepo("skills/copilot-autopilot/SKILL.md");
  const planContent = await readRepo("PLAN.md");

  assert.match(skillContent, /New-idea safety layer \(default contract in this repo\)/);
  assert.match(skillContent, /coordinator owns classification and mutation gating decisions/i);
  assert.match(skillContent, /run classification in fresh context by default/i);
  assert.match(skillContent, /emit a proposal artifact before any GitHub state-changing mutation, including create\/edit\/retitle\/collapse\/link operations/i);
  assert.match(skillContent, /async fan-out \/ fan-in proposal generation by default when practical/i);
  assert.match(skillContent, /default to create-new over overwrite\/update/i);
  assert.match(skillContent, /Deterministic intake \+ mutation-gate state machine/i);

  const stopStatesMarkdownBlock = skillContent.match(/stop states:\s*\n((?:-\s+.+\n)+)/i)?.[1] ?? "";
  const stopStates = stopStatesMarkdownBlock
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^-\s+/, "").trim())
    .sort();
  assert.deepEqual(stopStates, [
    "stopped_explicit_reject",
    "stopped_low_confidence",
    "stopped_overlap_needs_decision",
  ]);

  assert.match(skillContent, /If the Phase 1 preflight verdict is `pause_for_clarification`, stop and ask\./i);
  assert.match(skillContent, /If the intake state machine stops at `stopped_overlap_needs_decision` or `stopped_low_confidence`, stop and ask\./i);
  assert.match(skillContent, /If the intake state machine stops at `stopped_explicit_reject`, stop and record that the proposal was rejected; do not mutate GitHub\./i);
  assert.match(skillContent, /start a separate async coordinator mutation pass that consumes the approved proposal and emits a post-mutation verification artifact/i);
  assert.match(skillContent, /record what the mutation pass actually changed and verify the resulting issue\/artifact state/i);
  assert.match(skillContent, /tmp\/new-idea-intake\/<run-id>\/proposal\.md/i);
  assert.match(skillContent, /tmp\/new-idea-intake\/<run-id>\/proposal\.json/i);
  assert.match(skillContent, /human-readable Markdown proposal/i);
  assert.match(skillContent, /machine-readable JSON snapshot/i);
  assert.match(skillContent, /run a second async coordinator mutation pass/i);
  assert.match(skillContent, /emit a concise post-mutation verification artifact/i);
  assert.match(planContent, /Proposal-first new-idea safety layer/i);
  assert.match(planContent, /stopped_overlap_needs_decision`, `stopped_low_confidence`, `stopped_explicit_reject`/i);
});

test("tracker-first MVP state graph is documented as adapter-agnostic, mutually exclusive, and bounded by #21", async () => {
  const content = await readRepo("docs/tracker-first-mvp-state-graph.md");
  const skillContent = await readRepo("skills/copilot-dev-loop/SKILL.md");

  assert.match(content, /story -> draft PR -> reviewable PR -> merged PR -> tracker sync/i);
  assert.match(content, /issue `#17`/i);
  assert.match(content, /complements? `#21`/i);
  assert.match(content, /one-work-item -> one-PR invariant/i);
  assert.match(content, /Inherited authority boundary from `#21`/i);
  assert.match(content, /source-of-truth ownership/i);
  assert.match(content, /required durable .*work item <-> PR link/i);
  assert.match(content, /reverse-sync semantics/i);
  assert.match(content, /treat this as `false` whenever `actionableReviewFeedbackPresent` is `false`/i);
  assert.match(content, /prClosedUnmerged/i);
  assert.match(content, /PR closed without merge -> `blocked_needs_user_decision`/i);
  assert.match(content, /tracker work item missing -> `blocked_missing_artifact`/i);
  assert.match(content, /highest valid non-blocked state/i);
  assert.match(content, /verification phase/i);
  assert.match(content, /not a new source of truth/i);
  assert.match(content, /Deterministic detection priority/i);
  assert.match(content, /reviewable_pr` vs `waiting_for_review/i);
  assert.match(content, /under_review` vs `waiting_for_ci/i);
  assert.match(content, /waiting_for_ci` applies only when CI is the \*\*only\*\* active blocker/i);
  assert.match(content, /Canonical vs derived vs temporary/i);
  assert.match(content, /epic\/PRD\/ADR\/RFC/i);
  assert.match(content, /narrower than.*`#19`/i);
  assert.doesNotMatch(content, /\bJira\b|\bShortcut\b/i);

  assert.match(skillContent, /inherits[\s\S]*source-of-truth ownership[\s\S]*work item <-> PR link[\s\S]*reverse-sync semantics from\s*`#21`/i);
});

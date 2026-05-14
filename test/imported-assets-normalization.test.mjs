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
  assert.match(skillContent, /gh pr list --repo <resolved-repo> --state open --search "copilot\/ <issue-number>"/);
  assert.match(skillContent, /Verify that any selected PR actually references or closes the normalized issue before continuing/i);
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

  assert.match(skillContent, /If the verdict is `stopped_explicit_reject`, stop and record that the proposal was rejected; do not mutate GitHub\./i);
  assert.match(skillContent, /start a separate async coordinator mutation pass that consumes the approved proposal and emits a post-mutation verification artifact/i);
  assert.match(skillContent, /record what the mutation pass actually changed and verify the resulting issue\/artifact state/i);
  assert.match(skillContent, /human-readable Markdown proposal/i);
  assert.match(skillContent, /machine-readable JSON snapshot/i);
  assert.match(skillContent, /run a second async coordinator mutation pass/i);
  assert.match(skillContent, /emit a concise post-mutation verification artifact/i);
  assert.match(planContent, /Proposal-first new-idea safety layer/i);
  assert.match(planContent, /stopped_overlap_needs_decision`, `stopped_low_confidence`, `stopped_explicit_reject`/i);
});

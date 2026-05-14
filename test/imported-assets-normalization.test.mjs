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
  assert.match(content, /If the PR is draft, continue into the draft-stage tightening\/local-review\/fix path automatically/i);
  assert.match(content, /Treat the final approval gate as a required human-decision stop by default/i);
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
  assert.match(agentContent, /dedicated issue-refinement specialist/i);
  assert.match(planContent, /Thin workflow entrypoint agents are still allowed/i);
  assert.match(planContent, /must stay thin, defer sequencing and workflow policy to the skill/i);
});

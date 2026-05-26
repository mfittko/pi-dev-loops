import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

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
    ["skills/dev-loop/SKILL.md", devLoopSkill, /default pre-approval gate[\s\S]{0,200}\bDRY\b[\s\S]{0,80}\bKISS\b[\s\S]{0,80}\bYAGNI\b/i],
    ["skills/copilot-dev-loop/SKILL.md", copilotSkill, /default pre-approval gate[\s\S]{0,200}\bDRY\b[\s\S]{0,80}\bKISS\b[\s\S]{0,80}\bYAGNI\b/i],
    ["agents/review.agent.md", reviewAgent, /default pre-approval gate contract:[\s\S]{0,160}\bDRY\b[\s\S]{0,80}\bKISS\b[\s\S]{0,80}\bYAGNI\b/i],
    ["agents/coordinator.agent.md", coordinatorAgent, /default pre-approval review fan-out must use the [\s\S]{0,40}\bDRY\b[\s\S]{0,40}\bKISS\b[\s\S]{0,40}\bYAGNI\b lenses/i],
    ["skills/dev-loop/templates/review.md", reviewTemplate, /^## Default pre-approval gate \(DRY \/ KISS \/ YAGNI\)$/m],
    ["docs/reviewer-loop-state-graph.md", reviewerGraph, /default pre-approval gate[\s\S]{0,200}\bDRY\b[\s\S]{0,80}\bKISS\b[\s\S]{0,80}\bYAGNI\b/i],
  ];

  for (const [label, content, gatePhraseWithLenses] of gateDocuments) {
    assert.match(content, gatePhraseWithLenses, `${label} should keep the gate phrasing and lens names aligned`);
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

  assert.match(reviewTemplate, /fallback note:[^\n]*if parallel execution of the three review lenses is impractical/i);
  assert.match(devLoopSkill, /if parallel execution is impractical[\s\S]*run all three lenses sequentially and explicitly record why parallel execution was impractical/i);
  assert.match(copilotSkill, /fresh context and in parallel when practical/i);
  assert.match(copilotSkill, /if parallel execution is impractical[\s\S]*still run all three lenses and explicitly record the limitation/i);
  assert.match(reviewAgent, /if parallel execution is impractical[\s\S]*still cover all three lenses and explicitly record the limitation/i);
  assert.match(coordinatorAgent, /default to three focused lenses \(DRY, KISS, YAGNI\) and run them in parallel when practical/i);
  assert.match(coordinatorAgent, /if parallel execution is impractical[\s\S]*still run all three lenses and record that limitation explicitly/i);
  assert.match(reviewerGraph, /workflow lenses that reviewer\s+runs must cover for the change/i);
  assert.match(reviewerGraph, /do not replace the state machine's supported\s+review-angle taxonomy/i);
});

test("dev-loop skill documents opt-in Playwright smoke harnesses for UI slices", async () => {
  const devLoopSkill = await readRepo("skills/dev-loop/SKILL.md");

  assert.match(devLoopSkill, /user-facing HTML\/UI\/component slices when the user opts in/i);
  assert.match(devLoopSkill, /Playwright WebKit plus screenshot capture/i);
  assert.match(devLoopSkill, /wire it into CI once it becomes required validation for that slice/i);
});

test("repo-wiki manual-first doc describes a real local runnable export path", async () => {
  const content = await readRepo("docs/repo-wiki-manual-first.md");

  assert.match(content, /local runnable `repo-wiki` export path/i);
  assert.match(content, /does \*\*not\*\* claim that `repo-wiki` is ready for npm-based external consumption/i);
  assert.match(content, /plain GitHub-sourced npm install is not sufficient right now/i);
  assert.match(content, /npm install github:mfittko\/repo-wiki#d7e772e3d702a75896a6f4eec574a4e4e5bfa6dd/i);
  assert.match(content, /does \*\*not\*\* include a built `dist\/` CLI payload/i);
  assert.match(content, /scripts\/repo-wiki-local\.mjs/i);
  assert.match(content, /`\.llmwiki\/config\.json`/);
  assert.match(content, /`\.llmwiki\/schema\.md`/);
  assert.match(content, /\.llmwiki\/wiki\//i);
  assert.match(content, /\.tmp\/repo-wiki\//i);
  assert.match(content, /npm run repo-wiki:prepare/i);
  assert.match(content, /npm run repo-wiki:bootstrap/i);
  assert.match(content, /npm run repo-wiki:search -- "dev-loop"/i);
  assert.match(content, /find \.llmwiki\/wiki -maxdepth 1 -type f \| sort/i);
  assert.match(content, /GitHub Wiki publish from this repository/i);
  assert.match(content, /CI automation for wiki export\/publish/i);
});

test("workflow docs keep helper/runtime authority code-owned and dev-loop scope procedure-owned", async () => {
  const [workflowDoc, scriptsReadme, devLoopSkill] = await Promise.all([
    readRepo("docs/IMPLEMENTATION_WORKFLOW.md"),
    readRepo("scripts/README.md"),
    readRepo("skills/dev-loop/SKILL.md"),
  ]);

  assert.match(workflowDoc, /shipped helper\/runtime semantics stay owned by code, tests, and the relevant contract docs/i);
  assert.match(workflowDoc, /`scripts\/README\.md` summarizes those semantics/i);
  assert.match(workflowDoc, /state-graph\/contract docs under `docs\/` remain part of the authoritative shipped contract surface/i);
  assert.match(workflowDoc, /skills and phase docs explain workflow procedure and durable planning intent; they must not silently redefine shipped helper behavior/i);

  assert.match(scriptsReadme, /code, tests, and the helper entrypoints themselves are authoritative for shipped runtime behavior/i);
  assert.match(scriptsReadme, /this README summarizes those contracts for operators and maintainers; if behavior changes, update the code\/tests and then sync this document/i);

  assert.match(devLoopSkill, /this skill owns the local phase procedure and artifact discipline/i);
  assert.match(devLoopSkill, /it does not redefine the shipped runtime semantics of helper CLIs, shared loop logic, or extension commands/i);
});

test("repo docs define dev-loop as the public façade and keep specialized loops as compatibility paths", async () => {
  const [readme, plan, agents, workflowDoc, publicContract, extensionReadme, devLoopSkill, copilotSkill, autopilotSkill] = await Promise.all([
    readRepo("README.md"),
    readRepo("PLAN.md"),
    readRepo("AGENTS.md"),
    readRepo("docs/IMPLEMENTATION_WORKFLOW.md"),
    readRepo("docs/public-dev-loop-contract.md"),
    readRepo("extension/README.md"),
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("skills/copilot-dev-loop/SKILL.md"),
    readRepo("skills/copilot-autopilot/SKILL.md"),
  ]);

  assert.match(publicContract, /single public entrypoint/i);
  assert.match(publicContract, /subagent dev-loop/i);
  assert.match(publicContract, /\/skill:dev-loop/i);
  assert.match(publicContract, /canonical current state/i);
  assert.match(publicContract, /issue_intake/i);
  assert.match(publicContract, /copilot_pr_followup/i);
  assert.match(publicContract, /external_pr_followup/i);
  assert.match(publicContract, /Single-entrypoint convergence posture/i);
  assert.match(publicContract, /Surfaced-UX deprecation readiness bar/i);

  for (const [label, content] of [
    ["README.md", readme],
    ["PLAN.md", plan],
    ["AGENTS.md", agents],
    ["docs/IMPLEMENTATION_WORKFLOW.md", workflowDoc],
  ]) {
    assert.match(content, /`dev-loop`/i, `${label} should mention the public dev-loop entrypoint`);
    assert.match(content, /public/i, `${label} should preserve public-entrypoint framing`);
    assert.match(content, /compatibility|internal/i, `${label} should preserve compatibility/internal framing`);
  }

  assert.match(readme, /single public façade/i, "README should lead with dev-loop as the public façade");
  assert.doesNotMatch(readme, /`copilot-dev-loop` as the/i, "README should not present internal seams as workflow-surface choices");
  assert.doesNotMatch(readme, /`copilot-autopilot` as the/i, "README should not present internal seams as workflow-surface choices");
  assert.match(extensionReadme, /single public workflow entrypoint/i, "extension README should lead with the public entrypoint");
  assert.doesNotMatch(extensionReadme, /\/skill:copilot-dev-loop|\/skill:copilot-autopilot/i, "extension README should not surface internal seam names as readiness choices");

  assert.match(devLoopSkill, /authoritative contract is `docs\/public-dev-loop-contract\.md`/i);
  assert.match(devLoopSkill, /@pi-dev-loops\/core\/loop\/public-dev-loop-routing/i);
  assert.match(devLoopSkill, /summary/i);

  for (const [label, content] of [
    ["skills/copilot-dev-loop/SKILL.md", copilotSkill],
    ["skills/copilot-autopilot/SKILL.md", autopilotSkill],
  ]) {
    assert.match(content, /compatibility\/internal/i, `${label} should preserve compatibility/internal framing`);
    assert.match(content, /public `dev-loop`/i, `${label} should point back to the public dev-loop façade`);
  }
});

test("workflow-surface taxonomy stays explicit and guards the entrypoint asset surface", async () => {
  const [publicContract, devLoopAgent, copilotAgent, autopilotAgent] = await Promise.all([
    readRepo("docs/public-dev-loop-contract.md"),
    readRepo("agents/dev-loop.agent.md"),
    readRepo("agents/copilot-dev-loop.agent.md"),
    readRepo("agents/copilot-autopilot.agent.md"),
  ]);

  assert.match(publicContract, /Workflow-surface taxonomy and guardrails/i);
  assert.match(publicContract, /Public workflow entrypoint/i);
  assert.match(publicContract, /Temporary internal strategy seams/i);
  assert.match(publicContract, /Reusable role agents/i);
  assert.match(publicContract, /single public `dev-loop` entrypoint and its bounded API\/parameter surface/i);
  assert.match(publicContract, /Regression tests must fail if this taxonomy drifts/i);

  assert.match(devLoopAgent, /single public workflow entrypoint/i);
  assert.match(copilotAgent, /compatibility path/i);
  assert.match(autopilotAgent, /compatibility path/i);

  const agentFiles = (await readdir(fromRepoRoot("agents")))
    .filter((name) => name.endsWith(".agent.md"))
    .sort();
  const workflowEntrypointAgents = agentFiles.filter((name) =>
    ["dev-loop.agent.md", "copilot-dev-loop.agent.md", "copilot-autopilot.agent.md"].includes(name),
  );
  const roleAgentFiles = agentFiles.filter((name) => !workflowEntrypointAgents.includes(name));

  assert.deepEqual(workflowEntrypointAgents, [
    "copilot-autopilot.agent.md",
    "copilot-dev-loop.agent.md",
    "dev-loop.agent.md",
  ]);

  for (const roleAgentFile of roleAgentFiles) {
    const content = await readRepo(`agents/${roleAgentFile}`);
    assert.doesNotMatch(content, /public workflow entrypoint/i, `${roleAgentFile} should stay a reusable role agent`);
  }

  const userInvocableSkillEntrypoints = [];
  for (const skillDir of (await readdir(fromRepoRoot("skills"))).sort().filter((name) => !name.startsWith("."))) {
    const content = await readRepo(`skills/${skillDir}/SKILL.md`);
    if (/^user-invocable:\s*true\s*$/m.test(content)) {
      userInvocableSkillEntrypoints.push(skillDir);
    }
  }
  assert.deepEqual(userInvocableSkillEntrypoints, ["copilot-autopilot", "copilot-dev-loop", "dev-loop"]);
});

test("status reporting contract requires authoritative state-first resolution and fail-closed reconcile behavior", async () => {
  const [publicContract, devLoopSkill, copilotSkill] = await Promise.all([
    readRepo("docs/public-dev-loop-contract.md"),
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("skills/copilot-dev-loop/SKILL.md"),
  ]);

  assert.match(publicContract, /Authoritative-state-first status reporting contract/i);
  assert.match(publicContract, /fail closed to reconcile\/unknown instead of guessing/i);
  assert.match(publicContract, /resolveAuthoritativeDevLoopStatus/i);
  assert.match(publicContract, /issue↔PR linkage resolution/i);
  assert.match(publicContract, /detect-linked-issue-pr\.mjs/i);

  assert.match(devLoopSkill, /status\/progress\/readiness\/merge-state\/next-step/i);
  assert.match(devLoopSkill, /fail closed to reconcile\/unknown/i);
  assert.match(devLoopSkill, /issue↔PR linkage resolution/i);
  assert.match(devLoopSkill, /detect-linked-issue-pr\.mjs/i);

  assert.match(copilotSkill, /status\/progress\/readiness\/merge-state\/next-step/i);
  assert.match(copilotSkill, /reconcile\/unknown instead of guessing from chat context/i);
  assert.match(copilotSkill, /do not assert "no open PR" until authoritative issue↔PR linkage is resolved/i);
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
  assert.match(content, /if that local validation is still known red, continue remediation instead of re-requesting Copilot/);
  assert.match(content, /if GitHub CI\/checks for the updated head are known red for a fixable issue, continue remediation instead of re-requesting Copilot/);
  assert.match(content, /only once the updated head is green or credibly green, explicitly re-request Copilot review for the new head/);
  assert.match(content, /wait\/watch loop if the request result is confirmed as `requested` or `already-requested`/);
  assert.match(content, /`requested`: if another Copilot pass is actually desired/);
  assert.match(content, /`already-requested`: if another Copilot pass is actually desired/);
  assert.match(content, /`unavailable`: report the limitation and stop/);
  assert.match(content, /stop and report the error rather than (?:entering a sleep\/watch loop|sleeping and hoping for a new review)/);
  assert.match(content, /keep commit SHAs and issue\/PR refs as plain text/i);
  assert.match(content, /do not wrap them in backticks/i);
  assert.match(content, /backticks for actual code\/path\/CLI literals only/i);
});

test("fixer agent documentation includes GitHub autolink guidance", async () => {
  const content = await readRepo("agents/fixer.agent.md");

  assert.match(content, /keep commit SHAs and issue\/PR refs unwrapped/i);
  assert.match(content, /intent is GitHub autolinks/i);
  assert.match(content, /reserve backticks for actual code\/path\/CLI literals/i);
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
  assert.match(content, /If a PR already exists, classify the post-assignment seam before follow-up/i);
  assert.match(content, /waiting_for_initial_copilot_implementation.*keep waiting/i);
  assert.match(content, /linked_pr_ready_for_followup.*route to the existing PR follow-up path immediately/i);
  assert.match(content, /When the draft PR appears, classify whether it is still the bootstrap-only Copilot draft/i);
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

test("issue-based shorthand auto dev-loop trigger is documented as one public intent through the final approval gate", async () => {
  const [readme, publicContract, devLoopSkill, autopilotSkill, devLoopAgent, autopilotAgent] = await Promise.all([
    readRepo("README.md"),
    readRepo("docs/public-dev-loop-contract.md"),
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("skills/copilot-autopilot/SKILL.md"),
    readRepo("agents/dev-loop.agent.md"),
    readRepo("agents/copilot-autopilot.agent.md"),
  ]);

  for (const content of [readme, publicContract, devLoopSkill, autopilotSkill, devLoopAgent, autopilotAgent]) {
    assert.match(content, /auto dev loop on issue/i);
  }

  assert.match(readme, /enter copilot auto dev loop on issue/i);
  assert.match(readme, /run auto dev loop on 112 until approval gate/i);
  assert.match(readme, /same public `dev-loop` intent/i);

  assert.match(publicContract, /Issue-based shorthand auto trigger contract/i);
  assert.match(publicContract, /same bounded public `dev-loop` intent/i);
  assert.match(publicContract, /`dev-loop --intent auto_continue_current`/i);
  assert.match(publicContract, /stop at the final human approval gate by default/i);

  assert.match(devLoopSkill, /Shorthand issue-based auto trigger contract/i);
  assert.match(devLoopSkill, /same public `dev-loop` intent \(`auto_continue_current`\)/i);
  assert.match(devLoopSkill, /do not treat compatibility wording .* as a second public entrypoint/i);
  assert.match(devLoopSkill, /stop at the final human approval gate by default/i);

  assert.match(autopilotSkill, /interpret them as compatibility wording for the same public `dev-loop` intent/i);
  assert.match(autopilotSkill, /preserve this same stop boundary and final human approval gate default/i);

  assert.match(devLoopAgent, /Interpret issue-based shorthand triggers/i);
  assert.match(devLoopAgent, /not a second public workflow entrypoint/i);
  assert.match(autopilotAgent, /treat it as compatibility wording for the same public `dev-loop` intent/i);
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
  assert.match(skillContent, /If a matching issue exists:[\s\S]*if the matching issue is closed, stop for a user decision[\s\S]*if a PR already exists, classify bootstrap-wait versus follow-up/i);
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
  assert.match(skillContent, /detect-initial-copilot-pr-state\.mjs --repo <resolved-repo> --issue <number>/i);
  assert.match(skillContent, /waiting_for_initial_copilot_implementation.*keep waiting/i);
  assert.match(skillContent, /linked_pr_ready_for_followup.*resume from that PR/i);
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

test("copilot review gates use self-contained parallel contracts with explicit angle ownership", async () => {
  const [autopilotSkill, copilotDevLoopSkill] = await Promise.all([
    readRepo("skills/copilot-autopilot/SKILL.md"),
    readRepo("skills/copilot-dev-loop/SKILL.md"),
  ]);

  const autopilotPhase6Match = autopilotSkill.match(/## Phase 6 — Local review\/fix loop[\s\S]*?(?=\n## Phase 7|$)/);
  const autopilotPhase6 = autopilotPhase6Match ? autopilotPhase6Match[0] : "";
  assert.ok(autopilotPhase6.length > 0, "copilot-autopilot Phase 6 section not found");

  const autopilotPhase7Match = autopilotSkill.match(/## Phase 7 — Copilot review loop[\s\S]*?(?=\n## Phase 8|$)/);
  const autopilotPhase7 = autopilotPhase7Match ? autopilotPhase7Match[0] : "";
  assert.ok(autopilotPhase7.length > 0, "copilot-autopilot Phase 7 section not found");

  const devLoopStep7Match = copilotDevLoopSkill.match(/## Step 7: Pi review\/fix follow-up loop[\s\S]*?(?=\n## Step 8|$)/);
  const devLoopStep7 = devLoopStep7Match ? devLoopStep7Match[0] : "";
  assert.ok(devLoopStep7.length > 0, "copilot-dev-loop Step 7 section not found");

  // Extract gate sections for scoped assertions
  const autopilotDraftGateMatch = autopilotPhase6.match(/### Draft gate contract[\s\S]*?(?=\n## |\n### |$)/);
  const autopilotDraftGate = autopilotDraftGateMatch ? autopilotDraftGateMatch[0] : "";
  assert.ok(autopilotDraftGate.length > 0, "copilot-autopilot draft-gate section not found inside Phase 6");

  const devLoopDraftGateMatch = devLoopStep7.match(/### Draft gate contract[\s\S]*?(?=\n### |$)/);
  const devLoopDraftGate = devLoopDraftGateMatch ? devLoopDraftGateMatch[0] : "";
  assert.ok(devLoopDraftGate.length > 0, "copilot-dev-loop draft-gate section not found inside Step 7");

  const autopilotPreApprovalMatch = autopilotPhase7.match(/### Pre-approval gate contract[\s\S]*?(?=\n## |\n### |$)/);
  const autopilotPreApproval = autopilotPreApprovalMatch ? autopilotPreApprovalMatch[0] : "";
  assert.ok(autopilotPreApproval.length > 0, "copilot-autopilot pre-approval gate section not found inside Phase 7");

  const devLoopPreApprovalMatch = devLoopStep7.match(/### Pre-approval gate contract[\s\S]*?(?=\n## |\n### |$)/);
  const devLoopPreApproval = devLoopPreApprovalMatch ? devLoopPreApprovalMatch[0] : "";
  assert.ok(devLoopPreApproval.length > 0, "copilot-dev-loop pre-approval gate section not found inside Step 7");

  const expectedContractShape = [/Gate name:/i, /Trigger \/ boundary:/i, /Review angles \(owned by this gate\):/i, /Pass criteria:/i, /Next step after passing:/i];
  for (const [label, section] of [
    ["copilot-autopilot draft gate", autopilotDraftGate],
    ["copilot-autopilot pre-approval gate", autopilotPreApproval],
    ["copilot-dev-loop draft gate", devLoopDraftGate],
    ["copilot-dev-loop pre-approval gate", devLoopPreApproval],
  ]) {
    for (const shapePart of expectedContractShape) {
      assert.match(section, shapePart, `${label} should include contract field ${shapePart}`);
    }
    assert.doesNotMatch(section, /Gate role:/i, `${label} should not introduce extra template-only fields that drift across gates`);
  }

  const draftAnglePatterns = [/correctness.*acceptance criteria/i, /scope compliance/i, /test coverage/i, /ci.*check|check.*status/i, /no unrelated files/i];
  const preApprovalAnglePatterns = [/\bDRY\b/, /\bKISS\b/, /\bYAGNI\b/];

  const autopilotDraftOwnedAnglesMatch = autopilotDraftGate.match(/Review angles \(owned by this gate\):[\s\S]*?(?=\n- \*\*Pass criteria)/i);
  const autopilotDraftOwnedAngles = autopilotDraftOwnedAnglesMatch ? autopilotDraftOwnedAnglesMatch[0] : "";
  const devLoopDraftOwnedAnglesMatch = devLoopDraftGate.match(/Review angles \(owned by this gate\):[\s\S]*?(?=\n- \*\*Pass criteria)/i);
  const devLoopDraftOwnedAngles = devLoopDraftOwnedAnglesMatch ? devLoopDraftOwnedAnglesMatch[0] : "";
  const autopilotPreApprovalOwnedAnglesMatch = autopilotPreApproval.match(/Review angles \(owned by this gate\):[\s\S]*?(?=\n- \*\*Pass criteria)/i);
  const autopilotPreApprovalOwnedAngles = autopilotPreApprovalOwnedAnglesMatch ? autopilotPreApprovalOwnedAnglesMatch[0] : "";
  const devLoopPreApprovalOwnedAnglesMatch = devLoopPreApproval.match(/Review angles \(owned by this gate\):[\s\S]*?(?=\n- \*\*Pass criteria)/i);
  const devLoopPreApprovalOwnedAngles = devLoopPreApprovalOwnedAnglesMatch ? devLoopPreApprovalOwnedAnglesMatch[0] : "";

  for (const pattern of draftAnglePatterns) {
    assert.match(autopilotDraftOwnedAngles, pattern);
    assert.match(devLoopDraftOwnedAngles, pattern);
  }
  for (const pattern of preApprovalAnglePatterns) {
    assert.match(autopilotPreApprovalOwnedAngles, pattern);
    assert.match(devLoopPreApprovalOwnedAngles, pattern);
  }

  for (const pattern of preApprovalAnglePatterns) {
    assert.doesNotMatch(autopilotDraftOwnedAngles, pattern);
    assert.doesNotMatch(devLoopDraftOwnedAngles, pattern);
  }
  for (const pattern of draftAnglePatterns) {
    assert.doesNotMatch(autopilotPreApprovalOwnedAngles, pattern);
    assert.doesNotMatch(devLoopPreApprovalOwnedAngles, pattern);
  }

  assert.match(autopilotPhase6, /delegation to `copilot-dev-loop` covers fix-loop mechanics only/i);
  assert.match(autopilotPhase6, /not review-angle inheritance/i);
});

test("copilot-dev-loop skill keeps async watch persistence explicit", async () => {
  const [skillContent, scriptsReadme, stateGraph] = await Promise.all([
    readRepo("skills/copilot-dev-loop/SKILL.md"),
    readRepo("scripts/README.md"),
    readRepo("docs/copilot-loop-state-graph.md"),
  ]);

  assert.match(skillContent, /run-copilot-watch-cycle\.mjs/i);
  assert.match(skillContent, /zero-timeout `idle` probes are for explicit one-shot status\/reattach checks only/i);
  assert.match(skillContent, /returning to `waiting_for_copilot_review` is a persistence boundary: resume the watcher instead of reporting completion/i);
  assert.match(skillContent, /persistent async watch\/fix loop, not handoff-only behavior/i);
  assert.match(skillContent, /if `cycleDisposition` is `pending` and `terminal` is `false`, stay attached to the same PR and resume another watch boundary/i);
  assert.match(skillContent, /if the user explicitly asks for async handoff-only behavior/i);
  assert.match(scriptsReadme, /`cycleDisposition: "pending"` with `terminal: false` means stay attached and run another watch boundary rather than exiting as clean success/i);
  assert.match(scriptsReadme, /handoff-only behavior must be explicitly requested/i);
  assert.match(stateGraph, /`waiting_for_copilot_review` is a persistence boundary for explicit async loop entry/i);
  assert.match(stateGraph, /If the next deterministic state returns to `waiting_for_copilot_review`, resume watch mode again instead of treating the re-request handoff as the end of the async run/i);
});

test("copilot-dev-loop agent is a thin executable entrypoint that defers to the skill", async () => {
  const content = await readRepo("agents/copilot-dev-loop.agent.md");

  assert.match(content, /name:\s*"copilot-dev-loop"/);
  assert.match(content, /user-invocable:\s*true/);
  assert.match(content, /skills\/copilot-dev-loop\/SKILL\.md/);
  assert.match(content, /must stay thin/i);
  assert.match(content, /do not restate the skill's phase sequencing or workflow policy here/i);
  assert.match(content, /state-machine.*helper.*authority|deterministic.*state-machine/i);
  assert.match(content, /stop and ask for human direction rather than guessing/i);
  assert.match(content, /local facts, GitHub facts, and helper\/state-machine output do not agree/i);
});

test("public dev-loop agent is a thin executable entrypoint that defers to the public skill router", async () => {
  const [agentContent, skillContent] = await Promise.all([
    readRepo("agents/dev-loop.agent.md"),
    readRepo("skills/dev-loop/SKILL.md"),
  ]);

  assert.match(agentContent, /name:\s*"dev-loop"/);
  assert.match(agentContent, /user-invocable:\s*true/);
  assert.match(agentContent, /skills\/dev-loop\/SKILL\.md/);
  assert.match(agentContent, /must stay thin/i);
  assert.match(agentContent, /do not restate the skill's phase sequencing or workflow policy here/i);
  assert.match(agentContent, /deterministic public routing contract/i);
  assert.match(agentContent, /copilot-dev-loop/i);
  assert.match(agentContent, /copilot-autopilot/i);
  assert.match(agentContent, /stop and ask for human direction rather than guessing/i);
  assert.match(agentContent, /local facts, GitHub facts, and helper\/state-machine output do not agree/i);
  assert.match(skillContent, /public `dev-loop` façade/i);
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

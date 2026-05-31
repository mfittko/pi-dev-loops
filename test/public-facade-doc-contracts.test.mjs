import {
  assert,
  fromRepoRoot,
  parseFrontmatter,
  readRepo,
  readdir,
  stat,
  test,
  USER_FACING_AGENT_SURFACE,
} from "./imported-assets-helpers.mjs";

test("installed skill guidance owns packaging guarantees and contract docs stay contract-focused", async () => {
  const [devLoopSkill, copilotSkill, publicContract, retrospectiveContract, projectionContract] = await Promise.all([
    readRepo(".pi/skills/dev-loop/SKILL.md"),
    readRepo(".pi/skills/copilot-dev-loop/SKILL.md"),
    readRepo("skills/docs/public-dev-loop-contract.md"),
    readRepo("skills/docs/retrospective-checkpoint-contract.md"),
    readRepo("skills/docs/conductor-pr-projection-contract.md"),
  ]);

  assert.match(devLoopSkill, /Required installed runtime contract docs/i);
  assert.match(devLoopSkill, /shared bundled copies under `\.\.\/docs\/` from this skill directory/i);
  assert.match(devLoopSkill, /read those bundled `\.\.\/docs\/` files from the installed skill layout/i);
  assert.match(devLoopSkill, /packaging\/installer bug/i);

  assert.match(copilotSkill, /Required bundled runtime contract docs for installed copies of this skill/i);
  assert.match(copilotSkill, /required bundled contract docs live under the shared `\.\.\/docs\/` directory next to the installed skill directories/i);
  assert.match(copilotSkill, /do not assume helper scripts are bundled unless that installed layout actually contains them/i);
  assert.match(copilotSkill, /Read those bundled `\.\.\/docs\/` files from the installed skill layout/i);
  assert.match(copilotSkill, /packaging\/installer bug/i);
  assert.match(publicContract, /canonical owner lives in the shipped `skills\/docs\/` surface/i);
  assert.match(publicContract, /installed skill\/runtime consumers reliably own the skills subtree/i);
  assert.match(publicContract, /read the same contract via `\.\.\/docs\/public-dev-loop-contract\.md` from the installed skill directory/i);

  for (const [label, content] of [
    ["skills/docs/public-dev-loop-contract.md", publicContract],
    ["skills/docs/retrospective-checkpoint-contract.md", retrospectiveContract],
    ["skills/docs/conductor-pr-projection-contract.md", projectionContract],
  ]) {
    assert.doesNotMatch(content, /Packaged \/ installed skill use|Packaged \/ installed agent use/i, `${label} should not restate the shared install contract block`);
    assert.doesNotMatch(content, /required runtime contract doc for installed/i, `${label} should not duplicate install-contract ownership prose`);
    assert.doesNotMatch(content, /source-tree canonical ownership/i, `${label} should not duplicate install-contract ownership prose`);
    assert.doesNotMatch(content, /shared installed copy resolved as `\.\.\/docs\//i, `${label} should not duplicate install-contract ownership prose`);
    assert.doesNotMatch(content, /packaging\/installer bug/i, `${label} should not duplicate install-contract ownership prose`);
  }
});

test("root docs path does not become a second semantic owner for the public dev-loop contract", async () => {
  const rootContractPath = fromRepoRoot("docs/public-dev-loop-contract.md");
  const rootContractExists = await stat(rootContractPath).then(() => true).catch(() => false);

  if (!rootContractExists) {
    return;
  }

  const rootContract = await readRepo("docs/public-dev-loop-contract.md");
  assert.match(rootContract, /skills\/docs\/public-dev-loop-contract\.md/i);
  assert.doesNotMatch(rootContract, /canonical authority/i);
  assert.doesNotMatch(rootContract, /canonical public-contract owner/i);
  assert.match(rootContract, /pointer|summary|summarize|summarise/i);
  assert.match(rootContract, /must not redefine/i);
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

test("README stays a landing page and lets docs/index own deeper doc navigation", async () => {
  const readme = await readRepo("README.md");

  assert.doesNotMatch(readme, /^## Current status$/im, "README should not become a second owner for the live execution snapshot");
  assert.match(readme, /docs\/index\.md/i, "README should point readers to the docs index");
  assert.doesNotMatch(readme, /docs\/IMPLEMENTATION_STATE\.md/i, "README should not duplicate docs/index deep links for the implementation snapshot");
  assert.doesNotMatch(readme, /docs\/IMPLEMENTATION_WORKFLOW\.md/i, "README should not duplicate docs/index deep links for workflow docs");
  assert.match(readme, /private, source-loaded workspace/i, "README should keep the repo posture concise without a separate status section");
});

test("repo docs define dev-loop as the public façade and keep internal routed logic behind it", async () => {
  const [readme, plan, agents, workflowDoc, publicContract, extensionReadme, devLoopSkill, copilotSkill] = await Promise.all([
    readRepo("README.md"),
    readRepo("PLAN.md"),
    readRepo("AGENTS.md"),
    readRepo("docs/IMPLEMENTATION_WORKFLOW.md"),
    readRepo("skills/docs/public-dev-loop-contract.md"),
    readRepo("extension/README.md"),
    readRepo("skills/dev-loop/SKILL.md"),
    readRepo("skills/copilot-dev-loop/SKILL.md"),
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
    assert.match(content, /internal|canonical/i, `${label} should preserve internal/canonical framing`);
  }

  assert.match(readme, /single public façade/i, "README should lead with dev-loop as the public façade");
  assert.doesNotMatch(readme, /`copilot-dev-loop` as the/i, "README should not present internal seams as workflow-surface choices");
  assert.doesNotMatch(readme, /`copilot-autopilot` as the/i, "README should not present internal seams as workflow-surface choices");
  assert.match(extensionReadme, /single public workflow entrypoint/i, "extension README should lead with the public entrypoint");
  assert.doesNotMatch(extensionReadme, /\/skill:copilot-dev-loop|\/skill:copilot-autopilot/i, "extension README should not surface internal seam names as readiness choices");

  assert.match(devLoopSkill, /authoritative contract is `skills\/docs\/public-dev-loop-contract\.md`/i);
  assert.match(devLoopSkill, /@pi-dev-loops\/core\/loop\/public-dev-loop-routing/i);
  assert.match(devLoopSkill, /summary/i);

  assert.match(copilotSkill, /canonical internal/i, "skills/copilot-dev-loop/SKILL.md should preserve canonical-internal framing");
  assert.match(copilotSkill, /public `dev-loop`/i, "skills/copilot-dev-loop/SKILL.md should point back to the public dev-loop façade");
});

test("workflow-surface taxonomy stays explicit and guards the entrypoint asset surface", async () => {
  const [publicContract, devLoopAgent] = await Promise.all([
    readRepo("skills/docs/public-dev-loop-contract.md"),
    readRepo("agents/dev-loop.agent.md"),
  ]);

  assert.match(publicContract, /Workflow-surface taxonomy and guardrails/i);
  assert.match(publicContract, /Public workflow entrypoint/i);
  assert.match(publicContract, /Internal routed strategy modules/i);
  assert.match(publicContract, /Reusable role agents/i);
  assert.match(publicContract, /specialized Copilot behavior stays internal-only behind `dev-loop`/i);
  assert.match(publicContract, /Regression tests must fail if this taxonomy drifts/i);

  assert.match(devLoopAgent, /single public workflow entrypoint/i);

  const agentFiles = (await readdir(fromRepoRoot("agents")))
    .filter((name) => name.endsWith(".agent.md"))
    .sort();
  const agentEntries = await Promise.all(agentFiles.map(async (file) => {
    const content = await readRepo(`agents/${file}`);
    const frontmatter = parseFrontmatter(content);
    return {
      file,
      content,
      name: frontmatter.name,
      userInvocable: frontmatter["user-invocable"] === true,
    };
  }));
  const userFacingAgents = agentEntries
    .filter(({ userInvocable }) => userInvocable)
    .sort((a, b) => a.name.localeCompare(b.name));
  const allowedUserFacingAgentNames = Object.keys(USER_FACING_AGENT_SURFACE).sort();

  assert.deepEqual(
    userFacingAgents.map(({ name }) => name).sort(),
    allowedUserFacingAgentNames,
    "user-facing agent surface should stay explicitly allow-listed by frontmatter name",
  );

  const workflowEntrypointAgents = userFacingAgents
    .filter(({ name }) => USER_FACING_AGENT_SURFACE[name]?.kind === "workflow-entrypoint")
    .map(({ name }) => name)
    .sort();
  const roleAgentFiles = agentEntries
    .filter(({ name }) => USER_FACING_AGENT_SURFACE[name]?.kind !== "workflow-entrypoint")
    .map(({ file }) => file)
    .sort();

  assert.deepEqual(workflowEntrypointAgents, ["dev-loop"]);
  assert.equal(agentFiles.includes("copilot-dev-loop.agent.md"), false);
  assert.equal(agentFiles.includes("copilot-autopilot.agent.md"), false);

  for (const roleAgentFile of roleAgentFiles) {
    const content = await readRepo(`agents/${roleAgentFile}`);
    assert.doesNotMatch(content, /public workflow entrypoint/i, `${roleAgentFile} should stay a reusable role agent`);
  }

  const userInvocableSkillEntrypoints = [];
  for (const skillDir of (await readdir(fromRepoRoot("skills"))).sort().filter((name) => !name.startsWith("."))) {
    if (skillDir === "docs") {
      continue;
    }
    const content = await readRepo(`skills/${skillDir}/SKILL.md`);
    if (/^user-invocable:\s*true\s*$/m.test(content)) {
      userInvocableSkillEntrypoints.push(skillDir);
    }
  }
  assert.deepEqual(userInvocableSkillEntrypoints, ["dev-loop"]);
  assert.match(await readRepo("skills/copilot-dev-loop/SKILL.md"), /^user-invocable:\s*false\s*$/m);
  assert.equal((await readdir(fromRepoRoot("skills"))).includes("copilot-autopilot"), false);
});

test("status reporting contract requires authoritative state-first resolution and fail-closed reconcile behavior", async () => {
  const [publicContract, devLoopSkill, copilotSkill] = await Promise.all([
    readRepo("skills/docs/public-dev-loop-contract.md"),
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
  assert.match(publicContract, /only canonical active artifact for the issue during follow-up/i);
  assert.match(devLoopSkill, /single canonical artifact for the issue and reuse it instead of opening another PR/i);
  assert.match(copilotSkill, /do not open another PR unless the prior PR was explicitly superseded and reconciled first/i);
  assert.match(copilotSkill, /reuse\/update that canonical PR instead of opening another one/i);
});

test("public dev-loop contract keeps conflict reconciliation local and context-first", async () => {
  const publicContract = await readRepo("skills/docs/public-dev-loop-contract.md");

  assert.match(publicContract, /Conflict reconciliation path \(`CONFLICTING` \/ `DIRTY`\)/i);
  assert.match(publicContract, /bounded local-agent reconciliation path/i);
  assert.match(publicContract, /retrieve authoritative context at minimum:/i);
  assert.match(publicContract, /latest `origin\/main`/i);
  assert.match(publicContract, /current PR head SHA and effective PR diff/i);
  assert.match(publicContract, /issue\/PR scope and acceptance criteria/i);
  assert.match(publicContract, /current-head gate evidence and relevant unresolved review feedback/i);
  assert.match(publicContract, /if required authoritative context is missing, stale for the current head, or contradictory, fail closed to reconcile/i);
  assert.match(publicContract, /resolve the conflict locally on the PR branch/i);
  assert.match(publicContract, /rerun required local validation, gate checks, and required CI checks for the new head before approval\/merge evaluation/i);
  assert.doesNotMatch(publicContract, /resolve the conflict .*blind merge\/update step/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("package metadata exposes the extension entrypoint and root extension test script", async () => {
  const packageJson = JSON.parse(await readRepo("package.json"));

  assert.deepEqual(packageJson.pi.extensions, ["./extension/index.ts"]);
  assert.equal(packageJson.bin["pi-dev-loops"], "./cli/index.mjs");
  assert.match(packageJson.engines.node, />=20/);
  assert.equal(typeof packageJson.peerDependencies["@mariozechner/pi-coding-agent"], "string");
  assert.equal(typeof packageJson.peerDependencies["@mariozechner/pi-tui"], "string");
  assert.equal(typeof packageJson.scripts["test:extension"], "string");
  assert.match(packageJson.scripts["test:extension"], /--import tsx/);
  assert.match(packageJson.scripts["test:extension"], /extension-checks/);
  assert.match(packageJson.scripts["test:extension"], /extension-command-contract/);
  assert.match(packageJson.scripts["test:extension"], /extension-package-contract/);
  assert.equal(packageJson.dependencies.mermaid, "11.15.0");
  assert.deepEqual(packageJson.pi.skills, [".pi/skills"]);
});

test("extension README documents the command surface and runtime/build/test contract", async () => {
  const readme = await readRepo("extension/README.md");

  assert.match(readme, /defaults to help output/i);
  assert.match(readme, /\/dev-loops status/i);
  assert.match(readme, /pi-dev-loops status/i);
  assert.match(readme, /concise readiness summary/i);
  assert.match(readme, /\/dev-loops doctor/i);
  assert.match(readme, /full diagnostic report/i);
  assert.match(readme, /pi install git:github.com\/mfittko\/pi-dev-loops/i);
  assert.match(readme, /pi install -l git:github.com\/mfittko\/pi-dev-loops/i);
  assert.match(readme, /pi update git:github.com\/mfittko\/pi-dev-loops/i);
  assert.match(readme, /Node[^\n]*>=20/i);
  assert.match(readme, /source-loaded/i);
  assert.match(readme, /package\.json` `pi\.skills`/i);
  assert.match(readme, /\.pi\/agents\/\*\.agent\.md/i);
  assert.match(readme, /~\/\.agents/i);
  assert.match(readme, /single public workflow entry/i);
  assert.match(readme, /readiness surface should not present them as separate user-facing checks/i);
  assert.match(readme, /are removed; use `pi install` \/ `pi update` directly instead/i);
  assert.doesNotMatch(readme, /\/skill:copilot-dev-loop|\/skill:copilot-autopilot/i);
  assert.match(readme, /node --import tsx --test/i);
  assert.match(readme, /does not yet claim a specific supported `gh` version/i);
  assert.match(readme, /npm run verify/i);
  assert.match(readme, /npm run test:extension/i);
  assert.match(readme, /npm run test:dev-loop/i);
  assert.match(readme, /npm run test:playwright:viewer/i);
});

const REQUIRED_SKILL_CONTRACT_DOCS = [
  "public-dev-loop-contract.md",
  "retrospective-checkpoint-contract.md",
  "conductor-pr-projection-contract.md",
];

const INSTALLED_SKILLS = ["dev-loop", "copilot-dev-loop"];

test("installed skill layouts include required contract docs in docs/ subdirectory", async () => {
  for (const skill of INSTALLED_SKILLS) {
    for (const doc of REQUIRED_SKILL_CONTRACT_DOCS) {
      await assert.doesNotReject(
        access(fromRepoRoot(`.pi/skills/${skill}/docs/${doc}`)),
        `required contract doc ${doc} must exist in installed .pi/skills/${skill}/docs/`,
      );
    }
  }
});

test("installed skill contract docs match the source docs", async () => {
  for (const skill of INSTALLED_SKILLS) {
    for (const doc of REQUIRED_SKILL_CONTRACT_DOCS) {
      const installedContent = await readRepo(`.pi/skills/${skill}/docs/${doc}`);
      const sourceContent = await readRepo(`docs/${doc}`);
      assert.equal(
        installedContent,
        sourceContent,
        `installed .pi/skills/${skill}/docs/${doc} must match source docs/${doc}`,
      );
    }
  }
});

test("dev-loop SKILL.md documents the installed-docs path resolution guarantee", async () => {
  const skill = await readRepo(".pi/skills/dev-loop/SKILL.md");
  assert.match(skill, /ship with this skill in the installed layout and are guaranteed to be present/i);
  assert.match(skill, /docs\/public-dev-loop-contract\.md/);
  assert.match(skill, /docs\/retrospective-checkpoint-contract\.md/);
  assert.match(skill, /docs\/conductor-pr-projection-contract\.md/);
  assert.match(skill, /in an installed skill copy they live at `docs\/` inside the skill directory/);
  assert.match(skill, /skills\/dev-loop.*`\.\.\/docs\/`/s);
});

test("copilot-dev-loop SKILL.md documents the installed-docs path resolution guarantee", async () => {
  const skill = await readRepo(".pi/skills/copilot-dev-loop/SKILL.md");
  assert.match(skill, /are guaranteed to ship with this skill in the installed layout/i);
  assert.match(skill, /docs\/public-dev-loop-contract\.md/);
  assert.match(skill, /docs\/retrospective-checkpoint-contract\.md/);
  assert.match(skill, /docs\/conductor-pr-projection-contract\.md/);
  assert.match(skill, /skills\/copilot-dev-loop.*`\.\.\/scripts\/`.*`\.\.\/docs\/`/s);
  assert.match(skill, /packaging\/installer bug/i);
});

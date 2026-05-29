import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("install/update/skill-discovery docs align on the current package-install contract", async () => {
  const [readme, plan, phase7, extensionReadme] = await Promise.all([
    readRepo("README.md"),
    readRepo("PLAN.md"),
    readRepo("docs/phases/phase-7.md"),
    readRepo("extension/README.md"),
  ]);

  for (const [file, content] of [
    ["README.md", readme],
    ["PLAN.md", plan],
    ["docs/phases/phase-7.md", phase7],
    ["extension/README.md", extensionReadme],
  ]) {
    assert.match(
      content,
      /pi install git:github.com\/mfittko\/pi-dev-loops/i,
      `${file} should point operators to pi install`,
    );
  }

  assert.match(readme, /Current commands:\n- `\/dev-loops`[\s\S]*?- `\/dev-loops status`[\s\S]*?- `\/dev-loops doctor`[\s\S]*?- `\/dev-loops hide`/i);
  assert.doesNotMatch(
    readme,
    /Current commands:\n(?:- .+\n){0,8}- `\/dev-loops install`[\s\S]*\/dev-loops update/i,
    "README should not list removed install/update names as current commands",
  );

  for (const [file, content] of [
    ["README.md", readme],
    ["PLAN.md", plan],
    ["docs/phases/phase-7.md", phase7],
    ["extension/README.md", extensionReadme],
  ]) {
    assert.match(content, /\/dev-loops install/i, `${file} should mention the removed install name explicitly`);
    assert.match(content, /\/dev-loops update/i, `${file} should mention the removed update name explicitly`);
    assert.match(content, /removed/i, `${file} should say the legacy names are removed`);
    assert.match(content, /pi update/i, `${file} should point to pi update instead`);
  }

  for (const [file, content] of [
    ["README.md", readme],
    ["PLAN.md", plan],
    ["docs/phases/phase-7.md", phase7],
  ]) {
    assert.match(content, /package\.json` `pi\.skills`/i, `${file} should mention package.json pi.skills`);
  }

  assert.doesNotMatch(plan, /installed explicitly through `\/dev-loops install/i);
  assert.doesNotMatch(phase7, /copied explicitly into repo-local or system-wide skill directories through/i);
  assert.doesNotMatch(readme, /deprecated compatibility commands and no longer copy skills into/i);
});

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

  const currentCommandsBlock = readme.match(/Current commands:\n((?:- .+\n)+)/i)?.[1] ?? "";
  assert.match(currentCommandsBlock, /- `\/dev-loops`/i);
  assert.match(currentCommandsBlock, /- `\/dev-loops status`/i);
  assert.match(currentCommandsBlock, /- `\/dev-loops doctor`/i);
  assert.match(currentCommandsBlock, /- `\/dev-loops hide`/i);
  assert.doesNotMatch(
    currentCommandsBlock,
    /\/dev-loops install|\/dev-loops update/i,
    "README should not list removed install/update names as current commands, even with legacy argument suffixes",
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

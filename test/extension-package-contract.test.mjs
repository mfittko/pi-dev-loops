import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("package metadata exposes the extension entrypoint and root extension test script", async () => {
  const packageJson = JSON.parse(await readRepo("package.json"));

  assert.deepEqual(packageJson.pi.extensions, ["./index.ts"]);
  assert.equal(packageJson.bin["pi-dev-loops"], "./bin/pi-dev-loops.mjs");
  assert.match(packageJson.engines.node, />=20/);
  assert.equal(typeof packageJson.peerDependencies["@mariozechner/pi-coding-agent"], "string");
  assert.equal(typeof packageJson.peerDependencies["@mariozechner/pi-tui"], "string");
  assert.equal(typeof packageJson.scripts["test:extension"], "string");
  assert.match(packageJson.scripts["test:extension"], /--import tsx/);
  assert.match(packageJson.scripts["test:extension"], /extension-checks/);
  assert.match(packageJson.scripts["test:extension"], /extension-installer/);
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
  assert.match(readme, /deprecated compatibility command/i);
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
  assert.doesNotMatch(readme, /\/skill:copilot-dev-loop|\/skill:copilot-autopilot/i);
  assert.match(readme, /node --import tsx --test/i);
  assert.match(readme, /does not yet claim a specific supported `gh` version/i);
  assert.match(readme, /npm run test:extension/i);
  assert.match(readme, /npm run test:dev-loop/i);
});

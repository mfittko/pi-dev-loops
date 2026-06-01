import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("ui validation contract doc exists at the expected path", async () => {
  await access(fromRepoRoot("docs/ui-validation-contract.md"));
});

test("ui validation contract keeps opt-in bounded framing and smoke/regression boundary", async () => {
  const contract = await readRepo("docs/ui-validation-contract.md");

  assert.match(contract, /single public entrypoint/i);
  assert.match(contract, /`dev-loop`/i);
  assert.match(contract, /opt.in/i);
  assert.match(contract, /bounded/i);

  assert.match(contract, /manual review artifacts/i);
  assert.match(contract, /deterministic UI smoke validation/i);
  assert.match(contract, /broader visual regression coverage/i);
});

test("ui validation contract lists required non-goals and guardrails", async () => {
  const contract = await readRepo("docs/ui-validation-contract.md");

  assert.match(contract, /mandatory multi-browser/i);
  assert.match(contract, /browser-heavy default workflow/i);
  assert.match(contract, /full visual regression suite/i);
  assert.match(contract, /always-on/i);
  assert.match(contract, /Deferred follow-up work/i);
});

test("local-implementation skill points to the ui validation contract and keeps opt-in and CI framing", async () => {
  const localImplementationSkill = await readRepo("skills/local-implementation/SKILL.md");

  assert.match(localImplementationSkill, /docs\/ui-validation-contract\.md/i);
  assert.match(localImplementationSkill, /when the user opts in/i);
  assert.match(localImplementationSkill, /wire it into CI once it becomes required validation for that slice/i);
  assert.doesNotMatch(localImplementationSkill, /visual regression[^.\n]*(default|always-on)/i);
});

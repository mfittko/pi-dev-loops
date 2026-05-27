import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolvePackagedCoreSourceRoot,
  resolvePackagedDocsRoot,
  resolvePackagedScriptsRoot,
  resolvePackagedSkillsRoot,
  resolveSystemSkillsRoot,
} from "../extension/installer.ts";

test("resolveSystemSkillsRoot targets ~/.pi/agent/skills", () => {
  assert.equal(resolveSystemSkillsRoot("/tmp/home"), path.join("/tmp/home", ".pi", "agent", "skills"));
});

test("packaged root helpers still resolve into the repository checkout", () => {
  assert.match(resolvePackagedSkillsRoot(), /skills$/);
  assert.match(resolvePackagedScriptsRoot(), /scripts$/);
  assert.match(resolvePackagedCoreSourceRoot(), /packages[\\/]core[\\/]src$/);
  assert.match(resolvePackagedDocsRoot(), /docs$/);
});

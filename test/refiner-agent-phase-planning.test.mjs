import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), "utf8");

test("refiner agent defines the approved phase-refinement contract", async () => {
  const content = await readRepo("agents/refiner.agent.md");

  assert.match(content, /^---[\s\S]*name:\s*"refiner"/m);
  assert.match(content, /phase refinement/i);
  assert.match(content, /complete acceptance criteria/i);
  assert.match(content, /definition of done/i);
  assert.match(content, /non-goals/i);
  assert.match(content, /risks/i);
  assert.match(content, /unresolved questions|ambiguities/i);
  assert.match(content, /RFC-worthy technical decisions/i);
  assert.match(content, /through the coordinator/i);
  assert.match(content, /lead dev/i);
  assert.match(content, /specialized dev/i);
  assert.match(content, /systems architect/i);
  assert.match(content, /parallel fresh-context fan-out\/fan-in/i);
  assert.match(content, /variant-a.+variant-b|variant-b.+variant-a/is);
  assert.match(content, /one persona or refinement angle/i);
  assert.match(content, /different persona or angle/i);
  assert.doesNotMatch(content, /execute RFC work itself|run the RFC team|implement the RFC team/i);
});

test("dev-loop skill uses the refiner for phase planning without replacing the coordinator", async () => {
  const content = await readRepo("skills/dev-loop/SKILL.md");

  assert.match(content, /refiner/i);
  assert.match(content, /parallel fresh-context subagents/i);
  assert.match(content, /concise written briefing summary|concise briefing summary/i);
  assert.match(content, /do not fork the parent session/i);
  assert.match(content, /stable inner fan-out shape|anchored to one persona or refinement angle/i);
  assert.match(content, /different persona or angle/i);
  assert.match(content, /Definition of done/i);
  assert.match(content, /RFC-worthy technical decisions/i);
  assert.match(content, /through the coordinator/i);
  assert.match(content, /keeps? the coordinator as the escalation\/decision owner|coordinator as the escalation and decision owner/i);
});

test("coordinator agent remains the RFC receiving boundary and decision owner", async () => {
  const content = await readRepo("agents/coordinator.agent.md");

  assert.match(content, /RFC/i);
  assert.match(content, /receiv/i);
  assert.match(content, /decision owner/i);
  assert.match(content, /lead dev/i);
  assert.match(content, /specialized dev/i);
  assert.match(content, /systems architect/i);
});

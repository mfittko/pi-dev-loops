import test from "node:test";
import assert from "node:assert/strict";

import { collectDevLoopChecks, renderCheckLines, summarizeChecks } from "../extension/checks.ts";

function createFakePi({ commandResults = new Map(), tools = [], commands = [] } = {}) {
  return {
    async exec(_tool, args) {
      const command = args[1];
      return { code: commandResults.get(command) ?? 1 };
    },
    getAllTools() {
      return tools;
    },
    getCommands() {
      return commands;
    },
  };
}

test("collectDevLoopChecks returns stable ordering and pass/fail detail", async () => {
  const checks = await collectDevLoopChecks(
    createFakePi({
      commandResults: new Map([
        ["command -v gh >/dev/null 2>&1", 0],
        ["gh auth status >/dev/null 2>&1", 0],
        ["git rev-parse --is-inside-work-tree >/dev/null 2>&1", 0],
      ]),
      tools: [{ name: "subagent" }],
      commands: [
        { name: "skill:dev-loop" },
        { name: "skill:copilot-dev-loop" },
        { name: "skill:copilot-autopilot" },
      ],
    }),
  );

  assert.deepEqual(
    checks.map((check) => check.id),
    [
      "gh-installed",
      "gh-auth",
      "subagent-tool",
      "git-repo",
      "local-dev-loop-skill",
      "copilot-dev-loop-skill",
      "copilot-autopilot-skill",
    ],
  );
  assert.equal(checks.every((check) => check.ok), true);
  assert.equal(checks[1].detail, "`gh auth status` succeeded.");
});

test("collectDevLoopChecks distinguishes missing gh from missing gh auth", async () => {
  const missingGhChecks = await collectDevLoopChecks(createFakePi());
  assert.equal(missingGhChecks[0].ok, false);
  assert.match(missingGhChecks[0].detail, /Install GitHub CLI/);
  assert.equal(missingGhChecks[1].ok, false);
  assert.equal(missingGhChecks[1].detail, "GitHub CLI is not installed yet.");

  const missingAuthChecks = await collectDevLoopChecks(
    createFakePi({
      commandResults: new Map([
        ["command -v gh >/dev/null 2>&1", 0],
        ["gh auth status >/dev/null 2>&1", 1],
      ]),
    }),
  );
  assert.equal(missingAuthChecks[0].ok, true);
  assert.equal(missingAuthChecks[1].ok, false);
  assert.match(missingAuthChecks[1].detail, /gh auth login/);
});

test("collectDevLoopChecks uses Pi-discovered tools and commands for discoverability checks", async () => {
  const checks = await collectDevLoopChecks(
    createFakePi({
      tools: [{ name: "subagent" }],
      commands: [{ name: "skill:dev-loop" }],
    }),
  );

  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId["subagent-tool"].ok, true);
  assert.equal(byId["local-dev-loop-skill"].ok, true);
  assert.equal(byId["copilot-dev-loop-skill"].ok, false);
  assert.equal(byId["copilot-autopilot-skill"].ok, false);
});

test("summarizeChecks and renderCheckLines return stable human-readable output", () => {
  const checks = [
    { id: "ok", label: "Everything good", ok: true, detail: "Looks fine." },
    { id: "warn", label: "Needs setup", ok: false, detail: "Do the thing." },
  ];

  assert.deepEqual(summarizeChecks(checks), { ok: 1, total: 2 });
  assert.deepEqual(renderCheckLines(checks), [
    "✅ Everything good",
    "   Looks fine.",
    "⚠️ Needs setup",
    "   Do the thing.",
  ]);
});

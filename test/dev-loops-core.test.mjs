import test from "node:test";
import assert from "node:assert/strict";

import { collectDevLoopChecks, executeDevLoopsCommand, parseDevLoopsCommand } from "../lib/dev-loops-core.mjs";

function createRuntime(overrides = {}) {
  return {
    async commandExists(command) {
      return command === "gh";
    },
    async ghAuthOk() {
      return true;
    },
    async insideGitRepo() {
      return true;
    },
    async resolveRepoRoot() {
      return "/tmp/repo";
    },
    async getSubagentAvailability() {
      return {
        ok: true,
        availableDetail: "`subagent` tool is available.",
        unavailableDetail: "missing subagent",
      };
    },
    async getSkillAvailability(skillName) {
      return {
        ok: true,
        availableDetail: `skill available: ${skillName}`,
        unavailableDetail: `skill missing: ${skillName}`,
      };
    },
    ...overrides,
  };
}

test("parser maintains extension and CLI parity with the hide exception", () => {
  const sharedInputs = [
    [[], "help"],
    [["help"], "help"],
    [["status"], "status"],
    [["doctor"], "doctor"],
    [["install", "repo"], "install"],
    [["update", "system"], "update"],
  ];

  for (const [argv, action] of sharedInputs) {
    assert.deepEqual(parseDevLoopsCommand(argv, { surface: "extension" }), parseDevLoopsCommand(argv, { surface: "cli" }));
    assert.equal(parseDevLoopsCommand(argv, { surface: "cli" }).action, action);
  }

  assert.deepEqual(parseDevLoopsCommand(["hide"], { surface: "extension" }), {
    kind: "action",
    action: "hide",
    tokens: ["hide"],
  });
  assert.deepEqual(parseDevLoopsCommand(["hide"], { surface: "cli" }), {
    kind: "unsupported",
    action: "hide",
    message: "`pi-dev-loops hide` is not supported outside the Pi extension; use `/dev-loops hide` inside Pi instead.",
    tokens: ["hide"],
  });
  assert.deepEqual(parseDevLoopsCommand(["install", "moon"], { surface: "cli" }), {
    kind: "action",
    action: "install",
    scope: undefined,
    tokens: ["install", "moon"],
  });
  assert.deepEqual(parseDevLoopsCommand(["status", "extra"], { surface: "extension" }), {
    kind: "action",
    action: "status",
    tokens: ["status", "extra"],
  });
  assert.deepEqual(parseDevLoopsCommand(["status", "extra"], { surface: "cli" }), {
    kind: "malformed",
    message: "`status` does not accept additional arguments.",
    usageAction: "status",
    tokens: ["status", "extra"],
  });
  assert.deepEqual(parseDevLoopsCommand(["banana"], { surface: "extension" }), {
    kind: "action",
    action: "help",
    tokens: ["banana"],
  });
  assert.deepEqual(parseDevLoopsCommand(["help", "extra"], { surface: "cli" }), {
    kind: "malformed",
    message: "`help` does not accept additional arguments.",
    usageAction: "help",
    tokens: ["help", "extra"],
  });
});

test("shared executor returns deterministic status and deprecated install guidance", async () => {
  const status = await executeDevLoopsCommand({
    input: ["status"],
    surface: "cli",
    runtime: createRuntime(),
    homeDirectory: "/tmp/home",
  });

  assert.equal(status.kind, "checks");
  assert.equal(status.action, "status");
  assert.equal(status.checks[0].id, "gh-installed");
  assert.equal(status.checks[3].id, "git-repo");

  const deprecated = await executeDevLoopsCommand({
    input: ["install", "repo"],
    surface: "cli",
    runtime: createRuntime(),
    homeDirectory: "/tmp/home",
  });

  assert.deepEqual(deprecated, {
    kind: "deprecated",
    action: "install",
    scope: "repo",
    lines: [
      "Skills and agents are now installed automatically via `pi install git:github.com/mfittko/pi-dev-loops`. No manual install step is needed.",
      "For a project-local install, use `pi install -l git:github.com/mfittko/pi-dev-loops` instead.",
    ],
  });
});

test("collectDevLoopChecks no longer reports a dev-loop skill readiness check", async () => {
  const checks = await collectDevLoopChecks(createRuntime());
  assert.equal(checks.some((check) => check.id === "local-dev-loop-skill"), false);
});

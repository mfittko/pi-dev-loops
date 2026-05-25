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
    kind: "malformed",
    message: "`install` accepts only the optional target `repo` or `system`.",
    usageAction: "install",
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

test("shared executor returns deterministic status and blocked install results", async () => {
  const status = await executeDevLoopsCommand({
    input: ["status"],
    surface: "cli",
    runtime: createRuntime(),
    homeDirectory: "/tmp/home",
  });

  assert.equal(status.kind, "checks");
  assert.equal(status.action, "status");
  assert.equal(status.checks[0].id, "gh-installed");
  assert.equal(status.checks[4].id, "local-dev-loop-skill");
  assert.equal(status.checks[4].ok, true);

  const blocked = await executeDevLoopsCommand({
    input: ["install", "repo"],
    surface: "cli",
    runtime: createRuntime({
      async resolveRepoRoot() {
        return undefined;
      },
    }),
    homeDirectory: "/tmp/home",
  });

  assert.deepEqual(blocked, {
    kind: "blocked",
    action: "install",
    scope: "repo",
    message: "pi-dev-loops install repo: not inside a git repository",
  });
});


test("collectDevLoopChecks uses the caller-provided surface as the single install-guidance authority", async () => {
  const runtime = createRuntime({
    surface: "extension",
    async getSkillAvailability() {
      return {
        ok: false,
        availableDetail: "installed elsewhere",
        unavailableDetail: "generic missing",
      };
    },
  });

  const cliChecks = await collectDevLoopChecks(runtime, { surface: "cli" });
  const extensionChecks = await collectDevLoopChecks(runtime, { surface: "extension" });

  const cliDevLoop = cliChecks.find((check) => check.id === "local-dev-loop-skill");
  const extensionDevLoop = extensionChecks.find((check) => check.id === "local-dev-loop-skill");

  assert.match(cliDevLoop.detail, /pi-dev-loops install repo/i);
  assert.doesNotMatch(cliDevLoop.detail, /\/dev-loops install repo/i);
  assert.match(extensionDevLoop.detail, /\/dev-loops install repo/i);
});


test("collectDevLoopChecks applies surface-aware dev-loop guidance for object probes too", async () => {
  const cliChecks = await collectDevLoopChecks(createRuntime({
    surface: "cli",
    async getSkillAvailability(skillName) {
      return {
        ok: false,
        availableDetail: `installed elsewhere: ${skillName}`,
        unavailableDetail: `generic missing: ${skillName}`,
      };
    },
  }));

  const localSkill = cliChecks.find((check) => check.id === "local-dev-loop-skill");
  assert.match(localSkill.detail, /pi-dev-loops install repo/i);
  assert.doesNotMatch(localSkill.detail, /generic missing: dev-loop/i);
});

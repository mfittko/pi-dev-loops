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
    runtime: createRuntime({
      async getSkillAvailability(skillName) {
        if (skillName === "copilot-autopilot") {
          return {
            ok: false,
            availableDetail: "",
            unavailableDetail: "skill missing",
          };
        }

        return {
          ok: true,
          availableDetail: `skill available: ${skillName}`,
          unavailableDetail: `skill missing: ${skillName}`,
        };
      },
    }),
    homeDirectory: "/tmp/home",
  });

  assert.equal(status.kind, "checks");
  assert.equal(status.action, "status");
  assert.equal(status.checks[0].id, "gh-installed");
  assert.equal(status.checks[6].id, "copilot-autopilot-skill");
  assert.equal(status.checks[6].ok, false);

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


test("collectDevLoopChecks uses surface-aware install guidance and keeps autopilot non-required", async () => {
  const cliChecks = await collectDevLoopChecks(createRuntime({
    surface: "cli",
    async getSkillAvailability(skillName) {
      return {
        ok: skillName === "dev-loop",
        availableDetail: `skill available: ${skillName}`,
        unavailableDetail: `skill missing: ${skillName}`,
      };
    },
  }));

  const extensionChecks = await collectDevLoopChecks(createRuntime({
    surface: "extension",
    async getSkillAvailability(skillName) {
      return {
        ok: skillName === "dev-loop",
        availableDetail: `skill available: ${skillName}`,
        unavailableDetail: `skill missing: ${skillName}`,
      };
    },
  }));

  const cliCopilot = cliChecks.find((check) => check.id === "copilot-dev-loop-skill");
  const extensionCopilot = extensionChecks.find((check) => check.id === "copilot-dev-loop-skill");
  const cliAutopilot = cliChecks.find((check) => check.id === "copilot-autopilot-skill");

  assert.match(cliCopilot.detail, /pi-dev-loops install repo/i);
  assert.doesNotMatch(cliCopilot.detail, /\/dev-loops install repo/i);
  assert.match(extensionCopilot.detail, /\/dev-loops install repo/i);
  assert.match(cliAutopilot.detail, /internal routed compatibility seams used by GitHub-first intake paths/i);
  assert.doesNotMatch(cliAutopilot.detail, /Required internal/i);
});

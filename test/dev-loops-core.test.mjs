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
    async getSubagentAvailability() {
      return {
        ok: true,
        availableDetail: "`subagent` command is available.",
        unavailableDetail: "missing subagent",
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
  assert.deepEqual(parseDevLoopsCommand(["install", "moon"], { surface: "extension" }), {
    kind: "action",
    action: "help",
    tokens: ["install", "moon"],
  });
  assert.deepEqual(parseDevLoopsCommand(["update", "system"], { surface: "extension" }), {
    kind: "action",
    action: "help",
    tokens: ["update", "system"],
  });
  assert.deepEqual(parseDevLoopsCommand(["install", "moon"], { surface: "cli" }), {
    kind: "malformed",
    message: "Unrecognized command: install.",
    usageAction: undefined,
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

test("shared executor returns deterministic status and rejects removed install and update commands", async () => {
  const status = await executeDevLoopsCommand({
    input: ["status"],
    surface: "cli",
    runtime: createRuntime(),
  });

  assert.equal(status.kind, "checks");
  assert.equal(status.action, "status");
  assert.equal(status.checks[0].id, "gh-installed");
  assert.equal(status.checks[3].id, "git-repo");

  const removedInstall = await executeDevLoopsCommand({
    input: ["install", "repo"],
    surface: "cli",
    runtime: createRuntime(),
  });

  assert.deepEqual(removedInstall, {
    kind: "malformed",
    message: "Unrecognized command: install.",
    usageAction: undefined,
    tokens: ["install", "repo"],
  });

  const removedUpdate = await executeDevLoopsCommand({
    input: ["update", "system"],
    surface: "cli",
    runtime: createRuntime(),
  });

  assert.deepEqual(removedUpdate, {
    kind: "malformed",
    message: "Unrecognized command: update.",
    usageAction: undefined,
    tokens: ["update", "system"],
  });

  const removedExtensionInstall = await executeDevLoopsCommand({
    input: ["install", "repo"],
    surface: "extension",
    runtime: createRuntime(),
  });

  assert.deepEqual(removedExtensionInstall, { kind: "help" });

  const removedExtensionUpdate = await executeDevLoopsCommand({
    input: ["update", "system"],
    surface: "extension",
    runtime: createRuntime(),
  });

  assert.deepEqual(removedExtensionUpdate, { kind: "help" });
});

test("collectDevLoopChecks no longer reports a dev-loop skill readiness check", async () => {
  const checks = await collectDevLoopChecks(createRuntime());
  assert.equal(checks.some((check) => check.id === "local-dev-loop-skill"), false);
});

test("parser accepts the bounded inspect-run UI lifecycle command family only on the extension surface", () => {
  for (const action of ["open", "resume", "status", "stop", "restart"]) {
    const parsed = parseDevLoopsCommand(["ui", "inspect-run", action, "--repo", "mfittko/pi-dev-loops"], { surface: "extension" });
    assert.equal(parsed.kind, "ui_inspect_run_action");
    assert.equal(parsed.action, action);
    assert.equal(parsed.repo, "mfittko/pi-dev-loops");
  }

  assert.deepEqual(parseDevLoopsCommand(["ui", "inspect-run", "launch"], { surface: "extension" }), {
    kind: "malformed",
    message: "`/dev-loops ui inspect-run` only supports: open, resume, status, stop, restart.",
    usageAction: "ui inspect-run",
    tokens: ["ui", "inspect-run", "launch"],
  });

  assert.deepEqual(parseDevLoopsCommand(["ui", "inspect-run", "open"], { surface: "cli" }), {
    kind: "malformed",
    message: "Unrecognized command: ui.",
    usageAction: undefined,
    tokens: ["ui", "inspect-run", "open"],
  });
});

test('executor returns a structured inspect-run UI result when repo-root lookup or lifecycle execution throws', async () => {
  const repoRootFailure = await executeDevLoopsCommand({
    input: ['ui', 'inspect-run', 'open'],
    surface: 'extension',
    runtime: {
      async getRepoRoot() {
        throw new Error('not in a git repo');
      },
      uiLifecycle: {
        async open() {
          throw new Error('should not run');
        },
      },
    },
  });

  assert.deepEqual(repoRootFailure, {
    kind: 'ui_inspect_run_result',
    action: 'open',
    repo: null,
    repoRoot: null,
    state: 'stopped',
    url: null,
    detail: 'not in a git repo',
    warning: null,
  });
});

test('executor preserves repoRoot when the inspect-run lifecycle action throws after repo-root lookup succeeds', async () => {
  const result = await executeDevLoopsCommand({
    input: ['ui', 'inspect-run', 'open'],
    surface: 'extension',
    runtime: {
      async getRepoRoot() {
        return '/repo/root';
      },
      uiLifecycle: {
        async open() {
          throw new Error('launch failed');
        },
      },
    },
  });

  assert.deepEqual(result, {
    kind: 'ui_inspect_run_result',
    action: 'open',
    repo: null,
    repoRoot: '/repo/root',
    state: 'stopped',
    url: null,
    detail: 'launch failed',
    warning: null,
  });
});

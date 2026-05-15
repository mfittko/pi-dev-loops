import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";

import registerExtension from "../extension/index.ts";
import { buildInstallResultLines } from "../extension/presentation.ts";

function createPiDouble({ commandResults = new Map(), tools = [], commands = [] } = {}) {
  const events = new Map();
  const registeredCommands = new Map();

  return {
    async exec(_tool, args) {
      const command = args[1];
      const result = commandResults.get(command);

      if (typeof result === "number") {
        return { code: result, stdout: "", stderr: "" };
      }

      return result ?? { code: 1, stdout: "", stderr: "" };
    },
    getAllTools() {
      return tools;
    },
    getCommands() {
      return commands;
    },
    on(event, handler) {
      events.set(event, handler);
    },
    registerCommand(name, config) {
      registeredCommands.set(name, config);
    },
    events,
    registeredCommands,
  };
}

function createCommandContext() {
  const calls = {
    widgets: [],
    notifications: [],
    statuses: [],
  };

  return {
    ctx: {
      ui: {
        setWidget(key, lines, options) {
          calls.widgets.push({ key, lines, options });
        },
        notify(message, level) {
          calls.notifications.push({ message, level });
        },
        setStatus(key, text) {
          calls.statuses.push({ key, text });
        },
      },
    },
    calls,
  };
}

function readyPi() {
  return createPiDouble({
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
  });
}

test("extension clears any stale footer status on session start and registers the dev-loops command", async () => {
  const pi = readyPi();
  registerExtension(pi);

  assert.equal(typeof pi.events.get("session_start"), "function");
  assert.equal(typeof pi.registeredCommands.get("dev-loops")?.handler, "function");

  const { ctx, calls } = createCommandContext();
  await pi.events.get("session_start")({}, ctx);
  assert.deepEqual(calls.statuses, [{ key: "pi-dev-loops", text: undefined }]);
});

test("help is the default action and malformed commands stay non-mutating", async () => {
  const pi = readyPi();
  registerExtension(pi);
  const { ctx, calls } = createCommandContext();

  await pi.registeredCommands.get("dev-loops").handler("", ctx);

  const widget = calls.widgets.at(-1);
  assert.equal(widget.key, "pi-dev-loops.setup");
  assert.match(widget.lines[0], /pi-dev-loops help/);
  assert(widget.lines.some((line) => /\/dev-loops status/i.test(line)));
  assert(widget.lines.some((line) => /^- \/dev-loops install$/i.test(line)));
  assert(widget.lines.some((line) => /prompts for `repo` or `system`/i.test(line)));
  assert(widget.lines.some((line) => /skills are installed explicitly/i.test(line)));
  assert.equal(calls.notifications.at(-1).message, "pi-dev-loops help");

  const invalidArgsContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("install moon", invalidArgsContext.ctx);
  assert.match(invalidArgsContext.calls.widgets.at(-1).lines[0], /pi-dev-loops install: choose a target/);
  assert.equal(invalidArgsContext.calls.notifications.at(-1).level, "error");
});

test("status keeps existing remote readiness ready when copilot-dev-loop is installed but copilot-autopilot is not", async () => {
  const pi = createPiDouble({
    commandResults: new Map([
      ["command -v gh >/dev/null 2>&1", 0],
      ["gh auth status >/dev/null 2>&1", 0],
      ["git rev-parse --is-inside-work-tree >/dev/null 2>&1", 0],
    ]),
    tools: [{ name: "subagent" }],
    commands: [
      { name: "skill:dev-loop" },
      { name: "skill:copilot-dev-loop" },
    ],
  });
  registerExtension(pi);

  const { ctx, calls } = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("status", ctx);

  const lines = calls.widgets.at(-1).lines;
  assert(lines.some((line) => /Local loop readiness: ready/i.test(line)));
  assert(lines.some((line) => /Remote GitHub\/Copilot readiness: ready/i.test(line)));
});

test("status keeps remote readiness blocked outside a git repo", async () => {
  const pi = createPiDouble({
    commandResults: new Map([
      ["command -v gh >/dev/null 2>&1", 0],
      ["gh auth status >/dev/null 2>&1", 0],
      ["git rev-parse --is-inside-work-tree >/dev/null 2>&1", 1],
    ]),
    tools: [{ name: "subagent" }],
    commands: [
      { name: "skill:dev-loop" },
      { name: "skill:copilot-dev-loop" },
      { name: "skill:copilot-autopilot" },
    ],
  });
  registerExtension(pi);

  const { ctx, calls } = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("status", ctx);

  const lines = calls.widgets.at(-1).lines;
  assert(lines.some((line) => /Local loop readiness: needs setup/i.test(line)));
  assert(lines.some((line) => /Remote GitHub\/Copilot readiness: needs setup/i.test(line)));
});

test("doctor shows the full check report and install/update without a target show action-specific usage", async () => {
  const pi = createPiDouble({
    commandResults: new Map([
      ["command -v gh >/dev/null 2>&1", 1],
      ["gh auth status >/dev/null 2>&1", 1],
      ["git rev-parse --is-inside-work-tree >/dev/null 2>&1", 0],
    ]),
    tools: [],
    commands: [{ name: "skill:dev-loop" }],
  });
  registerExtension(pi);

  const doctorContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("doctor", doctorContext.ctx);
  const doctorLines = doctorContext.calls.widgets.at(-1).lines;
  assert(doctorLines.some((line) => /^⚠️ GitHub CLI installed/.test(line)));
  assert(doctorLines.some((line) => /^⚠️ GitHub CLI authenticated/.test(line)));
  assert.equal(doctorLines.some((line) => /Ordered setup steps:/i.test(line)), false);

  const installContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("install", installContext.ctx);
  const installLines = installContext.calls.widgets.at(-1).lines;
  assert(installLines.some((line) => /Usage:/i.test(line)));
  assert(installLines.some((line) => /\/dev-loops install repo/i.test(line)));
  assert(installLines.some((line) => /installs skills in the current git repository/i.test(line)));

  const updateContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("update", updateContext.ctx);
  const updateLines = updateContext.calls.widgets.at(-1).lines;
  assert(updateLines.some((line) => /\/dev-loops update repo/i.test(line)));
  assert(updateLines.some((line) => /updates skills in the current git repository/i.test(line)));
});

test("install repo copies packaged skills into the repository, repo errors stay action-specific, and hide still clears the widget", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-repo-install-"));
  const pi = createPiDouble({
    commandResults: new Map([
      ["git rev-parse --show-toplevel", { code: 0, stdout: `${repoRoot}\n`, stderr: "" }],
    ]),
  });
  registerExtension(pi);

  const installContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("install repo", installContext.ctx);
  const installLines = installContext.calls.widgets.at(-1).lines;
  assert(installLines.some((line) => /skill directories changed/i.test(line)));
  assert(installLines.some((line) => /Restart Pi or refresh skill discovery/i.test(line)));
  await access(path.join(repoRoot, ".pi", "skills", "dev-loop", "SKILL.md"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-dev-loop", "SKILL.md"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-autopilot", "SKILL.md"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-dev-loop", "scripts", "github", "request-copilot-review.mjs"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-dev-loop", "packages", "core", "src", "loop", "copilot-loop-state.mjs"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-dev-loop", "docs", "copilot-loop-state-graph.md"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-autopilot", "scripts", "loop", "copilot-pr-handoff.mjs"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-autopilot", "scripts", "github", "detect-linked-issue-pr.mjs"));
  await access(path.join(repoRoot, ".pi", "skills", "copilot-autopilot", "scripts", "github", "_github-helpers.mjs"));

  const repoErrorContext = createCommandContext();
  const noRepoPi = createPiDouble({
    commandResults: new Map([["git rev-parse --show-toplevel", { code: 1, stdout: "", stderr: "" }]]),
  });
  registerExtension(noRepoPi);
  await noRepoPi.registeredCommands.get("dev-loops").handler("update repo", repoErrorContext.ctx);
  assert(repoErrorContext.calls.widgets.at(-1).lines.some((line) => /\/dev-loops update system/i.test(line)));

  const hideContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("hide", hideContext.ctx);
  assert.deepEqual(hideContext.calls.widgets.at(-1), {
    key: "pi-dev-loops.setup",
    lines: undefined,
    options: undefined,
  });
  assert.equal(hideContext.calls.notifications.at(-1).message, "pi-dev-loops widget hidden");

  const fallbackContext = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("banana", fallbackContext.ctx);
  assert.match(fallbackContext.calls.widgets.at(-1).lines[0], /pi-dev-loops help/);
});

test("repo install refuses symlinked skill roots with a user-facing error", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-repo-symlink-"));
  const realSkillsRoot = path.join(repoRoot, "real-skills-root");
  await mkdir(path.join(repoRoot, ".pi"), { recursive: true });
  await mkdir(realSkillsRoot, { recursive: true });
  await symlink(realSkillsRoot, path.join(repoRoot, ".pi", "skills"));

  const pi = createPiDouble({
    commandResults: new Map([["git rev-parse --show-toplevel", { code: 0, stdout: `${repoRoot}\n`, stderr: "" }]]),
  });
  registerExtension(pi);

  const { ctx, calls } = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("install repo", ctx);

  assert.match(calls.widgets.at(-1).lines[0], /pi-dev-loops install repo: failed/);
  assert(calls.widgets.at(-1).lines.some((line) => /symlinked skill root/i.test(line)));
  assert.equal(calls.notifications.at(-1).level, "error");
});

test("system install failures surface a user-facing error instead of throwing", async () => {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-home-"));
  process.env.HOME = tempHome;

  try {
    await writeFile(path.join(tempHome, ".pi"), "not a directory\n");

    const pi = readyPi();
    registerExtension(pi);

    const { ctx, calls } = createCommandContext();
    await pi.registeredCommands.get("dev-loops").handler("install system", ctx);

    assert.match(calls.widgets.at(-1).lines[0], /pi-dev-loops install system: failed/);
    assert.equal(calls.notifications.at(-1).level, "error");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test("buildInstallResultLines reports missing update targets as not installed and guides first-time setup", () => {
  const lines = buildInstallResultLines({
    mode: "update",
    scope: "repo",
    targetRoot: "/tmp/repo/.pi/skills",
    results: [
      {
        skillName: "dev-loop",
        status: "updated",
        targetPath: "/tmp/repo/.pi/skills/dev-loop",
      },
      {
        skillName: "copilot-dev-loop",
        status: "missing",
        targetPath: "/tmp/repo/.pi/skills/copilot-dev-loop",
      },
      {
        skillName: "copilot-autopilot",
        status: "missing",
        targetPath: "/tmp/repo/.pi/skills/copilot-autopilot",
      },
    ],
  });

  assert.equal(lines[0], "pi-dev-loops update repo: 1/3 skill directories changed");
  assert(lines.some((line) => /copilot-dev-loop: not installed/i.test(line)));
  assert(lines.some((line) => /copilot-autopilot: not installed/i.test(line)));
  assert(lines.some((line) => /first-time setup/i.test(line)));
  assert(lines.some((line) => /missing skill will not appear after refresh alone/i.test(line)));
});

test("buildInstallResultLines throws for unknown install statuses instead of rendering undefined", () => {
  assert.throws(
    () => buildInstallResultLines({
      mode: "install",
      scope: "repo",
      targetRoot: "/tmp/repo/.pi/skills",
      results: [{
        skillName: "dev-loop",
        status: "mystery-status",
        targetPath: "/tmp/repo/.pi/skills/dev-loop",
      }],
    }),
    /Unknown install status: mystery-status/,
  );
});

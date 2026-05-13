import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp } from "node:fs/promises";

import registerExtension from "../extension/index.ts";

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
    commands: [{ name: "skill:dev-loop" }, { name: "skill:copilot-dev-loop" }],
  });
}

test("extension registers command and session_start wiring", async () => {
  const pi = readyPi();
  registerExtension(pi);

  assert.equal(typeof pi.events.get("session_start"), "function");
  assert.equal(typeof pi.registeredCommands.get("dev-loops")?.handler, "function");

  const { ctx, calls } = createCommandContext();
  await pi.events.get("session_start")({}, ctx);
  assert.deepEqual(calls.statuses, [{ key: "pi-dev-loops", text: "pi-dev-loops" }]);
});

test("help is the default action and lists the command surface", async () => {
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
});

test("status keeps remote readiness blocked outside a git repo", async () => {
  const pi = createPiDouble({
    commandResults: new Map([
      ["command -v gh >/dev/null 2>&1", 0],
      ["gh auth status >/dev/null 2>&1", 0],
      ["git rev-parse --is-inside-work-tree >/dev/null 2>&1", 1],
    ]),
    tools: [{ name: "subagent" }],
    commands: [{ name: "skill:dev-loop" }, { name: "skill:copilot-dev-loop" }],
  });
  registerExtension(pi);

  const { ctx, calls } = createCommandContext();
  await pi.registeredCommands.get("dev-loops").handler("status", ctx);

  const lines = calls.widgets.at(-1).lines;
  assert(lines.some((line) => /Local loop readiness: needs setup/i.test(line)));
  assert(lines.some((line) => /Remote GitHub\/Copilot readiness: needs setup/i.test(line)));
});

test("doctor shows the full check report and install without a target shows usage", async () => {
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
  assert(installLines.some((line) => /\/dev-loops install system/i.test(line)));
});

test("install repo copies packaged skills into the repository and hide still clears the widget", async () => {
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

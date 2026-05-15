import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";

import { runCli } from "../cli/index.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function createBufferStream() {
  let output = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    read() {
      return output;
    },
  };
}

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
        availableDetail: "`pi-subagents` is available on PATH.",
        unavailableDetail: "missing subagent",
      };
    },
    async getSkillAvailability(skillName) {
      return {
        ok: skillName !== "copilot-autopilot",
        availableDetail: `skill available: ${skillName}`,
        unavailableDetail: `skill missing: ${skillName}`,
      };
    },
    ...overrides,
  };
}

test("package CLI entrypoint prints help and rejects hide as unsupported", () => {
  const help = spawnSync("node", ["./bin/pi-dev-loops.mjs", "help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /pi-dev-loops help/);
  assert.match(help.stdout, /pi-dev-loops status/);
  assert.equal(help.stderr, "");

  const hide = spawnSync("node", ["./bin/pi-dev-loops.mjs", "hide"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(hide.status, 1);
  assert.match(hide.stderr, /not supported outside the Pi extension/i);
  assert.equal(hide.stdout, "");
});

test("CLI renderer keeps shared status behavior and shell-friendly argument errors", async () => {
  const statusStdout = createBufferStream();
  const statusStderr = createBufferStream();
  const statusExitCode = await runCli({
    argv: ["status"],
    runtime: createRuntime(),
    stdout: statusStdout.stream,
    stderr: statusStderr.stream,
    homeDirectory: "/tmp/home",
  });

  assert.equal(statusExitCode, 0);
  assert.match(statusStdout.read(), /Local loop readiness: ready/);
  assert.match(statusStdout.read(), /Remote GitHub\/Copilot readiness: ready/);
  assert.match(statusStdout.read(), /Suggested next steps:/);
  assert.equal(statusStderr.read(), "");

  const invalidStdout = createBufferStream();
  const invalidStderr = createBufferStream();
  const invalidExitCode = await runCli({
    argv: ["install", "moon"],
    runtime: createRuntime(),
    stdout: invalidStdout.stream,
    stderr: invalidStderr.stream,
    homeDirectory: "/tmp/home",
  });

  assert.equal(invalidExitCode, 1);
  assert.equal(invalidStdout.read(), "");
  assert.match(invalidStderr.read(), /`install` accepts only the optional target `repo` or `system`/);
  assert.match(invalidStderr.read(), /pi-dev-loops install: choose a target/);
});

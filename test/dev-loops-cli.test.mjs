import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { createCliRuntime, runCli } from "../cli/index.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("package CLI entrypoint prints help and rejects hide as unsupported", () => {
  const help = spawnSync("node", ["./cli/index.mjs", "help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /dev-loops help/);
  assert.match(help.stdout, /dev-loops status/);
  assert.equal(help.stderr, "");

  const hide = spawnSync("node", ["./cli/index.mjs", "hide"], {
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
  });

  assert.equal(statusExitCode, 0);
  assert.match(statusStdout.read(), /Local loop readiness: ready/);
  assert.match(statusStdout.read(), /Remote GitHub\/Copilot readiness: ready/);
  assert.match(statusStdout.read(), /Suggested next steps:/);
  assert.equal(statusStderr.read(), "");

  const removedStdout = createBufferStream();
  const removedStderr = createBufferStream();
  const removedExitCode = await runCli({
    argv: ["install", "moon"],
    runtime: createRuntime(),
    stdout: removedStdout.stream,
    stderr: removedStderr.stream,
  });

  assert.equal(removedExitCode, 1);
  assert.equal(removedStdout.read(), "");
  assert.match(removedStderr.read(), /Unrecognized command: install\./);
  assert.match(removedStderr.read(), /dev-loops help/);

  const malformedStdout = createBufferStream();
  const malformedStderr = createBufferStream();
  const malformedExitCode = await runCli({
    argv: ["status", "extra"],
    runtime: createRuntime(),
    stdout: malformedStdout.stream,
    stderr: malformedStderr.stream,
  });

  assert.equal(malformedExitCode, 1);
  assert.equal(malformedStdout.read(), "");
  assert.match(malformedStderr.read(), /`status` does not accept additional arguments\./);
  assert.match(malformedStderr.read(), /Usage:\n- dev-loops status/);
});

test("CLI help leads with dev-loop as the primary workflow entry", async () => {
  const helpStdout = createBufferStream();
  const helpStderr = createBufferStream();
  const helpExitCode = await runCli({
    argv: ["help"],
    runtime: createRuntime(),
    stdout: helpStdout.stream,
    stderr: helpStderr.stream,
  });

  assert.equal(helpExitCode, 0);
  assert.match(helpStdout.read(), /\/skill:dev-loop/, "CLI help should mention /skill:dev-loop as workflow entry");
  assert.match(helpStdout.read(), /single public entry/, "CLI help should describe dev-loop as single public entry");
  assert.doesNotMatch(helpStdout.read(), /dev-loops (?:install|update)/);
  assert.doesNotMatch(helpStdout.read(), /copilot-dev-loop|copilot-autopilot/i, "CLI help should not surface internal seam names");
  assert.equal(helpStderr.read(), "");
});

test("CLI status next steps lead with dev-loop when all checks pass", async () => {
  const statusStdout = createBufferStream();
  const statusStderr = createBufferStream();
  const statusExitCode = await runCli({
    argv: ["status"],
    runtime: createRuntime(),
    stdout: statusStdout.stream,
    stderr: statusStderr.stream,
  });

  assert.equal(statusExitCode, 0);
  assert.match(statusStdout.read(), /\/skill:dev-loop/, "CLI status should suggest /skill:dev-loop when all checks pass");
  assert.match(statusStdout.read(), /single public entry/, "CLI status should describe dev-loop as single public entry when ready");
  assert.doesNotMatch(statusStdout.read(), /copilot-dev-loop|copilot-autopilot/i, "CLI status should not surface internal seam names");
  assert.equal(statusStderr.read(), "");
});


test("createCliRuntime rejects path-like command probes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev-loops-cli-path-guard-"));
  const binDir = path.join(tempRoot, "bin");
  const nestedDir = path.join(binDir, "foo");
  await mkdir(nestedDir, { recursive: true });
  await writeFile(path.join(nestedDir, "bar"), `#!/bin/sh
exit 0
`);
  await chmod(path.join(nestedDir, "bar"), 0o755);

  try {
    const runtime = createCliRuntime({
      cwd: tempRoot,
      searchPath: binDir,
    });

    assert.equal(await runtime.commandExists("foo/bar"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("createCliRuntime probes PATH commands and git repositories without a login shell", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev-loops-cli-runtime-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  await mkdir(binDir, { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await writeFile(path.join(binDir, "gh"), `#!/bin/sh
exit 0
`);
  await writeFile(path.join(binDir, "subagent"), `#!/bin/sh
exit 0
`);
  await chmod(path.join(binDir, "gh"), 0o755);
  await chmod(path.join(binDir, "subagent"), 0o755);

  const init = spawnSync("git", ["init", "-q"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);

  const previousPath = process.env.PATH;

  try {
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;

    const runtime = createCliRuntime({ cwd: repoDir });
    assert.equal(await runtime.commandExists("subagent"), true);
    assert.equal(await runtime.ghAuthOk(), true);
    assert.equal(await runtime.insideGitRepo(), true);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("createCliRuntime honors PATHEXT lookups when simulating Windows PATH resolution", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev-loops-cli-win-runtime-"));
  const binDir = path.join(tempRoot, "bin");
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, "gh.EXE"), "");
  await writeFile(path.join(binDir, "subagent.CMD"), "");
  await writeFile(path.join(binDir, "git"), "");

  try {
    const runtime = createCliRuntime({
      cwd: tempRoot,
      searchPath: binDir,
      platform: "win32",
      pathExt: ".EXE;.CMD",
    });

    assert.equal(await runtime.commandExists("gh"), true);
    assert.equal(await runtime.commandExists("subagent"), true);
    assert.equal(await runtime.commandExists("git"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI rejects removed update command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dev-loops-cli-update-"));
  const stdout = createBufferStream();
  const stderr = createBufferStream();

  try {
    const exitCode = await runCli({
      argv: ["update", "system"],
      runtime: createRuntime(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.read(), "");
    assert.match(stderr.read(), /Unrecognized command: update\./);
    assert.match(stderr.read(), /dev-loops help/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

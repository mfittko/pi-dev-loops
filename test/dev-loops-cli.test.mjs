import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
  const { homeDirectory = "/tmp/home", ...rest } = overrides;

  return {
    homeDirectory,
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
    ...rest,
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

  const malformedStdout = createBufferStream();
  const malformedStderr = createBufferStream();
  const malformedExitCode = await runCli({
    argv: ["status", "extra"],
    runtime: createRuntime(),
    stdout: malformedStdout.stream,
    stderr: malformedStderr.stream,
    homeDirectory: "/tmp/home",
  });

  assert.equal(malformedExitCode, 1);
  assert.equal(malformedStdout.read(), "");
  assert.match(malformedStderr.read(), /`status` does not accept additional arguments\./);
  assert.match(malformedStderr.read(), /Usage:\n- pi-dev-loops status/);
});


test("createCliRuntime rejects path-like command probes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-cli-path-guard-"));
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
      homeDirectory: tempRoot,
      searchPath: binDir,
    });

    assert.equal(await runtime.commandExists("foo/bar"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("createCliRuntime probes PATH commands and git repositories without a login shell", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-cli-runtime-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  await mkdir(binDir, { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await writeFile(path.join(binDir, "gh"), `#!/bin/sh
exit 0
`);
  await writeFile(path.join(binDir, "pi-subagents"), `#!/bin/sh
exit 0
`);
  await chmod(path.join(binDir, "gh"), 0o755);
  await chmod(path.join(binDir, "pi-subagents"), 0o755);

  const init = spawnSync("git", ["init", "-q"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);

  const previousPath = process.env.PATH;

  try {
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;

    const runtime = createCliRuntime({ cwd: repoDir, homeDirectory: tempRoot });
    assert.equal(await runtime.commandExists("pi-subagents"), true);
    assert.equal(await runtime.ghAuthOk(), true);
    assert.equal(await runtime.insideGitRepo(), true);
    assert.equal(await runtime.resolveRepoRoot(), await realpath(repoDir));
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-cli-win-runtime-"));
  const binDir = path.join(tempRoot, "bin");
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, "gh.EXE"), "");
  await writeFile(path.join(binDir, "pi-subagents.CMD"), "");
  await writeFile(path.join(binDir, "git"), "");

  try {
    const runtime = createCliRuntime({
      cwd: tempRoot,
      homeDirectory: tempRoot,
      searchPath: binDir,
      platform: "win32",
      pathExt: ".EXE;.CMD",
    });

    assert.equal(await runtime.commandExists("gh"), true);
    assert.equal(await runtime.commandExists("pi-subagents"), true);
    assert.equal(await runtime.commandExists("git"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI update output preserves missing-skill guidance parity", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-cli-update-"));
  const skillsRoot = path.join(tempRoot, ".pi", "agent", "skills");
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  await mkdir(path.join(skillsRoot, "dev-loop"), { recursive: true });
  await writeFile(path.join(skillsRoot, "dev-loop", "SKILL.md"), "# dev-loop\n");

  try {
    const exitCode = await runCli({
      argv: ["update", "system"],
      runtime: createRuntime({ homeDirectory: tempRoot }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      homeDirectory: tempRoot,
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.match(stdout.read(), /Some packaged skills were not installed in this target yet/);
    assert.match(stdout.read(), /A missing skill will not appear after refresh alone/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCli rejects custom runtime/homeDirectory mismatches", async () => {
  await assert.rejects(
    runCli({
      argv: ["status"],
      runtime: createRuntime({ homeDirectory: "/tmp/runtime-home" }),
      homeDirectory: "/tmp/other-home",
    }),
    /runCli received mismatched homeDirectory values/,
  );

  await assert.rejects(
    runCli({
      argv: ["status"],
      runtime: createRuntime({ homeDirectory: "/tmp/runtime-home" }),
    }),
    /runCli received mismatched homeDirectory values/,
  );
});

test("runCli uses the supplied homeDirectory when building its default runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-cli-home-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const skillsRoot = path.join(tempRoot, ".pi", "agent", "skills");
  const statusStdout = createBufferStream();
  const statusStderr = createBufferStream();
  await mkdir(binDir, { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await writeFile(path.join(binDir, "gh"), `#!/bin/sh
exit 0
`);
  await writeFile(path.join(binDir, "pi-subagents"), `#!/bin/sh
exit 0
`);
  await chmod(path.join(binDir, "gh"), 0o755);
  await chmod(path.join(binDir, "pi-subagents"), 0o755);

  for (const skillName of ["dev-loop", "copilot-dev-loop", "copilot-autopilot"]) {
    await mkdir(path.join(skillsRoot, skillName), { recursive: true });
    await writeFile(path.join(skillsRoot, skillName, "SKILL.md"), `# ${skillName}
`);
  }

  const init = spawnSync("git", ["init", "-q"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);

  const previousPath = process.env.PATH;

  try {
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;

    const exitCode = await runCli({
      argv: ["status"],
      cwd: repoDir,
      stdout: statusStdout.stream,
      stderr: statusStderr.stream,
      homeDirectory: tempRoot,
    });

    assert.equal(exitCode, 0);
    assert.match(statusStdout.read(), /Local loop readiness: ready/);
    assert.match(statusStdout.read(), /Remote GitHub\/Copilot readiness: ready/);
    assert.equal(statusStderr.read(), "");
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

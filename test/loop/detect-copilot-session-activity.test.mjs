import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/loop/detect-copilot-session-activity.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeGhStub(tempDir, entries) {
  const sequencePath = path.join(tempDir, "gh-sequence.json");
  const counterPath = path.join(tempDir, "gh-counter.txt");
  const ghPath = path.join(tempDir, "gh");

  await writeFile(sequencePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await writeFile(counterPath, "0\n", "utf8");
  await writeFile(
    ghPath,
    [
      "#!/usr/bin/env node",
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const sequencePath = process.env.GH_SEQUENCE_PATH;",
      "const counterPath = process.env.GH_COUNTER_PATH;",
      'const entries = JSON.parse(readFileSync(sequencePath, "utf8"));',
      'const current = Number(readFileSync(counterPath, "utf8").trim() || "0");',
      'if (current >= entries.length) {',
      '  process.stderr.write(`unexpected extra gh call #${current + 1}: ${process.argv.slice(2).join(" ")}\\n`);',
      "  process.exit(97);",
      "}",
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      "  for (const expected of entry.assertArgs) {",
      "    if (!actual.includes(expected)) {",
      '      process.stderr.write(`missing expected gh arg: ${expected}\\nactual: ${actual.join(" ")}\\n`);',
      "      process.exit(98);",
      "    }",
      "  }",
      "}",
      'if (entry.stderr) {',
      "  process.stderr.write(entry.stderr);",
      "}",
      'if (entry.stdout) {',
      "  process.stdout.write(entry.stdout);",
      "}",
      "process.exit(entry.exitCode ?? 0);",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(ghPath, 0o755);

  return {
    ...process.env,
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    GH_SEQUENCE_PATH: sequencePath,
    GH_COUNTER_PATH: counterPath,
  };
}

test("detect-copilot-session-activity reports active when matching run is in progress", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-session-active-"));

  try {
    const env = await writeGhStub(tempDir, [{
      assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/topic"],
      stdout: `${JSON.stringify([
        {
          databaseId: 101,
          name: "Addressing review on PR owner/repo#17",
          status: "in_progress",
          conclusion: "",
          createdAt: "2026-05-27T11:08:48Z",
        },
      ])}\n`,
    }]);

    const result = await runNode(["--repo", "owner/repo", "--branch", "copilot/topic"], { env });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.activity, "active");
    assert.equal(payload.runId, 101);
    assert.equal(payload.runStatus, "in_progress");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-session-activity reports concluded when latest matching run completed", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-session-concluded-"));

  try {
    const env = await writeGhStub(tempDir, [{
      assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/topic"],
      stdout: `${JSON.stringify([
        {
          databaseId: 110,
          name: "Addressing comment on PR owner/repo#17",
          status: "completed",
          conclusion: "success",
          createdAt: "2026-05-27T12:08:48Z",
        },
        {
          databaseId: 109,
          name: "Addressing review on PR owner/repo#17",
          status: "completed",
          conclusion: "failure",
          createdAt: "2026-05-27T11:08:48Z",
        },
      ])}\n`,
    }]);

    const result = await runNode(["--repo", "owner/repo", "--branch", "copilot/topic"], { env });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.activity, "concluded");
    assert.equal(payload.runId, 110);
    assert.equal(payload.runConclusion, "success");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-copilot-session-activity reports idle when no matching run names exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-session-idle-"));

  try {
    const env = await writeGhStub(tempDir, [{
      assertArgs: ["run", "list", "--repo", "owner/repo", "--branch", "copilot/topic"],
      stdout: `${JSON.stringify([
        {
          databaseId: 120,
          name: "CI",
          status: "completed",
          conclusion: "success",
          createdAt: "2026-05-27T13:08:48Z",
        },
      ])}\n`,
    }]);

    const result = await runNode(["--repo", "owner/repo", "--branch", "copilot/topic"], { env });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.activity, "idle");
    assert.equal(payload.runId, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

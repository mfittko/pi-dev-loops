import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/loop/summarize-loop-state.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
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

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("summarize-loop-state reports phases in deterministic order with validation and artifact presence", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-summarize-loop-state-"));

  try {
    await writeJson(path.join(tempDir, "tmp/phases/index.json"), {
      phases: [
        {
          phase: "phase-10",
          status: "completed",
          manifestPath: "tmp/phases/phase-10/manifest.json",
          updatedAt: "2026-05-13T10:00:00Z",
        },
        {
          phase: "phase-2",
          status: "planning",
          manifestPath: "tmp/phases/phase-2/manifest.json",
          updatedAt: "2026-05-13T09:00:00Z",
        },
      ],
    });

    await writeJson(path.join(tempDir, "tmp/phases/phase-2/manifest.json"), {
      phase: "phase-2",
      status: "planning",
      validation: {
        check: "passed",
        test: "passed",
        coverage: "not-run",
      },
      artifacts: ["b.md", "a.md"],
      subagents: ["subagents/001.md"],
      decisions: ["keep it simple"],
      notes: ["note"],
    });
    await mkdir(path.join(tempDir, "docs/phases"), { recursive: true });
    await writeFile(path.join(tempDir, "docs/phases/phase-2.md"), "# phase-2\n", "utf8");
    await writeFile(path.join(tempDir, "tmp/phases/phase-2/bash-exit-1.jsonl"), "", "utf8");

    await writeJson(path.join(tempDir, "tmp/phases/phase-10/manifest.json"), {
      phase: "phase-10",
      status: "completed",
      validation: {
        check: "passed",
        test: "passed",
        coverage: "passed",
      },
      artifacts: [],
      subagents: [],
      decisions: [],
      notes: [],
    });

    const result = await runNode(["--project-root", tempDir]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      projectRoot: tempDir,
      index: {
        path: path.join(tempDir, "tmp/phases/index.json"),
        exists: true,
        phaseCount: 2,
      },
      phases: [
        {
          phase: "phase-2",
          status: "planning",
          manifestPath: path.join(tempDir, "tmp/phases/phase-2/manifest.json"),
          manifestExists: true,
          validation: {
            check: "passed",
            test: "passed",
            coverage: "not-run",
          },
          artifactPresence: {
            phasePlan: true,
            bashExitOne: true,
          },
          artifactCounts: {
            artifacts: 2,
            subagents: 1,
            decisions: 1,
            notes: 1,
          },
        },
        {
          phase: "phase-10",
          status: "completed",
          manifestPath: path.join(tempDir, "tmp/phases/phase-10/manifest.json"),
          manifestExists: true,
          validation: {
            check: "passed",
            test: "passed",
            coverage: "passed",
          },
          artifactPresence: {
            phasePlan: false,
            bashExitOne: false,
          },
          artifactCounts: {
            artifacts: 0,
            subagents: 0,
            decisions: 0,
            notes: 0,
          },
        },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("summarize-loop-state handles a missing index deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-summarize-loop-missing-index-"));

  try {
    const result = await runNode(["--project-root", tempDir]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      projectRoot: tempDir,
      index: {
        path: path.join(tempDir, "tmp/phases/index.json"),
        exists: false,
        phaseCount: 0,
      },
      phases: [],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("summarize-loop-state reports missing manifests without failing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-summarize-loop-missing-manifest-"));

  try {
    await writeJson(path.join(tempDir, "tmp/phases/index.json"), {
      phases: [
        {
          phase: "phase-3",
          status: "awaiting-finalization",
          manifestPath: "tmp/phases/phase-3/manifest.json",
          updatedAt: "2026-05-13T12:00:00Z",
        },
      ],
    });

    const result = await runNode(["--project-root", tempDir]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      projectRoot: tempDir,
      index: {
        path: path.join(tempDir, "tmp/phases/index.json"),
        exists: true,
        phaseCount: 1,
      },
      phases: [
        {
          phase: "phase-3",
          status: "awaiting-finalization",
          manifestPath: path.join(tempDir, "tmp/phases/phase-3/manifest.json"),
          manifestExists: false,
          validation: {
            check: "missing",
            test: "missing",
            coverage: "missing",
          },
          artifactPresence: {
            phasePlan: false,
            bashExitOne: false,
          },
          artifactCounts: {
            artifacts: 0,
            subagents: 0,
            decisions: 0,
            notes: 0,
          },
        },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("summarize-loop-state rejects malformed arguments deterministically", async () => {
  const result = await runNode(["--wat"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: "Unknown argument: --wat",
  });
});

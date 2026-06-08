import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { writeGhStub as writeGhStubHelper } from "../_helpers.mjs";
import { parseCliArgs, isInternalPath, isConsumerPath } from "../../scripts/loop/detect-internal-only-pr.mjs";

const scriptPath = path.resolve("scripts/loop/detect-internal-only-pr.mjs");

async function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => { resolve({ code, stdout, stderr }); });
  });
}

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries);
  return env;
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test("detect-internal-only-pr --help prints usage", async () => {
  const result = await runNode(["--help"]);
  assert.equal(result.code, 0);
  assert(result.stdout.includes("detect-internal-only-pr.mjs"));
  assert(result.stdout.includes("--repo"));
  assert(result.stdout.includes("--pr"));
});

test("detect-internal-only-pr rejects missing arguments", async () => {
  const result = await runNode(["--repo", "owner/repo"]);
  assert.equal(result.code, 1);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert(err.error.includes("--pr"));
});

test("detect-internal-only-pr rejects unknown flags", async () => {
  const result = await runNode(["--repo", "owner/repo", "--pr", "17", "--unknown"]);
  assert.equal(result.code, 1);
  const err = JSON.parse(result.stderr);
  assert.equal(err.ok, false);
  assert(err.error.includes("Unknown argument"));
});

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

test("isInternalPath matches internal patterns", () => {
  assert.equal(isInternalPath("scripts/foo.mjs"), true);
  assert.equal(isInternalPath("test/foo.test.mjs"), true);
  assert.equal(isInternalPath("docs/readme.md"), true);
  assert.equal(isInternalPath("skills/docs/contract.md"), true);
  assert.equal(isInternalPath(".pi/dev-loop/settings.yaml"), true);
  assert.equal(isInternalPath(".github/workflows/ci.yml"), true);
});

test("isInternalPath rejects non-internal paths", () => {
  assert.equal(isInternalPath("packages/core/src/index.mjs"), false);
  assert.equal(isInternalPath("cli/index.mjs"), false);
  assert.equal(isInternalPath("skills/copilot-pr-followup/SKILL.md"), false);
  assert.equal(isInternalPath("package.json"), false);
  assert.equal(isInternalPath("README.md"), false);
});

test("isConsumerPath matches consumer-facing paths", () => {
  assert.equal(isConsumerPath("packages/core/src/index.mjs"), true);
  assert.equal(isConsumerPath("cli/index.mjs"), true);
  assert.equal(isConsumerPath("skills/copilot-pr-followup/SKILL.md"), true);
  assert.equal(isConsumerPath("skills/dev-loop/SKILL.md"), true);
  assert.equal(isConsumerPath("package.json"), true);
  assert.equal(isConsumerPath("README.md"), true);
});

test("isConsumerPath does not match internal paths", () => {
  assert.equal(isConsumerPath("scripts/foo.mjs"), false);
  assert.equal(isConsumerPath("docs/readme.md"), false);
  assert.equal(isConsumerPath("skills/docs/contract.md"), false);
  assert.equal(isConsumerPath(".pi/settings.yaml"), false);
  assert.equal(isConsumerPath("test/foo.test.mjs"), false);
  assert.equal(isConsumerPath(".github/workflows/ci.yml"), false);
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

test("parseCliArgs parses valid arguments", () => {
  const parsed = parseCliArgs(["--repo", "owner/repo", "--pr", "17"]);
  assert.equal(parsed.repo, "owner/repo");
  assert.equal(parsed.pr, 17);
  assert.equal(parsed.labelCheck, false);
});

test("parseCliArgs parses --label-check", () => {
  const parsed = parseCliArgs(["--repo", "owner/repo", "--pr", "17", "--label-check"]);
  assert.equal(parsed.labelCheck, true);
});

// ---------------------------------------------------------------------------
// Integration: internal-only detection via gh stub
// ---------------------------------------------------------------------------

test("detect-internal-only-pr returns internalOnly=true for scripts+test changes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "scripts/foo.mjs\ntest/foo.test.mjs\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, true);
    assert.deepEqual(output.files, ["scripts/foo.mjs", "test/foo.test.mjs"]);
    assert(output.reason.includes("internal tooling"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr returns internalOnly=false for consumer-facing changes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "packages/core/src/index.mjs\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, false);
    assert(output.reason.includes("Consumer-facing"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr returns internalOnly=false for mixed changes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "scripts/foo.mjs\npackages/core/src/index.mjs\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr returns internalOnly=false for empty file list", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, false);
    assert(output.reason.includes("No files"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr returns internalOnly=true for docs-only changes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "docs/readme.md\nskills/docs/contract.md\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr returns internalOnly=true for .pi config changes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: ".pi/dev-loop/settings.yaml\n.pi/dev-loop/defaults.yaml\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-internal-only-pr detects non-matching unknown paths as consumer-facing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-internal-"));
  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "files", "--jq", ".files[].path"],
        stdout: "scripts/foo.mjs\nunknown/custom-file.ts\n",
      },
    ]);
    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.internalOnly, false);
    assert(output.reason.includes("outside recognized patterns"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

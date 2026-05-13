import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/github/request-copilot-review.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve) => {
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
      'const entry = entries[Math.min(current, entries.length - 1)] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
      '      process.stderr.write(`missing expected gh arg: ${expected}\\n`);',
      '      process.exit(98);',
      '    }',
      '  }',
      '}',
      'if (entry.stderr) {',
      '  process.stderr.write(entry.stderr);',
      '}',
      'if (entry.stdout) {',
      '  process.stdout.write(entry.stdout);',
      '}',
      'process.exit(entry.exitCode ?? 0);',
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

test("request-copilot-review requests Copilot deterministically and verifies via requested_reviewers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-review-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "requested",
      repo: "owner/repo",
      pr: 17,
      reviewer: "Copilot",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review recognizes Copilot under the requested reviewer login returned by GitHub", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-login-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"copilot-pull-request-reviewer[bot]"}],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "already-requested",
      repo: "owner/repo",
      pr: 17,
      reviewer: "Copilot",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review reports already-requested without mutating PR state again", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-already-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[{"login":"Copilot"}],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[{"id":"r-1","author":{"login":"copilot-pull-request-reviewer[bot]"}}]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "already-requested",
      repo: "owner/repo",
      pr: 17,
      reviewer: "Copilot",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review accepts an immediate Copilot review as proof the request succeeded", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-immediate-review-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stdout: "https://github.com/owner/repo/pull/17\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[{"id":"r-2","author":{"login":"copilot-pull-request-reviewer[bot]"}}]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "requested",
      repo: "owner/repo",
      pr: 17,
      reviewer: "Copilot",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review normalizes known unrequestable/unavailable failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-unavailable-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
      {
        assertArgs: ["pr", "edit", "17", "--repo", "owner/repo", "--add-reviewer", "@copilot"],
        stderr: "gh: Reviews may only be requested from collaborators.\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      status: "unavailable",
      repo: "owner/repo",
      pr: 17,
      reviewer: "Copilot",
      detail: "gh: Reviews may only be requested from collaborators.",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review wraps invalid gh JSON deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-request-copilot-json-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: "not-json\n",
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "reviews"],
        stdout: '{"reviews":[]}\n',
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: "Invalid JSON from gh: not-json",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("request-copilot-review rejects malformed arguments deterministically", async () => {
  const missingPr = await runNode(["--repo", "owner/repo"]);
  assert.equal(missingPr.code, 1);
  assert.equal(missingPr.stdout, "");
  assert.deepEqual(JSON.parse(missingPr.stderr), {
    ok: false,
    error: "Requesting Copilot review requires both --repo <owner/name> and --pr <number>",
  });

  const zeroPr = await runNode(["--repo", "owner/repo", "--pr", "0"]);
  assert.equal(zeroPr.code, 1);
  assert.equal(zeroPr.stdout, "");
  assert.deepEqual(JSON.parse(zeroPr.stderr), {
    ok: false,
    error: "--pr must be a positive integer",
  });

  const unknown = await runNode(["--repo", "owner/repo", "--pr", "17", "--wat"]);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, "");
  assert.deepEqual(JSON.parse(unknown.stderr), {
    ok: false,
    error: "Unknown argument: --wat",
  });
});

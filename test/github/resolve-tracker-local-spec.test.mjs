import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseGitHubIssueUrl,
  parseResolveTrackerLocalSpecCliArgs,
} from "../../scripts/github/resolve-tracker-local-spec.mjs";

const scriptPath = path.resolve("scripts/github/resolve-tracker-local-spec.mjs");

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.execPath ?? process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", rejectOnce);
    child.on("close", (code) => {
      resolveOnce({ code, stdout, stderr });
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
      '  process.exit(97);',
      '}',
      'const entry = entries[current] ?? { stdout: "{}\\n" };',
      'writeFileSync(counterPath, String(current + 1));',
      'const actual = process.argv.slice(2);',
      'if (entry.assertArgs) {',
      '  for (const expected of entry.assertArgs) {',
      '    if (!actual.includes(expected)) {',
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

test("parseGitHubIssueUrl accepts full GitHub issue URLs", () => {
  assert.deepEqual(
    parseGitHubIssueUrl("https://github.com/Owner/Repo/issues/85?foo=bar#body"),
    { repo: "Owner/Repo", issue: 85 },
  );
});

test("parseResolveTrackerLocalSpecCliArgs resolves issue-url input into repo and issue", () => {
  assert.deepEqual(
    parseResolveTrackerLocalSpecCliArgs(["--issue-url", "https://github.com/owner/repo/issues/42"]),
    {
      help: false,
      repo: "owner/repo",
      issue: 42,
      issueUrl: "https://github.com/owner/repo/issues/42",
    },
  );
});

test("parseResolveTrackerLocalSpecCliArgs rejects mixed issue-url and repo/issue flags", () => {
  assert.throws(
    () => parseResolveTrackerLocalSpecCliArgs([
      "--issue-url",
      "https://github.com/owner/repo/issues/42",
      "--repo",
      "owner/repo",
      "--issue",
      "42",
    ]),
    /Use either --issue-url <url> or --repo <owner\/name> with --issue <number>, but not both/,
  );
});

test("resolve-tracker-local-spec resolves repo and issue inputs through gh issue view", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-resolve-tracker-local-spec-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["issue", "view", "85", "--repo", "owner/repo", "--json", "number,title,body,url,state"],
        stdout: `${JSON.stringify({
          number: 85,
          title: "Tracker-backed local contract",
          body: "Acceptance criteria live in this tracker issue.",
          url: "https://github.com/owner/repo/issues/85",
          state: "OPEN",
        })}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "85"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      issue: 85,
      issueUrl: "https://github.com/owner/repo/issues/85",
      state: "OPEN",
      title: "Tracker-backed local contract",
      body: "Acceptance criteria live in this tracker issue.",
      canonicalSpecSource: "tracker_issue",
      localImplementationMode: "tracker_backed",
      localPhaseDocAllowed: false,
      stateSync: "tracker_issue_is_canonical",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolve-tracker-local-spec accepts GitHub issue URLs as input", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-resolve-tracker-local-spec-url-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["issue", "view", "86", "--repo", "Owner/Repo"],
        stdout: `${JSON.stringify({
          number: 86,
          title: "Tracker-backed session",
          body: "",
          url: "https://github.com/Owner/Repo/issues/86",
          state: "CLOSED",
        })}\n`,
      },
    ]);

    const result = await runNode(["--issue-url", "https://github.com/Owner/Repo/issues/86"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "Owner/Repo",
      issue: 86,
      issueUrl: "https://github.com/Owner/Repo/issues/86",
      state: "CLOSED",
      title: "Tracker-backed session",
      body: "",
      canonicalSpecSource: "tracker_issue",
      localImplementationMode: "tracker_backed",
      localPhaseDocAllowed: false,
      stateSync: "tracker_issue_is_canonical",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolve-tracker-local-spec reports usage errors with usage payload", async () => {
  const result = await runNode(["--issue-url", "not-a-url"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /--issue-url must be a valid GitHub issue URL/);
  assert.match(payload.usage, /resolve-tracker-local-spec\.mjs/);
});


test("resolve-tracker-local-spec normalizes repo slug in gh call and output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-resolve-tracker-local-spec-normalize-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["issue", "view", "85", "--repo", "owner/repo"],
        stdout: `${JSON.stringify({
          number: 85,
          title: "Tracker-backed local contract",
          body: "Acceptance criteria live in this tracker issue.",
          url: "https://github.com/owner/repo/issues/85",
          state: "OPEN",
        })}
`,
      },
    ]);

    const result = await runNode(["--repo", "  owner/repo  ", "--issue", "85"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.repo, "owner/repo");
    assert.equal(payload.issue, 85);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
test("resolve-tracker-local-spec reports gh failures without usage for runtime errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-resolve-tracker-local-spec-ghfail-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["issue", "view", "85", "--repo", "owner/repo"],
        stderr: "issue not found\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--issue", "85"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /gh command failed: issue not found/);
    assert.equal("usage" in payload, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

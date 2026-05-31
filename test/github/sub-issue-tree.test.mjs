import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  compareExpectedSubIssueTree,
  parseSubIssueTreeCliArgs,
} from "../../scripts/github/sub-issue-tree.mjs";

const scriptPath = path.resolve("scripts/github/sub-issue-tree.mjs");

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
      '',
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

function inspectPayload({ hasNextPage = false, endCursor = null, issue, subIssues }) {
  return `${JSON.stringify({
    data: {
      repository: {
        issue: {
          ...issue,
          subIssuesSummary: {
            total: subIssues.length,
            completed: subIssues.filter((entry) => entry.state === "CLOSED").length,
            percentCompleted: subIssues.length === 0
              ? 0
              : Math.round((subIssues.filter((entry) => entry.state === "CLOSED").length / subIssues.length) * 100),
          },
          subIssues: {
            pageInfo: { hasNextPage, endCursor },
            nodes: subIssues,
          },
        },
      },
    },
  })}\n`;
}

function issueNode(number, title, state = "OPEN") {
  return {
    id: `ISSUE_${number}`,
    number,
    title,
    url: `https://github.com/owner/repo/issues/${number}`,
    state,
    repository: { nameWithOwner: "owner/repo" },
    parent: null,
  };
}

function subIssueNode(number, title, parentNumber, state = "OPEN") {
  return {
    id: `ISSUE_${number}`,
    number,
    title,
    url: `https://github.com/owner/repo/issues/${number}`,
    state,
    repository: { nameWithOwner: "owner/repo" },
    parent: parentNumber === null ? null : { number: parentNumber },
  };
}

function resolveIssuesPayload(entries) {
  const repository = {};
  for (const [alias, node] of Object.entries(entries)) {
    repository[alias] = node;
  }

  return `${JSON.stringify({ data: { repository } })}\n`;
}

function mutationPayload(name) {
  return `${JSON.stringify({ data: { [name]: { clientMutationId: null } } })}\n`;
}

test("parseSubIssueTreeCliArgs parses inspect and verify commands", () => {
  assert.deepEqual(parseSubIssueTreeCliArgs(["inspect", "--repo", "owner/repo", "--issue", "97"]), {
    help: false,
    command: "inspect",
    repo: "owner/repo",
    issue: 97,
  });

  assert.deepEqual(
    parseSubIssueTreeCliArgs([
      "verify",
      "--repo",
      "owner/repo",
      "--parent",
      "97",
      "--expect-children",
      "123,124,125",
    ]),
    {
      help: false,
      command: "verify",
      repo: "owner/repo",
      parent: 97,
      expectChildren: [123, 124, 125],
    },
  );
});

test("parseSubIssueTreeCliArgs rejects malformed reprioritize arguments", () => {
  assert.throws(
    () => parseSubIssueTreeCliArgs(["reprioritize", "--repo", "owner/repo", "--parent", "97", "--child", "123"]),
    /requires exactly one of --after <number> or --before <number>/i,
  );

  assert.throws(
    () => parseSubIssueTreeCliArgs([
      "reprioritize",
      "--repo",
      "owner/repo",
      "--parent",
      "97",
      "--child",
      "123",
      "--after",
      "124",
      "--before",
      "125",
    ]),
    /requires exactly one of --after <number> or --before <number>/i,
  );

  assert.throws(
    () => parseSubIssueTreeCliArgs([
      "verify",
      "--repo",
      "owner/repo",
      "--parent",
      "97",
      "--expect-children",
      "123,123",
    ]),
    /duplicate issue number/i,
  );
});

test("compareExpectedSubIssueTree reports exact-order mismatches", () => {
  const result = compareExpectedSubIssueTree({
    parent: { number: 97 },
    subIssues: [{ number: 123 }, { number: 125 }, { number: 124 }],
  }, [123, 124, 125]);

  assert.equal(result.matches, false);
  assert.deepEqual(result.actualOrder, [123, 125, 124]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.misordered, [
    { number: 124, expectedIndex: 2, actualIndex: 3 },
    { number: 125, expectedIndex: 3, actualIndex: 2 },
  ]);
});

test("sub-issue-tree inspect paginates and returns normalized tree output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-inspect-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stdout: inspectPayload({
          hasNextPage: true,
          endCursor: "cursor-1",
          issue: issueNode(97, "Mini-epic"),
          subIssues: [subIssueNode(123, "Contract", 97)],
        }),
      },
      {
        assertArgs: ["api", "graphql", "after=cursor-1"],
        stdout: inspectPayload({
          hasNextPage: false,
          endCursor: null,
          issue: issueNode(97, "Mini-epic"),
          subIssues: [subIssueNode(124, "Harness", 97), subIssueNode(125, "Artifacts", 97, "CLOSED")],
        }),
      },
    ]);

    const result = await runNode(["inspect", "--repo", "owner/repo", "--issue", "97"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      parent: {
        number: 97,
        title: "Mini-epic",
        url: "https://github.com/owner/repo/issues/97",
        state: "OPEN",
      },
      subIssues: [
        {
          number: 123,
          title: "Contract",
          url: "https://github.com/owner/repo/issues/123",
          state: "OPEN",
          parentNumber: 97,
          position: 1,
        },
        {
          number: 124,
          title: "Harness",
          url: "https://github.com/owner/repo/issues/124",
          state: "OPEN",
          parentNumber: 97,
          position: 2,
        },
        {
          number: 125,
          title: "Artifacts",
          url: "https://github.com/owner/repo/issues/125",
          state: "CLOSED",
          parentNumber: 97,
          position: 3,
        },
      ],
      summary: {
        total: 3,
        completed: 1,
        percentCompleted: 33,
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});





test("sub-issue-tree wraps gh failures with a stable prefix", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-gh-failure-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stderr: "api down\n",
        exitCode: 42,
      },
    ]);

    const result = await runNode(["inspect", "--repo", "owner/repo", "--issue", "97"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /gh command failed: api down/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sub-issue-tree inspect reports a missing parent issue clearly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-missing-parent-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stdout: `${JSON.stringify({
          data: {
            repository: {
              issue: null,
            },
          },
        })}\n`,
      },
    ]);

    const result = await runNode(["inspect", "--repo", "owner/repo", "--issue", "97"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Could not resolve issue #97 in owner\/repo/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sub-issue-tree add attaches an existing child and returns refreshed tree", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-add-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97", "child=126"],
        stdout: resolveIssuesPayload({
          parentIssue: issueNode(97, "Mini-epic"),
          childIssue: subIssueNode(126, "Sub-issue tree tooling", null),
        }),
      },
      {
        assertArgs: ["api", "graphql", "issueId=ISSUE_97", "subIssueId=ISSUE_126"],
        stdout: mutationPayload("addSubIssue"),
      },
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stdout: inspectPayload({
          hasNextPage: false,
          endCursor: null,
          issue: issueNode(97, "Mini-epic"),
          subIssues: [subIssueNode(126, "Sub-issue tree tooling", 97)],
        }),
      },
    ]);

    const result = await runNode(["add", "--repo", "owner/repo", "--parent", "97", "--child", "126"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "add");
    assert.equal(payload.parent.number, 97);
    assert.deepEqual(payload.subIssues.map((entry) => entry.number), [126]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sub-issue-tree reprioritize reorders by before/after reference and returns refreshed tree", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-reprioritize-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97", "child=125", "before=123"],
        stdout: resolveIssuesPayload({
          parentIssue: issueNode(97, "Mini-epic"),
          childIssue: subIssueNode(125, "Artifacts", 97),
          beforeIssue: subIssueNode(123, "Contract", 97),
        }),
      },
      {
        assertArgs: ["api", "graphql", "issueId=ISSUE_97", "subIssueId=ISSUE_125", "beforeId=ISSUE_123"],
        stdout: mutationPayload("reprioritizeSubIssue"),
      },
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stdout: inspectPayload({
          hasNextPage: false,
          endCursor: null,
          issue: issueNode(97, "Mini-epic"),
          subIssues: [
            subIssueNode(125, "Artifacts", 97),
            subIssueNode(123, "Contract", 97),
            subIssueNode(124, "Harness", 97),
          ],
        }),
      },
    ]);

    const result = await runNode([
      "reprioritize",
      "--repo",
      "owner/repo",
      "--parent",
      "97",
      "--child",
      "125",
      "--before",
      "123",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "reprioritize");
    assert.deepEqual(payload.subIssues.map((entry) => entry.number), [125, 123, 124]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sub-issue-tree verify reports mismatches deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-sub-issue-tree-verify-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "graphql", "owner=owner", "name=repo", "parent=97"],
        stdout: inspectPayload({
          hasNextPage: false,
          endCursor: null,
          issue: issueNode(97, "Mini-epic"),
          subIssues: [
            subIssueNode(123, "Contract", 97),
            subIssueNode(125, "Artifacts", 97),
            subIssueNode(124, "Harness", 97),
          ],
        }),
      },
    ]);

    const result = await runNode([
      "verify",
      "--repo",
      "owner/repo",
      "--parent",
      "97",
      "--expect-children",
      "123,124,125",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "verify",
      repo: "owner/repo",
      parent: {
        number: 97,
        title: "Mini-epic",
        url: "https://github.com/owner/repo/issues/97",
        state: "OPEN",
      },
      matches: false,
      expectedOrder: [123, 124, 125],
      actualOrder: [123, 125, 124],
      missing: [],
      unexpected: [],
      misordered: [
        { number: 124, expectedIndex: 2, actualIndex: 3 },
        { number: 125, expectedIndex: 3, actualIndex: 2 },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

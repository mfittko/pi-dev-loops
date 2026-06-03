import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper } from "../_helpers.mjs";

import {
  parseAuditMergedPrGateEvidenceCliArgs,
} from "../../scripts/github/audit-merged-pr-gate-evidence.mjs";

const scriptPath = path.resolve("scripts/github/audit-merged-pr-gate-evidence.mjs");
const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries);
  return env;
}

function gateComment({ gate, sha, verdict = "clean", id }) {
  return {
    id,
    body: [
      `Gate review: ${gate}`,
      `Reviewed head SHA: ${sha}`,
      `Verdict: ${verdict}`,
      "Findings summary: no issues found",
      gate === "draft_gate" ? "Next action: mark ready for review" : "Next action: await final human approval",
    ].join("\n"),
    updated_at: "2026-06-03T10:00:00Z",
    html_url: `https://github.com/owner/repo/pull/1#issuecomment-${id}`,
  };
}

test("parseAuditMergedPrGateEvidenceCliArgs parses defaults", () => {
  const options = parseAuditMergedPrGateEvidenceCliArgs(["--repo", "owner/repo"]);

  assert.equal(options.repo, "owner/repo");
  assert.equal(options.limit, 20);
  assert.equal(options.outputPath, undefined);
});

test("parseAuditMergedPrGateEvidenceCliArgs rejects malformed arguments", () => {
  assert.throws(
    () => parseAuditMergedPrGateEvidenceCliArgs([]),
    /requires --repo <owner\/name>/i,
  );
  assert.throws(
    () => parseAuditMergedPrGateEvidenceCliArgs(["--repo", "owner/repo", "--limit", "0"]),
    /positive integer/i,
  );
  assert.throws(
    () => parseAuditMergedPrGateEvidenceCliArgs(["--repo", "bad slug"]),
    /owner\/name/i,
  );
  assert.throws(
    () => parseAuditMergedPrGateEvidenceCliArgs(["--repo", "owner/repo", "--output", "   "]),
    /non-empty path/i,
  );
});

test("audit-merged-pr-gate-evidence reports missing gate evidence among recent merged PRs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-merged-gates-"));
  const outputPath = path.join(tempDir, "audit.json");

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100"],
        stdout: `${JSON.stringify([
          [
            {
              number: 10,
              title: "Clean PR",
              html_url: "https://github.com/owner/repo/pull/10",
              merged_at: "2026-06-03T12:00:00Z",
              head: { sha: "abc1234" },
            },
            {
              number: 9,
              title: "Missing gates",
              html_url: "https://github.com/owner/repo/pull/9",
              merged_at: "2026-06-03T11:00:00Z",
              head: { sha: "def5678" },
            },
            {
              number: 8,
              title: "Closed unmerged",
              html_url: "https://github.com/owner/repo/pull/8",
              merged_at: null,
              head: { sha: "9999999" },
            },
          ],
        ])}\n`,
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/10/comments?per_page=100"],
        stdout: `${JSON.stringify([
          gateComment({ gate: "draft_gate", sha: "bcd1111", id: 100 }),
          gateComment({ gate: "pre_approval_gate", sha: "abc1234", id: 101 }),
        ])}\n`,
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/9/comments?per_page=100"],
        stdout: "[]\n",
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--limit", "2", "--output", outputPath], { env });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.auditedCount, 2);
    assert.equal(payload.allHaveRequiredGateEvidence, false);
    assert.equal(payload.missingEvidence.length, 1);
    assert.equal(payload.missingEvidence[0].pr, 9);
    assert.deepEqual(payload.missingEvidence[0].failures, [
      "missing visible clean draft_gate comment",
      "missing visible clean current-head pre_approval_gate comment",
    ]);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), payload);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-merged-pr-gate-evidence reports gh failures deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-audit-merged-gates-fail-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["api", "repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100"],
        stderr: "boom\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /gh command failed: boom/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import {
  parseGateReviewCommentMarkerBody,
  parseGateReviewCommentBody,
  summarizeGateReviewCommentMarkers,
  summarizeGateReviewComments,
} from "../../scripts/_core-helpers.mjs";
import {
  parseDetectGateReviewEvidenceCliArgs,
} from "../../scripts/github/detect-gate-review-evidence.mjs";

const scriptPath = path.resolve("scripts/github/detect-gate-review-evidence.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries, { repeatLastOnOverflow: true });
  return env;
}

test("parseGateReviewCommentBody parses the deterministic visible gate comment format", () => {
  const parsed = parseGateReviewCommentBody([
    "Gate review: `draft_gate`",
    "Reviewed head SHA: `ABC1234`",
    "Verdict: clean",
    "Findings summary: no issues found",
    "Next action: mark ready for review",
  ].join("\n"));

  assert.deepEqual(parsed, {
    gate: "draft_gate",
    headSha: "abc1234",
    verdict: "clean",
    findingsSummary: "no issues found",
    nextAction: "mark ready for review",
  });
});

test("parseGateReviewCommentBody rejects comments missing required contract fields", () => {
  assert.equal(parseGateReviewCommentBody([
    "Gate review: draft_gate",
    "Reviewed head SHA: abc1234",
    "Verdict: clean",
    "Findings summary: no issues found",
  ].join("\n")), null);
});

test("parseGateReviewCommentMarkerBody accepts gate/head markers even when contract fields are partial", () => {
  const parsed = parseGateReviewCommentMarkerBody([
    "Gate review: draft_gate",
    "Reviewed head SHA: abc1234",
    "Verdict: clean",
  ].join("\n"));

  assert.deepEqual(parsed, {
    gate: "draft_gate",
    headSha: "abc1234",
    verdict: "clean",
    findingsSummary: null,
    nextAction: null,
    contractComplete: false,
  });
});

test("summarizeGateReviewComments keeps the newest valid comment for each gate", () => {
  const summary = summarizeGateReviewComments([
    {
      id: 10,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: old1234",
        "Verdict: findings_present",
        "Findings summary: fix tests",
        "Next action: stay draft and fix",
      ].join("\n"),
      updated_at: "2026-05-29T20:00:00Z",
    },
    {
      id: 11,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: abc1234",
        "Verdict: clean",
        "Findings summary: no issues found",
        "Next action: mark ready for review",
      ].join("\n"),
      updated_at: "2026-05-29T21:00:00Z",
    },
    {
      id: 12,
      body: [
        "Gate review: pre_approval_gate",
        "Reviewed head SHA: abc1234",
        "Verdict: clean",
        "Findings summary: no issues found",
        "Next action: await final human approval",
      ].join("\n"),
      updated_at: "2026-05-29T22:00:00Z",
    },
  ]);

  assert.equal(summary.draft_gate?.commentId, 11);
  assert.equal(summary.draft_gate?.headSha, "abc1234");
  assert.equal(summary.pre_approval_gate?.commentId, 12);
  assert.equal(summary.pre_approval_gate?.nextAction, "await final human approval");
});

test("summarizeGateReviewCommentMarkers can target the newest marker for the current gate+head pair", () => {
  const summary = summarizeGateReviewCommentMarkers([
    {
      id: 10,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: abc1234",
        "Verdict: clean",
      ].join("\n"),
      updated_at: "2026-05-29T20:00:00Z",
    },
    {
      id: 11,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: def5678",
        "Verdict: clean",
        "Findings summary: later head marker",
        "Next action: rerun gate",
      ].join("\n"),
      updated_at: "2026-05-29T21:00:00Z",
    },
  ], { headSha: "abc1234" });

  assert.equal(summary.draft_gate?.commentId, 10);
  assert.equal(summary.draft_gate?.headSha, "abc1234");
});

test("summarizeGateReviewCommentMarkers keeps newest gate+head marker even if contract fields are malformed", () => {
  const summary = summarizeGateReviewCommentMarkers([
    {
      id: 10,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: abc1234",
        "Verdict: clean",
        "Findings summary: no issues found",
        "Next action: mark ready for review",
      ].join("\n"),
      updated_at: "2026-05-29T20:00:00Z",
    },
    {
      id: 11,
      body: [
        "Gate review: draft_gate",
        "Reviewed head SHA: abc1234",
        "Verdict: clean",
      ].join("\n"),
      updated_at: "2026-05-29T21:00:00Z",
    },
  ]);

  assert.equal(summary.draft_gate?.commentId, 11);
  assert.equal(summary.draft_gate?.headSha, "abc1234");
  assert.equal(summary.draft_gate?.contractComplete, false);
});

test("parseDetectGateReviewEvidenceCliArgs rejects malformed arguments deterministically", () => {
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs([]),
    /requires both --repo <owner\/name> and --pr <number>/i,
  );
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs(["--repo", "owner/repo", "--pr", "0"]),
    /positive integer/i,
  );
  assert.throws(
    () => parseDetectGateReviewEvidenceCliArgs(["--repo", "bad slug", "--pr", "17"]),
    /match <owner\/name>/i,
  );
});

test("detect-gate-review-evidence summarizes the newest valid live gate comments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 41,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: old5678",
              "Verdict: findings_present",
              "Findings summary: missing tests",
              "Next action: stay draft and fix",
            ].join("\n"),
            updated_at: "2026-05-29T20:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-41",
          },
          {
            id: 42,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: abc1234",
              "Verdict: clean",
              "Findings summary: no issues found",
              "Next action: mark ready for review",
            ].join("\n"),
            updated_at: "2026-05-29T21:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-42",
          },
          {
            id: 43,
            body: [
              "Gate review: pre_approval_gate",
              "Reviewed head SHA: abc1234",
              "Verdict: clean",
              "Findings summary: no issues found",
              "Next action: await final human approval",
            ].join("\n"),
            updated_at: "2026-05-29T22:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-43",
          },
          {
            id: 44,
            body: "not a gate comment",
            updated_at: "2026-05-29T23:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      repo: "owner/repo",
      pr: 17,
      currentHeadSha: "abc1234",
      draftGate: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "mark ready for review",
        commentId: 42,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-42",
        updatedAt: "2026-05-29T21:00:00Z",
      },
      preApprovalGate: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "await final human approval",
        commentId: 43,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-43",
        updatedAt: "2026-05-29T22:00:00Z",
      },
      draftGateMarker: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "mark ready for review",
        contractComplete: true,
        commentId: 42,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-42",
        updatedAt: "2026-05-29T21:00:00Z",
      },
      preApprovalGateMarker: {
        visible: true,
        headSha: "abc1234",
        verdict: "clean",
        findingsSummary: "no issues found",
        nextAction: "await final human approval",
        contractComplete: true,
        commentId: 43,
        commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-43",
        updatedAt: "2026-05-29T22:00:00Z",
      },
      draftGateSatisfied: true,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-gate-review-evidence flattens paginated issue-comment payloads before summarizing gates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-pages-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          [
            {
              id: 51,
              body: "noise",
              updated_at: "2026-05-29T20:00:00Z",
            },
          ],
          [
            {
              id: 52,
              body: [
                "Gate review: draft_gate",
                "Reviewed head SHA: abc1234",
                "Verdict: clean",
                "Findings summary: no issues found",
                "Next action: mark ready for review",
              ].join("\n"),
              updated_at: "2026-05-29T21:00:00Z",
              html_url: "https://github.com/owner/repo/pull/17#issuecomment-52",
            },
          ],
        ])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).draftGate.commentId, 52);
    assert.equal(JSON.parse(result.stdout).draftGate.visible, true);
    assert.equal(JSON.parse(result.stdout).draftGateMarker.commentId, 52);
    assert.equal(JSON.parse(result.stdout).draftGateSatisfied, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-gate-review-evidence exposes same-head markers even when latest gate contract fields are partial", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-marker-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 61,
            body: [
              "Gate review: draft_gate",
              "Reviewed head SHA: abc1234",
              "Verdict: clean",
            ].join("\n"),
            updated_at: "2026-05-29T21:00:00Z",
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-61",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.draftGate.visible, false);
    assert.equal(payload.draftGateMarker.visible, true);
    assert.equal(payload.draftGateMarker.headSha, "abc1234");
    assert.equal(payload.draftGateMarker.findingsSummary, null);
    assert.equal(payload.draftGateMarker.nextAction, null);
    assert.equal(payload.draftGateMarker.contractComplete, false);
    assert.equal(payload.draftGateMarker.commentId, 61);
    assert.equal(payload.draftGateSatisfied, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detect-gate-review-evidence reports gh failures deterministically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-detect-gate-review-evidence-fail-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stderr: "boom\n",
        exitCode: 1,
      },
    ]);

    const result = await runNode(["--repo", "owner/repo", "--pr", "17"], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error, /gh command failed: boom/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

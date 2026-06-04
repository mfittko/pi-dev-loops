import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runNode as runNodeHelper, writeGhStub as writeGhStubHelper, writeJson as writeJsonHelper } from "../_helpers.mjs";

import {
  parseUpsertCheckpointVerdictCliArgs,
  summarizeGateReviewText,
  upsertCheckpointVerdict,
} from "../../scripts/github/upsert-checkpoint-verdict.mjs";

const scriptPath = path.resolve("scripts/github/upsert-checkpoint-verdict.mjs");

const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

async function writeGhStub(tempDir, entries) {
  const { env } = await writeGhStubHelper(tempDir, entries, { repeatLastOnOverflow: true });
  return env;
}

function buildGateCoordinationEntries({
  repo = "owner/repo",
  pr = 17,
  headSha = "abc1234",
  isDraft = true,
  statusCheckRollup = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
  reviews = [],
  reviewThreadsPayload = { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } },
  issueComments = [],
}) {
  return [
    {
      assertArgs: ["pr", "view", String(pr), "--repo", repo, "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
      stdout: JSON.stringify({
        number: pr,
        state: "OPEN",
        isDraft,
        headRefOid: headSha,
        reviews,
        statusCheckRollup,
      }) + "\n",
    },
    {
      assertArgs: ["api", `repos/${repo}/pulls/${pr}/requested_reviewers`],
      stdout: '{"users":[],"teams":[]}\n',
    },
    {
      assertArgs: ["api", "graphql", `pr=${pr}`],
      stdout: JSON.stringify(reviewThreadsPayload) + "\n",
    },
    {
      assertArgs: ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid"],
      stdout: JSON.stringify({ headRefOid: headSha }) + "\n",
    },
    {
      assertArgs: ["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments?per_page=100`],
      stdout: JSON.stringify(issueComments) + "\n",
    },
  ];
}

function buildGateComment({
  gate = "draft_gate",
  headSha = "abc1234",
  verdict = "clean",
  findingsSummary = "no issues found",
  nextAction = "mark ready for review",
  commentId = 101,
  pr = 17,
  updatedAt = "2026-05-30T17:00:00Z",
}) {
  return {
    id: commentId,
    body: [
      `### Gate review: \`${gate}\``,
      "",
      `**Reviewed head SHA:** \`${headSha}\``,
      `**Verdict:** ${verdict}`,
      "",
      `**Findings summary:** ${findingsSummary}`,
      "",
      `**Next action:** ${nextAction}`,
    ].join("\n"),
    html_url: `https://github.com/owner/repo/pull/${pr}#issuecomment-${commentId}`,
    updated_at: updatedAt,
  };
}

test("parseUpsertCheckpointVerdictCliArgs rejects malformed arguments deterministically", () => {
  assert.throws(
    () => parseUpsertCheckpointVerdictCliArgs([]),
    /requires --repo, --pr, --gate, --head-sha, --verdict, --findings-summary, and --next-action/i,
  );

  const parsed = parseUpsertCheckpointVerdictCliArgs([
    "--repo", "owner/repo",
    "--pr", "17",
    "--gate", "draft_gate",
    "--head-sha", "ABC1234",
    "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
    "--findings-summary", "no issues found",
    "--next-action", "mark ready for review",
  ]);
  assert.equal(parsed.headSha, "abc1234");

  assert.throws(
    () => parseUpsertCheckpointVerdictCliArgs([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "not-a-sha",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ]),
    /7-64 character hexadecimal SHA/i,
  );
});

test("parseUpsertCheckpointVerdictCliArgs accepts --force with normalized --force-reason", () => {
  const parsed = parseUpsertCheckpointVerdictCliArgs([
    "--repo", "owner/repo",
    "--pr", "17",
    "--gate", "draft_gate",
    "--head-sha", "ABC1234",
    "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
    "--findings-summary", "no issues found",
    "--next-action", "mark ready for review",
    "--force",
    "--force-reason", `  CI
   cancelled   due   to infra  `,
  ]);

  assert.equal(parsed.force, true);
  assert.equal(parsed.forceReason, "CI cancelled due to infra");
});

test("parseUpsertCheckpointVerdictCliArgs rejects --force without --force-reason", () => {
  assert.throws(
    () => parseUpsertCheckpointVerdictCliArgs([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force",
    ]),
    /--force requires --force-reason/i,
  );
});

test("parseUpsertCheckpointVerdictCliArgs rejects --force-reason without --force", () => {
  assert.throws(
    () => parseUpsertCheckpointVerdictCliArgs([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force-reason", "CI cancelled due to infra",
    ]),
    /--force-reason requires --force/i,
  );
});

test("upsertCheckpointVerdict rejects programmatic force without forceReason before any gh calls", async () => {
  await assert.rejects(
    () => upsertCheckpointVerdict({
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      verdict: "clean",
      findingsSummary: "no issues found",
      nextAction: "mark ready for review",
      force: true,
    }),
    /force requires forceReason when calling upsertCheckpointVerdict\(\)/i,
  );
});

test("parseUpsertCheckpointVerdictCliArgs rejects blank --force-reason", () => {
  assert.throws(
    () => parseUpsertCheckpointVerdictCliArgs([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force",
      "--force-reason", "\n",
    ]),
    /--force-reason must be a non-empty string/i,
  );
});

test("summarizeGateReviewText compacts verbose validation success logs deterministically", () => {
  assert.equal(
    summarizeGateReviewText([
      "Validation: verbose local logs follow",
      "> npm test",
      "ℹ tests 46",
      "ℹ pass 46",
      "ℹ fail 0",
      "GitHub CI test passed on the current head.",
      "stdout: this raw passing output should not appear in the visible gate comment body.",
    ].join("\n")),
    "commands: npm test; tests: 46, pass: 46, fail: 0; ci: GitHub CI test passed on the current head.",
  );
});

test("summarizeGateReviewText keeps failing validation to a concise excerpt", () => {
  assert.equal(
    summarizeGateReviewText([
      "> npm test",
      "ℹ tests 46",
      "ℹ pass 45",
      "ℹ fail 1",
      "✖ test/github/upsert-checkpoint-verdict.test.mjs",
      "AssertionError: Expected values to be strictly equal: 1 !== 2",
      "at TestContext.<anonymous> (/tmp/workspace/mfittko/pi-dev-loops/test/github/upsert-checkpoint-verdict.test.mjs:42:10)",
    ].join("\n")),
    "commands: npm test; tests: 46, pass: 45, fail: 1; failure excerpt: test/github/upsert-checkpoint-verdict.test.mjs",
  );
});


test("summarizeGateReviewText preserves long single-line narratives instead of inventing a log summary", () => {
  const narrative = "Passed reviewer note: keep the operator-facing summary readable even when Error and passed appear in the same explanatory sentence, because this is narrative text rather than a multiline validation log. ".repeat(3).trim();
  const summarized = summarizeGateReviewText(narrative, 140);

  assert.match(summarized, /^Passed reviewer note:/);
  assert.match(summarized, /Error and passed appear/);
  assert.doesNotMatch(summarized, /^validation: passed$/);
  assert.match(summarized, /…\[truncated \d+ chars\]$/);
});


test("summarizeGateReviewText preserves multiline narrative text when no structured validation signals are present", () => {
  const narrative = [
    "Validation recap:",
    "The operator passed through the flow carefully.",
    "Nothing here is a command log or CI line.",
  ].join("\n");

  assert.equal(
    summarizeGateReviewText(narrative),
    "Validation recap: The operator passed through the flow carefully. Nothing here is a command log or CI line.",
  );
});

test("summarizeGateReviewText captures Error-prefixed failure lines", () => {
  assert.equal(
    summarizeGateReviewText([
      "> npm test",
      "Error: Expected gate summary to stay bounded",
      "detail: additional stack output that should not become the visible excerpt",
    ].join("\n")),
    "commands: npm test; failure excerpt: Error: Expected gate summary to stay bounded",
  );
});


test("summarizeGateReviewText does not treat markdown headings as shell commands", () => {
  const narrative = [
    "# Summary",
    "Validation recap passed through manual review.",
    "## Notes",
    "This is prose, not a shell transcript.",
  ].join("\n");

  assert.equal(
    summarizeGateReviewText(narrative),
    "# Summary Validation recap passed through manual review. ## Notes This is prose, not a shell transcript.",
  );
});

test("upsert-checkpoint-verdict allows forced draft_gate create when current-head CI failure is the only blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-draft-"));

  try {
    const env = await writeGhStub(tempDir, [
      ...buildGateCoordinationEntries({
        isDraft: true,
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
      }),
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      forced: true,
      forceReason: "CI cancelled due to infrastructure",
      forceBypass: "ci_blocked_needs_user_decision",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict allows forced pre_approval_gate create when current-head CI failure is the only blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-preapproval-"));

  try {
    const env = await writeGhStub(tempDir, [
      ...buildGateCoordinationEntries({
        isDraft: false,
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
      }),
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stdout: '{"id":102,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-102"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "pre_approval_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "await final human approval",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "pre_approval_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 102,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-102",
      forced: true,
      forceReason: "CI cancelled due to infrastructure",
      forceBypass: "ci_blocked_needs_user_decision",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict keeps CI-blocked gate upserts fail-closed without --force and points to the escape hatch", async () => {
  for (const scenario of [
    { gate: "draft_gate", isDraft: true, nextAction: "mark ready for review" },
    { gate: "pre_approval_gate", isDraft: false, nextAction: "await final human approval" },
  ]) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `pi-dev-loops-upsert-gate-review-force-required-${scenario.gate}-`));

    try {
      const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
        isDraft: scenario.isDraft,
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
      }));

      const result = await runNode([
        "--repo", "owner/repo",
        "--pr", "17",
        "--gate", scenario.gate,
        "--head-sha", "abc1234",
        "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
        "--findings-summary", "no issues found",
        "--next-action", scenario.nextAction,
      ], { env });

      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      const payload = JSON.parse(result.stderr);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /Cannot enter/);
      assert.match(payload.error, /--force --force-reason/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test("upsert-checkpoint-verdict forced update includes forced metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-update-"));

  try {
    const env = await writeGhStub(tempDir, [
      ...buildGateCoordinationEntries({
        isDraft: true,
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
        issueComments: [buildGateComment({
          gate: "draft_gate",
          verdict: "blocked",
          findingsSummary: "older forced summary",
          nextAction: "wait for explicit CI bypass decision",
        })],
      }),
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/101", "-f"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "blocked",
      "--findings-summary", "CI failed on the current head",
      "--next-action", "wait for explicit CI bypass decision",
      "--force",
      "--force-reason", "CI failed due to transient infrastructure",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      forced: true,
      forceReason: "CI failed due to transient infrastructure",
      forceBypass: "ci_blocked_needs_user_decision",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict forced noop includes forced metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-noop-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: true,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
      issueComments: [buildGateComment({
        gate: "draft_gate",
        verdict: "blocked",
        findingsSummary: "CI failed on the current head",
        nextAction: "wait for explicit CI bypass decision",
      })],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "blocked",
      "--findings-summary", "CI failed on the current head",
      "--next-action", "wait for explicit CI bypass decision",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "noop",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      forced: true,
      forceReason: "CI cancelled due to infrastructure",
      forceBypass: "ci_blocked_needs_user_decision",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict does not use --force to bypass non-CI pre_approval_gate refusal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-non-ci-preapproval-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: false,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "pre_approval_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "await final human approval",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter pre_approval_gate/i);
    assert.doesNotMatch(payload.error, /--force --force-reason/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict does not use --force to bypass draft_gate refusal on a non-draft PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-non-draft-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: false,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter draft_gate/i);
    assert.doesNotMatch(payload.error, /--force --force-reason/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict stale-head protection still fails closed with --force", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-force-stale-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      headSha: "def5678",
      isDraft: true,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--force",
      "--force-reason", "CI cancelled due to infrastructure",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /does not match the current PR head SHA/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict creates a new comment when no same-head marker exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-create-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Reviewed head SHA:** `abc1234`", "**Next action:** mark ready for review"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict fails closed when pre-approval gate entry is still illegal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-illegal-preapproval-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":266,"state":"OPEN","isDraft":false,"headRefOid":"def56789abcdef","reviews":[],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def56789abcdef"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 11,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `c94679e`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/266#issuecomment-11",
          updated_at: "2026-05-31T20:00:00Z",
        }]])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "266",
      "--gate", "pre_approval_gate",
      "--head-sha", "def56789",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "await final human approval",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter pre_approval_gate/i);
    assert.match(payload.error, /request Copilot review before any/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict appends the round-cap fallback note to pre-approval evidence", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-round-cap-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: JSON.stringify({
          number: 17,
          state: "OPEN",
          isDraft: false,
          headRefOid: "abc1234",
          reviews: [
            { author: { login: "copilot-pull-request-reviewer[bot]" }, state: "COMMENTED", submittedAt: "2026-05-31T20:00:00Z", commit: { oid: "1111111111111111111111111111111111111111" } },
            { author: { login: "copilot-pull-request-reviewer[bot]" }, state: "COMMENTED", submittedAt: "2026-05-31T20:05:00Z", commit: { oid: "2222222222222222222222222222222222222222" } },
            { author: { login: "copilot-pull-request-reviewer[bot]" }, state: "COMMENTED", submittedAt: "2026-05-31T20:10:00Z", commit: { oid: "3333333333333333333333333333333333333333" } },
            { author: { login: "copilot-pull-request-reviewer[bot]" }, state: "COMMENTED", submittedAt: "2026-05-31T20:15:00Z", commit: { oid: "4444444444444444444444444444444444444444" } },
            { author: { login: "copilot-pull-request-reviewer[bot]" }, state: "COMMENTED", submittedAt: "2026-05-31T20:20:00Z", commit: { oid: "5555555555555555555555555555555555555555" } },
          ],
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
        }) + "\n",
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 91,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/17#issuecomment-91",
          updated_at: "2026-05-31T20:10:00Z",
        }]])}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: [
          "body=### Gate review: `pre_approval_gate`",
          "**Findings summary:** no issues found; Copilot review rounds exhausted (5/5); current head has zero unresolved threads and green or credibly green CI, so pre_approval_gate fallback is allowed without another Copilot re-request.",
        ],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "pre_approval_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "await final human approval",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "pre_approval_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict truncates verbose findings summary before comment creation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-verbose-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":false,"headRefOid":"abc1234","reviews":[{"author":{"login":"copilot-pull-request-reviewer"},"state":"COMMENTED","submittedAt":"2026-05-31T20:00:00Z","commit":{"oid":"abc1234"}}],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 91,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/17#issuecomment-91",
          updated_at: "2026-05-31T20:10:00Z",
        }]])}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: [
          "body=### Gate review: `pre_approval_gate`",
          "**Findings summary:** commands: npm test; tests: 46, pass: 46, fail: 0; ci: GitHub CI test passed on the current head.",
        ],
        assertArgNotContains: ["stdout: this raw passing output should not appear"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);
    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "pre_approval_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", [
        "Validation: verbose local logs follow",
        "> npm test",
        "ℹ tests 46",
        "ℹ pass 46",
        "ℹ fail 0",
        "GitHub CI test passed on the current head.",
        "stdout: this raw passing output should not appear in the visible gate comment body.",
      ].join("\n"),
      "--next-action", "await final human approval",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "created",
      repo: "owner/repo",
      pr: 17,
      gate: "pre_approval_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict suppresses duplicate repost when the current same-head comment already matches", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-noop-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "noop",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
    // 5 gh calls: pr facts + requested_reviewers + review threads + headRefOid + issue comments
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), 5);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict noop still warns when a stale comment exists on a different head", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-noop-warn-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `def5678`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** older review",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, "noop");
    assert.equal(parsed.headSha, "abc1234");
    assert.match(parsed.warning, /different head SHA/i);
    assert.match(parsed.warning, /def5678/);
    assert.match(parsed.warning, /comment 202/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict updates an incomplete same-head marker in place", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-update-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/101", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Findings summary:** no issues found"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict updates the current same-head marker even when another head has a newer marker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-current-head-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `def5678`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** later head marker",
            "",
            "**Next action:** rerun gate",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/101", "-f"],
        assertArgContains: ["**Reviewed head SHA:** `abc1234`", "**Findings summary:** fixed the marker for the current head"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "ABC1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "fixed the marker for the current head",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      warning: "A gate comment for \`draft_gate\` already exists on a different head SHA \`def5678\` (comment 202). The old comment is stale for the current head.",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict prefers the latest same-head marker when it differs from the older strict summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-latest-marker-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abc1234","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abc1234"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** already complete",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T17:00:00Z",
          },
          {
            id: 202,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-202",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "-X", "PATCH", "repos/owner/repo/issues/comments/202", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Reviewed head SHA:** `abc1234`", "**Findings summary:** corrected the newer malformed marker"],
        stdout: '{"id":202,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-202"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "corrected the newer malformed marker",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "updated",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abc1234",
      currentHeadSha: "abc1234",
      commentId: 202,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-202",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict expands an abbreviated current-head SHA before matching same-head markers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-short-head-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"abcdef1234567890abcdef1234567890abcdef12","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"abcdef1234567890abcdef1234567890abcdef12"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 101,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abcdef1234567890abcdef1234567890abcdef12`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-101",
            updated_at: "2026-05-30T18:00:00Z",
          },
        ])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "ABCDEF1",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: "noop",
      repo: "owner/repo",
      pr: 17,
      gate: "draft_gate",
      headSha: "abcdef1234567890abcdef1234567890abcdef12",
      currentHeadSha: "abcdef1234567890abcdef1234567890abcdef12",
      commentId: 101,
      commentUrl: "https://github.com/owner/repo/pull/17#issuecomment-101",
      blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"],
    });
    assert.equal(Number((await readFile(env.GH_COUNTER_PATH, "utf8")).trim()), 5);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict fails closed when the requested head SHA is stale", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-stale-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"def5678","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def5678"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: '[]\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match the current PR head SHA/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict warns when a gate comment exists on a different head SHA", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-warn-stale-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":17,"state":"OPEN","isDraft":true,"headRefOid":"def5678","reviews":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"ci"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/17/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=17"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "17", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def5678"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/17/comments?per_page=100"],
        stdout: `${JSON.stringify([
          {
            id: 99,
            body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `abc1234`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** previous review",
            "",
            "**Next action:** mark ready for review",
            ].join("\n"),
            html_url: "https://github.com/owner/repo/pull/17#issuecomment-99",
            updated_at: "2026-05-30T17:00:00Z",
          },
        ])}\n`,
      },
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        stdout: '{"id":102,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-102"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "def5678",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.gate, "draft_gate");
    assert.equal(parsed.headSha, "def5678");
    assert.match(parsed.warning, /different head SHA/i);
    assert.match(parsed.warning, /abc1234/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict fails closed when draft_gate is forbidden on a non-draft PR", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-draft-forbidden-"));

  try {
    const env = await writeGhStub(tempDir, [
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "number,state,isDraft,headRefOid,mergeStateStatus,reviews,statusCheckRollup"],
        stdout: '{"number":266,"state":"OPEN","isDraft":false,"headRefOid":"def56789abcdef","reviews":[],"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]}\n',
      },
      {
        assertArgs: ["api", "repos/owner/repo/pulls/266/requested_reviewers"],
        stdout: '{"users":[],"teams":[]}\n',
      },
      {
        assertArgs: ["api", "graphql", "pr=266"],
        stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}\n',
      },
      {
        assertArgs: ["pr", "view", "266", "--repo", "owner/repo", "--json", "headRefOid"],
        stdout: '{"headRefOid":"def56789abcdef"}\n',
      },
      {
        assertArgs: ["api", "--paginate", "--slurp", "repos/owner/repo/issues/266/comments?per_page=100"],
        stdout: `${JSON.stringify([[{
          id: 11,
          body: [
            "### Gate review: `draft_gate`",
            "",
            "**Reviewed head SHA:** `c94679e`",
            "**Verdict:** clean",
            "",
            "**Findings summary:** no issues found",
            "",
            "**Next action:** mark ready for review",
          ].join("\n"),
          html_url: "https://github.com/owner/repo/pull/266#issuecomment-11",
          updated_at: "2026-05-31T20:00:00Z",
        }]])}\n`,
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "266",
      "--gate", "draft_gate",
      "--head-sha", "def56789",
      "--verdict", "clean",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":0}',
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot enter draft_gate/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict rejects clean verdict when unresolved blocking-severity findings remain", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-blocking-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: true,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "reviewed: 2 must-fix, 1 worth-fixing-now",
      "--next-action", "mark ready for review",
      "--findings-severity-counts", '{"must-fix":2,"worth-fixing-now":1,"defer":0}',
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot set verdict "clean"/);
    assert.match(payload.error, /must-fix/);
    assert.match(payload.error, /worth-fixing-now/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict allows clean verdict when no blocking-severity findings remain", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-clean-ok-"));

  try {
    const env = await writeGhStub(tempDir, [
      ...buildGateCoordinationEntries({
        isDraft: true,
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
      }),
      {
        assertArgs: ["api", "repos/owner/repo/issues/17/comments", "-f"],
        assertArgContains: ["body=### Gate review: `draft_gate`", "**Verdict:** clean"],
        stdout: '{"id":101,"html_url":"https://github.com/owner/repo/pull/17#issuecomment-101"}\n',
      },
    ]);

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "no issues found",
      "--next-action", "mark ready for review",
      "--findings-severity-counts", '{"must-fix":0,"worth-fixing-now":0,"defer":1}',
    ], { env });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "created");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});



test("upsert-checkpoint-verdict rejects clean verdict when --findings-severity-counts is missing and blocking severities are configured", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-missing-counts-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: true,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "reviewed",
      "--next-action", "mark ready for review",
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Cannot set verdict "clean"/);
    assert.match(payload.error, /--findings-severity-counts is required/);
    assert.match(payload.error, /must-fix/);
    assert.match(payload.error, /worth-fixing-now/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsert-checkpoint-verdict rejects clean verdict when --findings-severity-counts omits a blocking severity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-dev-loops-upsert-gate-review-missing-key-"));

  try {
    const env = await writeGhStub(tempDir, buildGateCoordinationEntries({
      isDraft: true,
      statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
    }));

    const result = await runNode([
      "--repo", "owner/repo",
      "--pr", "17",
      "--gate", "draft_gate",
      "--head-sha", "abc1234",
      "--verdict", "clean",
      "--findings-summary", "all clear",
      "--next-action", "mark ready",
      "--findings-severity-counts", '{"must-fix":0,"defer":0}',
    ], { env });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /must include explicit counts for all configured blocking severities/);
    assert.match(payload.error, /worth-fixing-now/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

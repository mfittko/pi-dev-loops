import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  parseReconcileDraftGateCliArgs,
} from "../../scripts/github/reconcile-draft-gate.mjs";

// ─── CLI argument parsing ────────────────────────────────────────────

test("parseReconcileDraftGateCliArgs accepts --repo, --pr, and --skip-checks", () => {
  const r = parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17"]);
  assert.equal(r.repo, "owner/repo");
  assert.equal(r.pr, 17);
  assert.equal(r.skipChecks, false);
});

test("parseReconcileDraftGateCliArgs accepts --skip-checks flag", () => {
  const r = parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17", "--skip-checks"]);
  assert.equal(r.skipChecks, true);
});

test("parseReconcileDraftGateCliArgs rejects missing --repo", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--pr", "17"]), /requires --repo and --pr/);
});

test("parseReconcileDraftGateCliArgs rejects missing --pr", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "owner/repo"]), /requires --repo and --pr/);
});

test("parseReconcileDraftGateCliArgs rejects invalid repo slug", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "bad", "--pr", "17"]));
});

test("parseReconcileDraftGateCliArgs rejects unknown arguments", () => {
  assert.throws(() => parseReconcileDraftGateCliArgs(["--repo", "owner/repo", "--pr", "17", "--bogus"]), /Unknown argument/);
});

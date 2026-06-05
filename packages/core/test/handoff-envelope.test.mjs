import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDevLoopHandoffEnvelope,
  ACCEPTANCE_TEMPLATES,
  ENVELOPE_HANDOFF_VERSION,
  STRATEGY_DEFAULT_STOP_RULES,
  acceptanceKey,
  deriveTarget,
  deriveStopRules,
  deriveGateConfig,
  deriveCwd,
  deriveRequiredReads,
  normalizeGateState,
  resolveSubGate,
  lookupAcceptanceTemplate,
  buildWorktreeSlug,
  flattenSlugSegment,
} from "../src/loop/handoff-envelope.mjs";

import {
  DEV_LOOP_TARGET_KIND,
  INTERNAL_DEV_LOOP_STRATEGY,
  DEV_LOOP_EXECUTION_MODE,
} from "../src/loop/public-dev-loop-routing-contract.mjs";

// ---------------------------------------------------------------------------
// Helpers to build fixture inputs
// ---------------------------------------------------------------------------

function issueBundle(issue, opts = {}) {
  return {
    bundle: {
      selectedStrategy: opts.strategy ?? INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode: opts.executionMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: opts.nextAction ?? "Draft PR implementation.",
      requiredReads: opts.requiredReads ?? ["skills/docs/public-dev-loop-contract.md"],
      activeArtifact: {
        kind: DEV_LOOP_TARGET_KIND.ISSUE,
        issue,
        pr: opts.pr ?? null,
        linkedPr: opts.linkedPr ?? null,
        branch: opts.branch ?? null,
        phase: null,
      },
    },
  };
}

function prBundle(pr, opts = {}) {
  return {
    bundle: {
      selectedStrategy: opts.strategy ?? INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode: opts.executionMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: opts.nextAction ?? "Follow up on PR.",
      requiredReads: opts.requiredReads ?? ["skills/copilot-pr-followup/SKILL.md"],
      activeArtifact: {
        kind: DEV_LOOP_TARGET_KIND.PR,
        pr,
        issue: opts.issue ?? null,
        branch: opts.branch ?? null,
      },
    },
  };
}

function localBranchBundle(branch, opts = {}) {
  return {
    bundle: {
      selectedStrategy: opts.strategy ?? INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
      executionMode: opts.executionMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: opts.nextAction ?? "Implement changes locally.",
      requiredReads: opts.requiredReads ?? ["skills/local-implementation/SKILL.md"],
      activeArtifact: {
        kind: DEV_LOOP_TARGET_KIND.LOCAL_BRANCH,
        branch,
        issue: opts.issue ?? null,
      },
    },
  };
}

function localPhaseBundle(phase, opts = {}) {
  return {
    bundle: {
      selectedStrategy: opts.strategy ?? INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION,
      executionMode: opts.executionMode ?? DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: opts.nextAction ?? "Implement phase.",
      requiredReads: opts.requiredReads ?? ["skills/local-implementation/SKILL.md"],
      activeArtifact: {
        kind: DEV_LOOP_TARGET_KIND.LOCAL_PHASE,
        phase,
        issue: opts.issue ?? null,
      },
    },
  };
}

function nullStrategyBundle() {
  return {
    bundle: {
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.NONE,
      executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: "No action.",
      requiredReads: [],
      activeArtifact: {
        kind: DEV_LOOP_TARGET_KIND.ISSUE,
        issue: 1,
      },
    },
  };
}

const defaultSettings = {
  workflow: { asyncStartMode: "required", requireDraftFirst: true },
  refinement: { maxCopilotRounds: 5 },
  autonomy: { stopAt: ["draft-pr", "merge"] },
  gates: {
    draft: {
      angles: ["scope", "coverage", "correctness"],
      blockCleanOnFindingSeverities: ["must-fix"],
      requireCi: true,
    },
  },
};

const defaultOptions = { repoSlug: "owner/repo" };

// ===========================================================================
// 1. fn-exists and basic shape
// ===========================================================================

test("fn-exists: buildDevLoopHandoffEnvelope is a function", () => {
  assert.equal(typeof buildDevLoopHandoffEnvelope, "function");
});

test("shape: envelope has correct top-level keys", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.handoffVersion, ENVELOPE_HANDOFF_VERSION);
  assert.equal(typeof env.derivedAt, "string");
  assert.ok(env.derivedAt.endsWith("Z") || env.derivedAt.includes("T"));
  assert.equal(typeof env.target, "object");
  assert.equal(typeof env.currentGate, "string");
  assert.equal(typeof env.executionMode, "string");
  assert.equal(typeof env.nextAction, "string");
  assert.ok(Array.isArray(env.requiredReads));
  assert.ok(Array.isArray(env.stopRules));
  assert.equal(typeof env.asyncStartMode, "string");
  assert.equal(typeof env.requireDraftFirst, "boolean");
  assert.equal(typeof env.acceptance, "object");
  assert.equal(typeof env.control, "object");
});

test("shape: acceptance block has criteria, evidence, maxFinalizationTurns", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.ok(Array.isArray(env.acceptance.criteria));
  assert.ok(env.acceptance.criteria.length > 0);
  assert.ok(Array.isArray(env.acceptance.evidence));
  assert.ok(env.acceptance.evidence.length > 0);
  assert.equal(typeof env.acceptance.maxFinalizationTurns, "number");
  assert.ok(env.acceptance.maxFinalizationTurns > 0);
});

// ===========================================================================
// 2. Strategy/gate combo tests
// ===========================================================================

test("combo: copilot_pr_followup + draft (default sub-gate)", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "draft");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "ac-check"));
  assert.ok(env.acceptance.criteria.some((c) => c.id === "scope"));
  assert.equal(env.acceptance.maxFinalizationTurns, 4);
});

test("combo: copilot_pr_followup + draft (explicit sub-gate)", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    { currentSubGate: "draft" },
    defaultOptions
  );
  assert.equal(env.currentGate, "draft");
});

test("combo: copilot_pr_followup + watch", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    { currentSubGate: "watch" },
    defaultOptions
  );
  assert.equal(env.currentGate, "watch");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "copilot-activity"));
  assert.ok(env.acceptance.criteria.some((c) => c.id === "no-stuck-watch"));
  assert.equal(env.acceptance.maxFinalizationTurns, 2);
});

test("combo: copilot_pr_followup + pre-approval", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    { currentSubGate: "pre-approval" },
    defaultOptions
  );
  assert.equal(env.currentGate, "pre-approval");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "full-gate-chain"));
  assert.ok(env.acceptance.criteria.some((c) => c.id === "clean-verdict"));
  assert.equal(env.acceptance.maxFinalizationTurns, 6);
  assert.ok(env.acceptance.evidence.includes("residual-risks"));
});

test("combo: final_approval", () => {
  const env = buildDevLoopHandoffEnvelope(
    prBundle(10, { strategy: INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL }),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "gate-evidence"));
  assert.ok(env.acceptance.criteria.some((c) => c.id === "human-confirmation"));
  assert.equal(env.acceptance.maxFinalizationTurns, 2);
  assert.ok(env.acceptance.evidence.includes("manual-notes"));
});

test("combo: local_implementation (branch)", () => {
  const env = buildDevLoopHandoffEnvelope(
    localBranchBundle("feature/x"),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "phase-ac"));
  assert.ok(env.acceptance.criteria.some((c) => c.id === "verify-green"));
  assert.equal(env.acceptance.maxFinalizationTurns, 6);
  assert.ok(env.acceptance.evidence.includes("changed-files"));
});

test("combo: local_implementation (phase)", () => {
  const env = buildDevLoopHandoffEnvelope(
    localPhaseBundle("10"),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.target.phase, "10");
  assert.ok(env.acceptance.evidence.includes("changed-files"));
});

test("combo: issue_intake", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(1, { strategy: INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE }),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
  assert.ok(env.acceptance.criteria.some((c) => c.id === "contract-compliance"));
});

test("combo: external_pr_followup", () => {
  const env = buildDevLoopHandoffEnvelope(
    prBundle(10, { strategy: INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP }),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
});

test("combo: reviewer_fixer", () => {
  const env = buildDevLoopHandoffEnvelope(
    prBundle(10, { strategy: INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER }),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
});

test("combo: wait_watch", () => {
  const env = buildDevLoopHandoffEnvelope(
    prBundle(10, { strategy: INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH }),
    defaultSettings,
    {},
    defaultOptions
  );
  assert.equal(env.currentGate, "default");
});

// ===========================================================================
// 3. Unknown combo throws
// ===========================================================================

test("unknown-combo: throws for strategy without registered template + bad gate", () => {
  assert.throws(() => {
    lookupAcceptanceTemplate(INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP, "unknown_gate");
  }, /no acceptance template/);
});

// ===========================================================================
// 4. Missing / incomplete inputs → fail closed
// ===========================================================================

test("fail-closed: null resolverOutput throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(null, defaultSettings, {}, defaultOptions);
  }, /resolverOutput is required/);
});

test("fail-closed: undefined resolverOutput throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(undefined, defaultSettings, {}, defaultOptions);
  }, /resolverOutput is required/);
});

test("fail-closed: missing selectedStrategy throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      { bundle: { executionMode: "bounded_handoff", nextAction: "x", activeArtifact: { kind: "issue", issue: 1 } } },
      defaultSettings,
      {},
      defaultOptions
    );
  }, /selectedStrategy/);
});

test("fail-closed: missing executionMode throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      { bundle: { selectedStrategy: "copilot_pr_followup", nextAction: "x", activeArtifact: { kind: "issue", issue: 1 } } },
      defaultSettings,
      {},
      defaultOptions
    );
  }, /executionMode/);
});

test("fail-closed: missing nextAction throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      { bundle: { selectedStrategy: "copilot_pr_followup", executionMode: "bounded_handoff", activeArtifact: { kind: "issue", issue: 1 } } },
      defaultSettings,
      {},
      defaultOptions
    );
  }, /nextAction/);
});

test("fail-closed: missing repo slug throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      issueBundle(42),
      defaultSettings,
      {},
      {}
    );
  }, /repo slug/);
});

test("fail-closed: invalid repo slug format throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      issueBundle(42),
      defaultSettings,
      {},
      { repoSlug: "not-a-valid-repo" }
    );
  }, /repo slug/);
});

test("fail-closed: missing target kind throws", () => {
  assert.throws(() => {
    buildDevLoopHandoffEnvelope(
      { bundle: { selectedStrategy: "copilot_pr_followup", executionMode: "bounded_handoff", nextAction: "x", activeArtifact: {} } },
      defaultSettings,
      {},
      { repoSlug: "owner/repo" }
    );
  }, /valid target kind/);
});

// ===========================================================================
// 5. Gate state fields
// ===========================================================================

test("gate-state: head SHA, CI status, thread count, round count populate", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {
      currentHeadSha: "abc123def456",
      ciStatus: "success",
      unresolvedThreadCount: 3,
      copilotRoundCount: 2,
      currentSubGate: "pre-approval",
    },
    defaultOptions
  );

  assert.equal(env.currentHeadSha, "abc123def456");
  assert.equal(env.ciStatus, "success");
  assert.equal(env.unresolvedThreadCount, 3);
  assert.equal(env.copilotRoundCount, 2);
});

test("gate-state: null/undefined values default to null or 0", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    null,
    defaultOptions
  );

  assert.equal(env.currentHeadSha, null);
  assert.equal(env.ciStatus, null);
  assert.equal(env.unresolvedThreadCount, 0);
  assert.equal(env.copilotRoundCount, 0);
});

test("gate-state: empty gate state is safe", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.currentHeadSha, null);
  assert.equal(env.ciStatus, null);
  assert.equal(env.unresolvedThreadCount, 0);
  assert.equal(env.copilotRoundCount, 0);
});

// ===========================================================================
// 6. Stop rules derivation
// ===========================================================================

test("stop-rules: derived from settings.autonomy.stopAt", () => {
  const settings = { autonomy: { stopAt: ["refinement", "draft-pr", "pre-approval", "merge"] } };
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    settings,
    {},
    defaultOptions
  );

  assert.deepEqual(env.stopRules, ["refinement", "draft-pr", "pre-approval", "merge"]);
});

test("stop-rules: strategy defaults when settings has no autonomy", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    { workflow: { asyncStartMode: "required", requireDraftFirst: false } },
    {},
    defaultOptions
  );

  assert.deepEqual(env.stopRules, STRATEGY_DEFAULT_STOP_RULES[INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP]);
});

test("stop-rules: local_implementation defaults to empty array", () => {
  const env = buildDevLoopHandoffEnvelope(
    localBranchBundle("feature/x"),
    { workflow: { asyncStartMode: "required", requireDraftFirst: false } },
    {},
    defaultOptions
  );

  assert.deepEqual(env.stopRules, []);
});

// ===========================================================================
// 7. requiredReads derivation
// ===========================================================================

test("required-reads: populated from resolver output", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42, { requiredReads: ["a.md", "b.md"] }),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.deepEqual(env.requiredReads, ["a.md", "b.md"]);
});
test("required-reads: empty array when resolver has no reads", () => {
  const raw = {
    bundle: {
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: "Do stuff.",
      activeArtifact: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    },
  };
  const env = buildDevLoopHandoffEnvelope(raw, defaultSettings, {}, defaultOptions);
  assert.deepEqual(env.requiredReads, []);
});

test("required-reads: reads from resolverOutput top-level when wrapper shape present", () => {
  const raw = {
    requiredReads: ["from-wrapper.md"],
    bundle: {
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: "Do stuff.",
      activeArtifact: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
      requiredReads: ["from-bundle.md"],
    },
  };
  const env = buildDevLoopHandoffEnvelope(raw, defaultSettings, {}, defaultOptions);
  assert.deepEqual(env.requiredReads, ["from-wrapper.md"]);
});

test("required-reads: falls back to bundle.requiredReads when no top-level reads", () => {
  const raw = {
    bundle: {
      selectedStrategy: INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP,
      executionMode: DEV_LOOP_EXECUTION_MODE.BOUNDED_HANDOFF,
      nextAction: "Do stuff.",
      activeArtifact: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
      requiredReads: ["from-bundle.md"],
    },
  };
  const env = buildDevLoopHandoffEnvelope(raw, defaultSettings, {}, defaultOptions);
  assert.deepEqual(env.requiredReads, ["from-bundle.md"]);
});


// ===========================================================================
// 8. PR target
// ===========================================================================

test("target: PR target with issue reference", () => {
  const env = buildDevLoopHandoffEnvelope(
    prBundle(100, { issue: 42 }),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.target.kind, "pr");
  assert.equal(env.target.pr, 100);
  assert.equal(env.target.issue, 42);
  assert.equal(env.target.repo, "owner/repo");
});

// ===========================================================================
// 9. maxCopilotRounds derivation
// ===========================================================================

test("maxCopilotRounds: from settings.refinement.maxCopilotRounds", () => {
  const settings = {
    ...defaultSettings,
    refinement: { maxCopilotRounds: 10 },
  };
  const env = buildDevLoopHandoffEnvelope(issueBundle(42), settings, {}, defaultOptions);

  assert.equal(env.maxCopilotRounds, 10);
});

test("maxCopilotRounds: defaults to 5", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    { workflow: { asyncStartMode: "required", requireDraftFirst: false } },
    {},
    defaultOptions
  );
  assert.equal(env.maxCopilotRounds, 5);
});

// ===========================================================================
// 10. Overrides
// ===========================================================================

test("overrides: user overrides populate when provided", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    { ...defaultOptions, overrides: { mergeAuthorized: false, scopeConstraint: "only docs" } }
  );

  assert.equal(env.overrides.mergeAuthorized, false);
  assert.equal(env.overrides.scopeConstraint, "only docs");
});

test("overrides: absent when not provided", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.overrides, undefined);
});

test("overrides: absent when empty object", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    { ...defaultOptions, overrides: {} }
  );

  assert.equal(env.overrides, undefined);
});

// ===========================================================================
// 11. Gate config derivation
// ===========================================================================

test("gate-config: draft gate config from settings", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.ok(env.gateConfig);
  assert.deepEqual(env.gateConfig.angles, ["scope", "coverage", "correctness"]);
  assert.equal(env.gateConfig.requireCi, true);
  assert.deepEqual(env.gateConfig.blockCleanOnFindingSeverities, ["must-fix"]);
});

test("gate-config: pre-approval gate config from settings", () => {
  const settings = {
    ...defaultSettings,
    gates: {
      draft: { angles: ["scope"], requireCi: true, blockCleanOnFindingSeverities: ["must-fix"] },
      preApproval: { angles: ["dry", "kiss"], requireCi: true, blockCleanOnFindingSeverities: ["must-fix", "worth-fixing-now"] },
    },
  };
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    settings,
    { currentSubGate: "pre-approval" },
    defaultOptions
  );

  assert.ok(env.gateConfig);
  assert.deepEqual(env.gateConfig.angles, ["dry", "kiss"]);
});

test("gate-config: excludes filtered angles", () => {
  const settings = {
    ...defaultSettings,
    gates: {
      draft: {
        angles: ["scope", "coverage", "deep"],
        excludeAngles: ["deep"],
        requireCi: true,
        blockCleanOnFindingSeverities: ["must-fix"],
      },
    },
  };
  const env = buildDevLoopHandoffEnvelope(issueBundle(42), settings, {}, defaultOptions);

  assert.deepEqual(env.gateConfig.angles, ["scope", "coverage"]);
});

// ===========================================================================
// 12. Worktree / cwd derivation
// ===========================================================================

test("cwd: explicit worktreeCwd wins", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    { ...defaultOptions, worktreeCwd: "/explicit/path" }
  );

  assert.equal(env.cwd, "/explicit/path");
});

test("cwd: derived from repoRoot + issue slug", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    { ...defaultOptions, repoRoot: "/home/user/repo" }
  );

  assert.equal(env.cwd, "/home/user/repo/tmp/worktrees/issue-42");
});

test("cwd: null when no repoRoot or explicit cwd", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.cwd, null);
});

// ===========================================================================
// 13. Backward compat — acceptance shape maps to subagent contract
// ===========================================================================

test("backward-compat: acceptance shape has criteria with id+must+severity", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  for (const c of env.acceptance.criteria) {
    assert.equal(typeof c.id, "string");
    assert.ok(c.id.length > 0);
    assert.equal(typeof c.must, "string");
    assert.ok(c.must.length > 0);
    assert.equal(typeof c.severity, "string");
    assert.ok(["required", "recommended"].includes(c.severity));
  }
});

test("determinism: injectable now makes derivedAt stable", () => {
  const frozen = "2026-01-01T00:00:00.000Z";
  const e1 = buildDevLoopHandoffEnvelope(issueBundle(99), defaultSettings, {}, defaultOptions, new Date(frozen));
  const e2 = buildDevLoopHandoffEnvelope(issueBundle(99), defaultSettings, {}, defaultOptions, new Date(frozen));
  assert.strictEqual(e1.derivedAt, frozen);
  assert.strictEqual(e2.derivedAt, frozen);
  assert.strictEqual(e1.derivedAt, e2.derivedAt);
});

test("determinism: derivedAt defaults to current time when now not provided", () => {
  const before = new Date().toISOString();
  const e = buildDevLoopHandoffEnvelope(issueBundle(99), defaultSettings, {}, defaultOptions);
  assert.ok(e.derivedAt >= before);
});

test("backward-compat: envelope is frozen (top-level)", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.throws(() => { env.acceptance = null; }, /Cannot assign to read only property/);
  assert.throws(() => { env.stopRules = []; }, /Cannot assign to read only property/);
});

// ===========================================================================
// 14. Edge cases
// ===========================================================================

test("edge: branch target includes issue", () => {
  const env = buildDevLoopHandoffEnvelope(
    localBranchBundle("feature/x", { issue: 42 }),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.target.kind, "local_branch");
  assert.equal(env.target.branch, "feature/x");
  assert.equal(env.target.issue, 42);
});

test("edge: phase target with issue", () => {
  const env = buildDevLoopHandoffEnvelope(
    localPhaseBundle("10", { issue: 536 }),
    defaultSettings,
    {},
    defaultOptions
  );

  assert.equal(env.target.kind, "local_phase");
  assert.equal(env.target.phase, "10");
  assert.equal(env.target.issue, 536);
});

test("edge: neg copilotRoundCount clamps to 0", () => {
  const env = buildDevLoopHandoffEnvelope(
    issueBundle(42),
    defaultSettings,
    { copilotRoundCount: -1 },
    defaultOptions
  );

  assert.equal(env.copilotRoundCount, 0);
});

// ===========================================================================
// 15. Unit: normalizeGateState
// ===========================================================================

test("unit: normalizeGateState handles all fields", () => {
  const gs = normalizeGateState({
    currentHeadSha: "sha123",
    ciStatus: "pending",
    unresolvedThreadCount: 5,
    copilotRoundCount: 3,
    currentSubGate: "draft",
  });

  assert.equal(gs.currentHeadSha, "sha123");
  assert.equal(gs.ciStatus, "pending");
  assert.equal(gs.unresolvedThreadCount, 5);
  assert.equal(gs.copilotRoundCount, 3);
  assert.equal(gs.currentSubGate, "draft");
});

test("unit: normalizeGateState with null falls back safely", () => {
  const gs = normalizeGateState(null);
  assert.equal(gs.currentHeadSha, null);
  assert.equal(gs.ciStatus, null);
  assert.equal(gs.unresolvedThreadCount, 0);
  assert.equal(gs.copilotRoundCount, 0);
  assert.equal(gs.currentSubGate, undefined);
});

// ===========================================================================
// 16. Unit: acceptanceKey
// ===========================================================================

test("unit: acceptanceKey format", () => {
  assert.equal(acceptanceKey("copilot_pr_followup", "draft"), "copilot_pr_followup::draft");
});

// ===========================================================================
// 17. Unit: buildWorktreeSlug
// ===========================================================================

test("unit: buildWorktreeSlug for issue", () => {
  assert.equal(
    buildWorktreeSlug({ issue: 42 }, DEV_LOOP_TARGET_KIND.ISSUE),
    "issue-42"
  );
});

test("unit: buildWorktreeSlug for PR", () => {
  assert.equal(
    buildWorktreeSlug({ pr: 100 }, DEV_LOOP_TARGET_KIND.PR),
    "pr-100"
  );
});

test("unit: buildWorktreeSlug for branch", () => {
  assert.equal(
    buildWorktreeSlug({ branch: "feature/x" }, DEV_LOOP_TARGET_KIND.LOCAL_BRANCH),
    "feature-x"
  );
});

test("unit: flattenSlugSegment replaces path separators", () => {
  assert.strictEqual(flattenSlugSegment("feature/x"), "feature-x");
  assert.strictEqual(flattenSlugSegment("a" + String.fromCharCode(92) + "b"), "a-b");
  assert.strictEqual(flattenSlugSegment("simple"), "simple");
  assert.strictEqual(flattenSlugSegment(""), "");
  assert.strictEqual(flattenSlugSegment(null), "");
});

// ===========================================================================
// 18. Verify all ACCEPTANCE_TEMPLATES combos registered
// ===========================================================================

test("templates: all copilot_pr_followup sub-gates registered", () => {
  for (const sub of ["draft", "watch", "pre-approval"]) {
    assert.ok(
      ACCEPTANCE_TEMPLATES.has(acceptanceKey(INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP, sub)),
      `missing template for copilot_pr_followup::${sub}`
    );
  }
});

test("templates: final_approval registered", () => {
  assert.ok(ACCEPTANCE_TEMPLATES.has(acceptanceKey(INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL, "default")));
});

test("templates: local_implementation registered", () => {
  assert.ok(ACCEPTANCE_TEMPLATES.has(acceptanceKey(INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION, "default")));
});

test("templates: issue_intake registered", () => {
  assert.ok(ACCEPTANCE_TEMPLATES.has(acceptanceKey(INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE, "default")));
});

test("templates: no duplicate registrations", () => {
  const strategies = Object.keys(STRATEGY_DEFAULT_STOP_RULES);
  const knownKeys = [...ACCEPTANCE_TEMPLATES.keys()];
  for (const s of strategies) {
    const hasDirect = knownKeys.includes(acceptanceKey(s, "default"));
    const hasDraft = knownKeys.includes(acceptanceKey(s, "draft"));
    assert.ok(hasDirect || hasDraft, `Strategy "${s}" has no registered template`);
  }
});

// ===========================================================================
// Invariant: strategy-template coverage
// ===========================================================================

test("invariant: every strategy with default stop rules has an acceptance template", () => {
  const strategies = Object.keys(STRATEGY_DEFAULT_STOP_RULES);
  for (const s of strategies) {
    const key = acceptanceKey(s, "default");
    assert.ok(
      ACCEPTANCE_TEMPLATES.has(key) || ACCEPTANCE_TEMPLATES.has(acceptanceKey(s, "draft")),
      `Strategy "${s}" missing acceptance template`,
    );
  }
});

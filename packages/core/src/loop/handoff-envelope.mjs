/**
 * Deterministic handoff envelope — machine-generated JSON contract for
 * `dev-loop` subagent dispatch.
 *
 * Replaces dispatch prose with a purely derived envelope from three
 * authoritative sources:
 *   1. Resolver output (bundle)  → target, gate, nextAction, requiredReads, executionMode
 *   2. Settings (DevLoopConfig)  → gateConfig, stopRules, asyncStartMode, requireDraftFirst, maxCopilotRounds
 *   3. Gate state (detectors)    → head SHA, CI status, thread count, round count
 *
 * Acceptance criteria, evidence lists, maxFinalizationTurns, and control
 * params are derived from a static strategy+gate mapping table.
 *
 * Unknown strategy/gate combos throw explicit errors.
 */

import {
  DEV_LOOP_TARGET_KIND,
  INTERNAL_DEV_LOOP_STRATEGY,
} from "./public-dev-loop-routing-contract.mjs";
import { normalizeRepoSlug } from "../github/repo-slug.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const H_VER = 1;
const ENVELOPE_HANDOFF_VERSION = H_VER;

const DEFAULT_NEEDS_ATTENTION_MS = 300_000; // 5 minutes
const DEFAULT_ACTIVE_NOTICE_MS = 300_000;

/** Maps normalized strategy name to its default stop rules */
const STRATEGY_DEFAULT_STOP_RULES = Object.freeze({
  [INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP]: ["draft-pr", "merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE]: ["merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP]: ["merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER]: ["merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH]: ["merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL]: ["merge"],
  [INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION]: [],
});

// ---------------------------------------------------------------------------
// Acceptance template table
// ---------------------------------------------------------------------------

const ACCEPTANCE_TEMPLATES = new Map();

function acceptanceKey(strategy, gate) {
  return `${strategy}::${gate}`;
}

function register(strategy, gate, template) {
  ACCEPTANCE_TEMPLATES.set(acceptanceKey(strategy, gate), deepFreeze({ ...template }));
}

// copilot_pr_followup sub-gates
register(INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP, "draft", {
  criteria: [
    { id: "ac-check", must: "Verify all acceptance criteria from linked issue are met or tracked.", severity: "required" },
    { id: "scope", must: "Every changed file belongs in this PR; no unrelated or out-of-scope changes.", severity: "required" },
    { id: "coverage", must: "Tests cover changed behavior including edge cases and error paths.", severity: "required" },
    { id: "dod-alignment", must: "Implementation aligns with the issue's definition of done.", severity: "required" },
  ],
  evidence: ["commands-run", "validation-output", "review-findings"],
  maxFinalizationTurns: 4,
  needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
  activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
});

register(INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP, "watch", {
  criteria: [
    { id: "copilot-activity", must: "Detect new Copilot review activity (comments, threads, review submissions).", severity: "required" },
    { id: "no-stuck-watch", must: "Watch cycle must not stall; timeout or activity triggers follow-up.", severity: "required" },
  ],
  evidence: ["commands-run"],
  maxFinalizationTurns: 2,
  needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
  activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
});

register(INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP, "pre-approval", {
  criteria: [
    { id: "full-gate-chain", must: "Complete pre-approval gate chain with all configured review angles.", severity: "required" },
    { id: "clean-verdict", must: "Pre-approval gate must return clean verdict (no must-fix or worth-fixing-now findings).", severity: "required" },
    { id: "unresolved-threads", must: "All review threads must be resolved before pre-approval gate runs.", severity: "required" },
    { id: "ci-green", must: "CI must be green on the current head SHA.", severity: "required" },
  ],
  evidence: ["commands-run", "validation-output", "review-findings", "residual-risks"],
  maxFinalizationTurns: 6,
  needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
  activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
});

// final_approval
register(INTERNAL_DEV_LOOP_STRATEGY.FINAL_APPROVAL, "default", {
  criteria: [
    { id: "gate-evidence", must: "All required gate evidence (draft_gate, pre_approval_gate) is present and visible.", severity: "required" },
    { id: "human-confirmation", must: "Human operator must explicitly confirm merge readiness.", severity: "required" },
    { id: "ci-green", must: "CI must be green on the current head SHA.", severity: "required" },
  ],
  evidence: ["validation-output", "manual-notes"],
  maxFinalizationTurns: 2,
  needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
  activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
});

// local_implementation
register(INTERNAL_DEV_LOOP_STRATEGY.LOCAL_IMPLEMENTATION, "default", {
  criteria: [
    { id: "phase-ac", must: "All phase acceptance criteria from the active phase doc are satisfied.", severity: "required" },
    { id: "verify-green", must: "`npm run verify` passes with no failures.", severity: "required" },
  ],
  evidence: ["commands-run", "validation-output", "changed-files"],
  maxFinalizationTurns: 6,
  needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
  activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
});

// Remaining strategies get a generic acceptance template
function registerGeneric(strategy) {
  register(strategy, "default", {
    criteria: [
      { id: "contract-compliance", must: "Implementation complies with the governing contract and acceptance criteria.", severity: "required" },
    ],
    evidence: ["commands-run", "validation-output"],
    maxFinalizationTurns: 4,
    needsAttentionAfterMs: DEFAULT_NEEDS_ATTENTION_MS,
    activeNoticeAfterMs: DEFAULT_ACTIVE_NOTICE_MS,
  });
}

for (const s of [
  INTERNAL_DEV_LOOP_STRATEGY.ISSUE_INTAKE,
  INTERNAL_DEV_LOOP_STRATEGY.EXTERNAL_PR_FOLLOWUP,
  INTERNAL_DEV_LOOP_STRATEGY.REVIEWER_FIXER,
  INTERNAL_DEV_LOOP_STRATEGY.WAIT_WATCH,
]) {
  if (![...ACCEPTANCE_TEMPLATES.keys()].some((k) => k.startsWith(`${s}::`))) {
    registerGeneric(s);
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeRepo(repo) {
  try {
    return normalizeRepoSlug(repo);
  } catch {
    return null;
  }
}

function normalizeTargetKind(kind) {
  if (typeof kind !== "string") return null;
  const normalized = kind.trim().toLowerCase();
  return Object.values(DEV_LOOP_TARGET_KIND).includes(normalized) ? normalized : null;
}

function normalizePositiveInt(v) {
  if (!Number.isInteger(v) || v < 0) return null;
  return v;
}

function normalizeString(v) {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function normalizeStringOrNull(v) {
  return v === null || v === undefined ? null : normalizeString(v);
}

function requireString(v, label) {
  const s = normalizeString(v);
  if (s === null) throw new Error(`handoff-envelope: ${label} is required and must be a non-empty string`);
  return s;
}

// ---------------------------------------------------------------------------
// Target derivation
// ---------------------------------------------------------------------------

function deriveTarget(bundle, repo) {
  const artifact = bundle?.activeArtifact ?? bundle?.canonicalState?.target ?? {};

  const kind = normalizeTargetKind(artifact.kind);
  if (!kind) throw new Error("handoff-envelope: resolver output must include a valid target kind");

  const target = { kind, repo };

  if (kind === DEV_LOOP_TARGET_KIND.ISSUE) {
    const issue = artifact.issue;
    if (!Number.isInteger(issue) || issue < 1) {
      throw new Error("handoff-envelope: issue target must include a valid positive issue number");
    }
    target.issue = issue;
    if (Number.isInteger(artifact.pr) && artifact.pr > 0) target.pr = artifact.pr;
    if (Number.isInteger(artifact.linkedPr) && artifact.linkedPr > 0) target.linkedPr = artifact.linkedPr;
  } else if (kind === DEV_LOOP_TARGET_KIND.PR) {
    const pr = artifact.pr;
    if (!Number.isInteger(pr) || pr < 1) {
      throw new Error("handoff-envelope: PR target must include a valid positive PR number");
    }
    target.pr = pr;
    if (Number.isInteger(artifact.issue) && artifact.issue > 0) target.issue = artifact.issue;
  } else if (kind === DEV_LOOP_TARGET_KIND.LOCAL_BRANCH) {
    const branch = normalizeString(artifact.branch);
    if (!branch) throw new Error("handoff-envelope: local_branch target must include a non-empty branch name");
    target.branch = branch;
    if (Number.isInteger(artifact.issue) && artifact.issue > 0) target.issue = artifact.issue;
  } else if (kind === DEV_LOOP_TARGET_KIND.LOCAL_PHASE) {
    const phase = normalizeString(artifact.phase);
    const validIssue = Number.isInteger(artifact.issue) && artifact.issue > 0;
    if (!phase && !validIssue) {
      throw new Error("handoff-envelope: local_phase target must include a non-empty phase or a valid positive issue number");
    }
    if (phase) target.phase = phase;
    if (validIssue) target.issue = artifact.issue;
  }

  return target;
}

// ---------------------------------------------------------------------------
// Stop rules derivation
// ---------------------------------------------------------------------------

function deriveStopRules(settings, strategy) {
  if (settings?.autonomy?.stopAt && Array.isArray(settings.autonomy.stopAt)) {
    return [...settings.autonomy.stopAt];
  }
  return [...(STRATEGY_DEFAULT_STOP_RULES[strategy] ?? [])];
}

// ---------------------------------------------------------------------------
// requiredReads derivation
// ---------------------------------------------------------------------------

function deriveRequiredReads(bundle, resolverOutput) {
  const topReads = resolverOutput?.requiredReads;
  if (Array.isArray(topReads) && topReads.length > 0) return [...topReads];
  const reads = bundle?.requiredReads;
  return Array.isArray(reads) ? [...reads] : [];
}

// ---------------------------------------------------------------------------
// Gate config derivation
// ---------------------------------------------------------------------------

function deriveGateConfig(settings, subGate) {
  const gateKey = subGate === "pre-approval" ? "preApproval" : subGate;
  const gateSettings = settings?.gates?.[gateKey];
  if (!gateSettings) return undefined;

  const angles = Array.isArray(gateSettings.angles) ? [...gateSettings.angles] : [];
  const excludeAngles = Array.isArray(gateSettings.excludeAngles) ? [...gateSettings.excludeAngles] : [];
  const filteredAngles = angles.filter((a) => !excludeAngles.includes(a));

  return {
    angles: filteredAngles,
    excludeAngles: excludeAngles.length > 0 ? excludeAngles : undefined,
    blockCleanOnFindingSeverities: Array.isArray(gateSettings.blockCleanOnFindingSeverities)
      ? [...gateSettings.blockCleanOnFindingSeverities]
      : ["must-fix"],
    requireCi: gateSettings.requireCi ?? true,
  };
}

// ---------------------------------------------------------------------------
// Acceptance template lookup
// ---------------------------------------------------------------------------

function lookupAcceptanceTemplate(strategy, gate) {
  const key = acceptanceKey(strategy, gate);
  const template = ACCEPTANCE_TEMPLATES.get(key);
  if (!template) {
    throw new Error(
      `handoff-envelope: no acceptance template for strategy "${strategy}" + gate "${gate}". ` +
      `Known combos: ${[...ACCEPTANCE_TEMPLATES.keys()].join(", ")}`
    );
  }
  return template;
}

// ---------------------------------------------------------------------------
// cwd derivation
// ---------------------------------------------------------------------------

function deriveCwd(bundle, options = {}) {
  if (options.worktreeCwd && typeof options.worktreeCwd === "string" && options.worktreeCwd.trim().length > 0) {
    return options.worktreeCwd.trim();
  }

  const root = options.repoRoot && typeof options.repoRoot === "string"
    ? options.repoRoot.trim()
    : null;

  const artifact = bundle?.activeArtifact ?? bundle?.canonicalState?.target ?? {};
  const kind = normalizeTargetKind(artifact.kind);

  if (root) {
    const slug = buildWorktreeSlug(artifact, kind);
    if (slug) {
      return `${root}/tmp/worktrees/${slug}`;
    }
  }

  return null;
}

function flattenSlugSegment(s) {
  if (typeof s !== "string") return "";
  return s.replace(/[/\\]/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
}

function buildWorktreeSlug(artifact, kind) {
  if (kind === DEV_LOOP_TARGET_KIND.ISSUE && Number.isInteger(artifact.issue) && artifact.issue > 0) {
    const branch = normalizeString(artifact.branch);
    return branch ? `issue-${artifact.issue}-${flattenSlugSegment(branch)}` : `issue-${artifact.issue}`;
  }
  if (kind === DEV_LOOP_TARGET_KIND.PR && Number.isInteger(artifact.pr) && artifact.pr > 0) {
    const branch = normalizeString(artifact.branch);
    return branch ? `pr-${artifact.pr}-${flattenSlugSegment(branch)}` : `pr-${artifact.pr}`;
  }
  if (kind === DEV_LOOP_TARGET_KIND.LOCAL_BRANCH) {
    const branch = normalizeString(artifact.branch);
    return branch ? flattenSlugSegment(branch) : null;
  }
  if (kind === DEV_LOOP_TARGET_KIND.LOCAL_PHASE) {
    const phase = normalizeString(artifact.phase);
    const issue = Number.isInteger(artifact.issue) && artifact.issue > 0 ? artifact.issue : null;
    if (phase && issue) return `phase-${issue}-${flattenSlugSegment(phase)}`;
    if (phase) return `phase-${flattenSlugSegment(phase)}`;
    if (issue) return `issue-${issue}`;
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// gateState normalization
// ---------------------------------------------------------------------------

function normalizeGateState(gateState) {
  const gs = gateState ?? {};

  return {
    currentHeadSha: normalizeStringOrNull(gs.currentHeadSha) ?? null,
    ciStatus: normalizeStringOrNull(gs.ciStatus) ?? null,
    unresolvedThreadCount: normalizePositiveInt(gs.unresolvedThreadCount) ?? 0,
    copilotRoundCount: normalizePositiveInt(gs.copilotRoundCount) ?? 0,
    currentSubGate: normalizeString(gs.currentSubGate) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Sub-gate resolution
// ---------------------------------------------------------------------------

function resolveSubGate(strategy, gateState) {
  if (strategy === INTERNAL_DEV_LOOP_STRATEGY.COPILOT_PR_FOLLOWUP) {
    const sub = gateState.currentSubGate;
    if (sub === "draft" || sub === "watch" || sub === "pre-approval") return sub;
    return "draft";
  }
  return "default";
}


// ---------------------------------------------------------------------------
// Deep freeze helper
// ---------------------------------------------------------------------------

function deepFreeze(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a deterministic handoff envelope from resolver output + settings + gate state.
 */
export function buildDevLoopHandoffEnvelope(resolverOutput, settings, gateState = {}, options = {}, now = null) {
  if (!resolverOutput || typeof resolverOutput !== "object") {
    throw new Error("handoff-envelope: resolverOutput is required and must be an object");
  }

  const bundle = resolverOutput.bundle ?? resolverOutput;
  const strategy = requireString(bundle.selectedStrategy, "resolverOutput.selectedStrategy");
  const executionMode = requireString(bundle.executionMode, "resolverOutput.executionMode");
  const nextAction = requireString(bundle.nextAction, "resolverOutput.nextAction");

  const repo = normalizeRepo(options.repoSlug ?? bundle.repoSlug ?? bundle.repo);
  if (!repo) throw new Error("handoff-envelope: repo slug is required (owner/name)");

  const gs = normalizeGateState(gateState);
  const subGate = resolveSubGate(strategy, gs);

  const target = deriveTarget(bundle, repo);
  const requiredReads = deriveRequiredReads(bundle, resolverOutput);
  const stopRules = deriveStopRules(settings, strategy);
  const gateConfig = deriveGateConfig(settings, subGate);
  const derivedCwd = deriveCwd(bundle, { repoRoot: options.repoRoot, worktreeCwd: options.worktreeCwd });
  const template = lookupAcceptanceTemplate(strategy, subGate);

  const overrides = options.overrides && typeof options.overrides === "object" && Object.keys(options.overrides).length > 0
    ? { ...options.overrides }
    : undefined;

  const envelope = {
    handoffVersion: ENVELOPE_HANDOFF_VERSION,
    derivedAt: (now ?? new Date()).toISOString(),

    target,
    currentGate: subGate,
    currentHeadSha: gs.currentHeadSha,
    ciStatus: gs.ciStatus,
    unresolvedThreadCount: gs.unresolvedThreadCount,
    copilotRoundCount: gs.copilotRoundCount,
    maxCopilotRounds: settings?.refinement?.maxCopilotRounds ?? 5,
    executionMode,

    nextAction,
    requiredReads,

    stopRules,
    asyncStartMode: settings?.workflow?.asyncStartMode ?? "required",
    requireDraftFirst: settings?.workflow?.requireDraftFirst ?? false,

    cwd: derivedCwd,
    worktreeRequired: true,

    acceptance: {
      criteria: [...template.criteria],
      evidence: [...template.evidence],
      maxFinalizationTurns: template.maxFinalizationTurns,
    },

    control: {
      needsAttentionAfterMs: template.needsAttentionAfterMs,
      activeNoticeAfterMs: template.activeNoticeAfterMs,
    },
  };

  if (gateConfig) {
    envelope.gateConfig = gateConfig;
  }

  if (overrides) {
    envelope.overrides = overrides;
  }

  return deepFreeze(envelope);
}

export {
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
};

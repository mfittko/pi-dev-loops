# Gate-Review Sub-Loop Contract

This document defines the reusable gate-review sub-loop execution shape shared by the
two dev-loop gate boundaries: `draft_gate` and `pre_approval_gate`.

## Purpose

Both gates share the same execution mechanism: a structured sub-loop that provides
isolation, fresh-reviewer fan-out, fan-in synthesis, and iterative fix-then-retry.
Codifying the sub-loop once as a shared contract avoids inconsistent execution.

This contract owns the **execution shape** of gate-review work. It does not own:
- which review angles a specific gate runs (that stays in the skill)
- the visible gate-review PR comment format (owned by [Gate Review Comment Contract](./gate-review-comment-contract.md))
- the broader PR lifecycle sequencing (owned by the workflow skill and [PR Lifecycle Contract](../skills/docs/pr-lifecycle-contract.md))

## Relationship to the gate-review comment contract

The sub-loop executes the review work. The gate-review comment contract
([Gate Review Comment Contract](gate-review-comment-contract.md)) defines the visible PR comment evidence that
proves the sub-loop completed for a specific head SHA. Both are required for a gate to
be satisfied, but they address different concerns:
- this contract = **how** the review work is structured and executed
- gate-review comment contract = **what** visible evidence must exist on the PR

## Sub-loop phases

The sub-loop is a single reusable shape. Both gates run it with their own review angles,
but the execution phases are identical.

### Phase 1 — Preamble: context-builder

Before fanning out reviewers, run a preamble pass that produces review handoff context
on an isolated checkout:

- fresh context (do not fork the parent session just to share chat history). **Mandatory:** every gate-review subagent must run `scripts/github/verify-fresh-review-context.mjs` at startup and refuse to proceed on contamination.
- `worktree: true` recommended per reviewer/subagent for filesystem isolation; prescribe it but
  do not fail closed if worktrees are unavailable in the current environment
- the preamble produces one or more review handoff artifacts (branch, head SHA, PR/issue
  scope, acceptance criteria, touched files, validation posture)
- reference the pi-subagents `parallel context-build` technique when applicable:
  run parallel `context-builder` agents from fresh context with distinct output paths
  (e.g. `context-build/request-and-scope.md`, `context-build/codebase-and-patterns.md`,
  `context-build/validation-and-risks.md`) and synthesize the outputs into the review
  handoff artifacts

### Phase 2 — Fork fan-out: parallel reviewers

Fan out one fresh-context reviewer per gate-specific review angle. Each reviewer:

- starts in fresh context (do not inherit prior conversation state) **Mandatory:** run `scripts/github/verify-fresh-review-context.mjs` at startup; refuse to proceed on contamination.
- receives a concise briefing summary from the preamble handoff artifacts
- is scoped to exactly one review angle
- is **read-only**: inspects the diff and returns findings via output artifacts only; never edits files
- runs in an isolated worktree when worktrees are available
- produces a focused findings artifact with verdict (clean/findings_present) and file references

Reviewers run in parallel when practical. If parallel execution is impractical
(for example due to tooling or resource constraints), run all reviewers sequentially
and explicitly record why parallel execution was impractical.

**Re-run rule:** In subsequent retry cycles (Phase 5), only re-run reviewers that
produced `findings_present` in the previous pass. Reviewers that returned `clean`
don't need re-review unless their angle's scope overlaps with the fix changes.

### Phase 3 — Consolidation: fan-in synthesis

Merge the parallel reviewer findings into one consolidated fix plan using a
consolidation pass (not manual concatenation):

- collate findings from all review angles
- classify each finding: `must-fix`, `worth-fixing-now`, `defer`
- produce a merged findings artifact
- determine the overall gate verdict: `clean` (no must-fix findings),
  `findings_present` (must-fix findings remain), or `blocked` (the gate could not complete or a hard blocker prevented a verdict)

**Post-findings rule:** The consolidated findings must be posted as a visible
PR comment (via the gate-review comment contract) **before** the fix cycle in
Phase 4 begins. Fixes must not be applied until the auditable trail exists on
the PR.

### Phase 4 — Fix

If must-fix findings are present:

- apply only the accepted narrow fixes on the same branch
- do not broaden scope or touch unrelated files
- run the smallest honest validation for the accepted fix scope
- commit and push fixes on the branch

### Phase 5 — Repeat until clean

After applying fixes and advancing the head SHA:

- **Re-gate is mandatory:** a new head SHA always requires a fresh full-chain gate pass. Never skip the gate because a previous head was clean.
- rerun the sub-loop from Phase 1 (context-builder preamble for the new head SHA)
- continue the fix-then-retry cycle until the synthesis verdict is `clean`
- on retry, only re-invoke reviewers that previously returned `findings_present`; the context-builder and consolidation always run fresh
- a clean pass means all gate-specific review angles pass and no must-fix findings remain

## Machine-parseable fields

The sub-loop execution shape can be referenced programmatically via these fields:

| Field | Value | Description |
|---|---|---|
| `subLoopPhases` | `[preamble, fanout, fanin, fix, repeat]` | Ordered sub-loop phases |
| `contextBuilderRequired` | `true` | Preamble phase must include fresh-context context-builder |
| `worktreeRecommended` | `true` | Worktree isolation recommended but not hard-required |
| `fixRetryUntilClean` | `true` | Must-fix findings trigger fix → retry until synthesis is clean |

## Gate-specific configuration

Each gate configures the sub-loop with its own review angles. The execution phases are
identical; only the review angles differ.

| Gate | Review angles | Owned by |
|---|---|---|
| `draft_gate` | Resolved from config (`resolveGateAngles(config, "draft")`) | [Copilot PR Follow-up Skill](../skills/copilot-pr-followup/SKILL.md) |
| `pre_approval_gate` | Resolved from config (`resolveGateAngles(config, "preApproval")`) | [Copilot PR Follow-up Skill](../skills/copilot-pr-followup/SKILL.md) |

## Non-substitution rule

A clean sub-loop pass for one gate does not satisfy the other gate. Each gate requires
its own complete sub-loop execution with its own review angles and its own visible
gate-review comment on the PR for the reviewed head SHA.

## See also

- [Gate-Review Comment Contract](./gate-review-comment-contract.md) — visible PR comment evidence format
- [PR Lifecycle Contract](../skills/docs/pr-lifecycle-contract.md) — broader lifecycle state machine
- [Copilot PR Follow-up](../skills/copilot-pr-followup/SKILL.md) — skill that owns gate execution
- [Local Implementation](../skills/local-implementation/SKILL.md) — uses chain pattern for local phase reviews

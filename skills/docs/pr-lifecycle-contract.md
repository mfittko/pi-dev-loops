# PR lifecycle contract

This document defines the deterministic **family-local PR lifecycle contract** for the GitHub/Copilot workflow family in `pi-dev-loops`.

The canonical contract lives in the shipped `skills/docs/` surface because installed skill/runtime consumers reliably own the skills subtree.

It consolidates the lifecycle boundary currently split across:
- `docs/copilot-loop-state-graph.md`
- `docs/reviewer-loop-state-graph.md`
- `docs/gate-review-comment-contract.md`

## Purpose

This contract freezes the end-to-end lifecycle semantics for one PR as it moves through:

```text
draft-stage local gate -> draft remediation -> ready-for-review
-> explicit Copilot request/wait -> Copilot remediation / reply-resolve / re-review
-> final local pre-approval gate -> human approval / merge waits
```

This document owns the **family-local lifecycle semantics** only.
It does not redefine helper transport mechanics, reviewer-loop internals, conductor routing, or merge policy.

## Relationship to adjacent contracts

| Surface | Relationship |
|---|---|
| `docs/copilot-loop-state-graph.md` | Copilot-family inner-loop state machine consumed by this lifecycle |
| `docs/reviewer-loop-state-graph.md` | Reviewer-side review production / submission boundary consumed by this lifecycle |
| `docs/gate-review-comment-contract.md` | Visible evidence contract for `draft_gate` and `pre_approval_gate` |
| `docs/conductor-routing-contract.md` | Downstream consumer of family-local lifecycle outcomes |
| issue #29 | Reviewer-loop boundary semantics |
| issue #34 | Copilot request / re-request / watch helper mechanics |
| issue #43 | DRY/KISS/YAGNI policy for the final local pre-approval gate |
| issue #61 | Conductor routing and loop-family handoff above this family-local lifecycle |
| issue #32 | Ownership/idempotency truth for active runs |

## Core rules

- Exactly **one current lifecycle state** must apply at a time.
- The lifecycle must fail closed when required evidence is missing, stale, ambiguous, or unparsable.
- Every gate-crossing decision is for the **current PR head SHA**.
- Draft existence alone is **not** draft-gate readiness.
- A PR must clear the draft-stage gate for the current head before Copilot review may be requested.
- Ready -> draft resets the lifecycle back into draft-stage gating.
- Human approval / merge are explicit external waits, not hidden remediation states.

## Two required local gates

### 1. `draft_gate`

Applies while the PR is draft.

Purpose:
- decide whether the current draft head is materially reviewable
- decide whether the PR stays draft for more remediation or may leave draft

Boundary note:
- `draft_gate` governs only the draft -> ready-for-review boundary for the reviewed head
- visible comment schema/evidence rules stay in `docs/gate-review-comment-contract.md`

### 2. `pre_approval_gate`

Applies after Copilot convergence and before final approval / merge claims.

This gate uses the DRY/KISS/YAGNI review policy from #43.

Boundary note:
- `pre_approval_gate` governs only final approval readiness for the reviewed head
- visible comment schema/evidence rules stay in `docs/gate-review-comment-contract.md`

## Lifecycle states

The family-local lifecycle should be modeled in this vocabulary. These state identifiers are part of the stable contract surface for this lifecycle, even if adjacent helper implementations evolve around them:

| State | Meaning |
|---|---|
| `draft_local_review_gate` | draft PR is at the local draft-stage gate boundary |
| `draft_local_remediation` | draft-stage findings require more local remediation while the PR remains draft |
| `ready_state_needs_copilot_request` | draft gate is clear for the current head; Copilot request is the next legal step |
| `waiting_for_copilot_review` | Copilot request/re-review is observably in progress for the current head |
| `copilot_feedback_remediation` | actionable Copilot feedback exists; fixes are the next active step |
| `copilot_reply_resolve_pending` | fixes were applied, but GitHub thread reply/resolve work still remains |
| `final_local_preapproval_gate` | current-head post-Copilot convergence is ready for the final local gate |
| `final_gate_remediation` | DRY/KISS/YAGNI findings require more remediation after the final gate |
| `waiting_for_human_pr_approval` | local gates are satisfied; waiting for explicit human approval |
| `waiting_for_merge` | approval exists; waiting for merge / merge-triggering external action |
| `terminal_slice_complete` | merged/closed and no further owned step remains |
| `stopped_needs_user_decision` | blocked/ambiguous state requiring explicit human decision |

## Required transitions

At minimum, the lifecycle must enforce these transitions:

- `draft_local_review_gate` -> `draft_local_remediation`
  - blocking `draft_gate` findings
- `draft_local_review_gate` -> `ready_state_needs_copilot_request`
  - clean current-head `draft_gate` evidence exists
- `draft_local_review_gate` -> `stopped_needs_user_decision`
  - human decision required
- `draft_local_remediation` -> `draft_local_review_gate`
  - fixes pushed on the draft head
- `ready_state_needs_copilot_request` -> `waiting_for_copilot_review`
  - explicit request/confirm succeeded
- `ready_state_needs_copilot_request` -> `stopped_needs_user_decision`
  - request unavailable or blocked
- `waiting_for_copilot_review` -> `copilot_feedback_remediation`
  - actionable Copilot feedback exists
- `copilot_feedback_remediation` -> `copilot_reply_resolve_pending`
  - fixes applied but reply/resolve still remains
- `copilot_reply_resolve_pending` -> `ready_state_needs_copilot_request`
  - reply/resolve complete and another Copilot pass is required
- `waiting_for_copilot_review` -> `final_local_preapproval_gate`
  - the current-head request/re-review cycle has settled cleanly with no actionable feedback and no further Copilot pass is needed
- `final_local_preapproval_gate` -> `final_gate_remediation`
  - DRY/KISS/YAGNI findings require changes
- `final_local_preapproval_gate` -> `waiting_for_human_pr_approval`
  - clean current-head `pre_approval_gate` evidence exists
- `waiting_for_human_pr_approval` -> `waiting_for_merge`
  - approval arrives
- `waiting_for_human_pr_approval` -> `draft_local_review_gate`
  - PR reset to draft
- `waiting_for_merge` -> `terminal_slice_complete`
  - merged/closed and the PR lifecycle is complete

### Required negative boundaries

- no Copilot request before clean current-head `draft_gate` evidence
- no direct skip from fix-applied to Copilot re-request while reply/resolve remains incomplete
- no reuse of ready-side or gate evidence after ready -> draft
- no implicit fallthrough from approval/merge waits into remediation without a triggering event

## Remediation ownership boundary

The lifecycle must keep the next action class explicit:
- draft-stage local findings route to `draft_local_remediation`
- actionable Copilot feedback routes to `copilot_feedback_remediation`
- fixes applied but unresolved GitHub reply/resolve work remains route to `copilot_reply_resolve_pending`
- final DRY/KISS/YAGNI findings route to `final_gate_remediation`
- human approval / merge remain explicit external waits

Reviewer-loop reminder:
- reviewer-loop semantics end at a review result / submission boundary
- this lifecycle defines what happens after that boundary without absorbing reviewer-loop planning/submission behavior

## Required evidence classes

The lifecycle distinguishes two evidence classes:

1. **observable GitHub state**
   - PR draft/non-draft/merged/closed state
   - current head SHA
   - reviews, review threads, requested reviewers
   - any current-head validation/check freshness only where an adjacent gate/helper already makes a boundary CI-dependent

2. **visible gate evidence on the PR**
   - current-head `draft_gate` evidence when draft-gate clearance is required
   - current-head `pre_approval_gate` evidence when final approval readiness is required

### Precedence rules

- current observable PR/head state beats stale local memory
- required visible gate evidence beats local-only gate records for crossing a gate boundary
- incomplete or conflicting evidence yields fail-closed blocked/reconcile behavior, not optimistic progression

## Fail-closed rules

The lifecycle must stop or reconcile rather than advance when:
- current head SHA cannot be determined
- required current-head `draft_gate` evidence is missing
- required current-head `pre_approval_gate` evidence is missing
- gate evidence exists but gate name, verdict, or reviewed SHA is missing or unparsable
- evidence exists only for an older head SHA
- review-thread capture failed or is incomplete, so unresolved feedback cannot safely be treated as zero
- Copilot request status is failed, unavailable without in-progress evidence, or otherwise ambiguous for the current head
- a required current-head wait cannot be confirmed settled
- a boundary that is already CI/validation-dependent cannot confirm current-head freshness because the relevant status is pending, none, unknown, or stale
- a required visible gate comment could not be confirmed posted

In those cases the workflow must not:
- leave draft
- request or re-request Copilot review
- declare final approval readiness
- silently fall through to a more permissive state


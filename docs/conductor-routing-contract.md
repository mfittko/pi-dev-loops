# Conductor Routing Contract

This document defines the **conductor routing contract** for an already-targeted active run: which loop family
owns the next active step, and what machine-readable handoff payload should be emitted.

## Overview

The conductor routing layer answers one specific question after ownership and family-local lifecycle state are
already known:

> For this active run, which loop family should receive control now, and what exact handoff envelope should
> downstream workers consume?

This contract starts **after**:
- the active run has been identified (scope/target resolved)
- ownership/idempotency has been classified (from `conductor-ownership.mjs`, issue #32)
- family-local lifecycle states have been detected (from `copilot-loop-state.mjs`, `reviewer-loop-state.mjs`, issue #26)
- the outer-loop has produced its combined action decision

## Relationship to other contracts

| Contract / Issue | Relationship |
|---|---|
| [#28 — conductor umbrella](https://github.com/mfittko/pi-dev-loops/issues/28) | Parent umbrella |
| [#32 — ownership/idempotency](https://github.com/mfittko/pi-dev-loops/issues/32) | **Upstream**: provides `ownershipState` input; this contract starts after ownership is settled |
| [#26 — family-local lifecycle states](https://github.com/mfittko/pi-dev-loops/issues/26) | **Upstream**: provides `copilotState` and `reviewerState` inputs; this contract consumes them without redefining their semantics |
| [#34 — request/watch helper contract](https://github.com/mfittko/pi-dev-loops/issues/34) | **Adjacent**: defines Copilot request/watch semantics inside the copilot loop family; this contract decides _which family_ gets control |
| [#48 — visible PR projection](https://github.com/mfittko/pi-dev-loops/issues/48) | **Downstream**: routing decisions may drive PR projection artifacts |
| [#57/#58/#59 — inspection/viewer/steering](https://github.com/mfittko/pi-dev-loops/issues/57) | **Adjacent**: read-only inspection surfaces; this contract defines routing policy, not operator UX |

## Boundary

This contract owns **conductor routing and handoff decisions after ownership and family-local state are already known**.

It does **not** define:
- which run is active (ownership/idempotency rules from #32)
- PR lifecycle state semantics, gate order, or draft/ready transitions (from #26)
- Copilot request/re-request/watch helper semantics (from #34)
- PR-visible projection artifacts (from #48)
- inspection, viewer, or steering surfaces (from #57/#58/#59)
- family-local state machines (copilot-loop-state.mjs, reviewer-loop-state.mjs)
- backend discovery, remote polling, or transport coordination

## Implementation

| Component | Location |
|---|---|
| Core routing evaluator | `packages/core/src/loop/conductor-routing.mjs` |
| Core unit tests | `packages/core/test/conductor-routing.test.mjs` |
| Integration tests (outer-loop adapter) | `test/loop/conductor-routing.test.mjs` |
| Thin adapter integration | `scripts/loop/outer-loop.mjs` (emits `conductorRouting` in output) |

---

## Routing inputs

The evaluator (`evaluateConductorRouting`) consumes a single normalized input object.

### Required inputs

| Field | Type | Description |
|---|---|---|
| `target` | `{ repo: string, pr: number }` | Explicit target identity — already resolved by the caller |
| `copilotState` | `string` | Already-detected copilot loop lifecycle state (from `STATE` constants in `copilot-loop-state.mjs`) |
| `reviewerState` | `string` | Already-detected reviewer loop lifecycle state (from `REVIEWER_STATE` constants in `reviewer-loop-state.mjs`) |
| `outerAction` | `string` | Outer-loop combined action decision from `outer-loop.mjs` |

### Optional inputs

| Field | Type | Default | Description |
|---|---|---|---|
| `ownershipState` | `string` | undefined | Settled ownership/idempotency classification from `conductor-ownership.mjs`. When `"duplicate_local_owners"`, routing fails closed to `needs_reconcile`. |
| `outerReason` | `string` | undefined | Stop reason from the outer-loop (present when `outerAction` is `"stop"`). `"unknown_state"` triggers `needs_reconcile` instead of `stop_needs_human`. |
| `sourceMode` | `string` | `"local"` | Source/confidence mode: `"authoritative"` \| `"local"` \| `"snapshot"` |
| `requiresLocalIsolation` | `boolean` | `false` | Whether the next step requires local mutation/execution in an isolated checkout |

### Sufficient signals for direct routing

The following input combinations are sufficient for direct routing (no reconcile needed):

| Input condition | Direct routing allowed |
|---|---|
| All required fields present and valid | ✓ |
| `ownershipState` is absent or any value except `"duplicate_local_owners"` | ✓ |
| `copilotState` and `outerAction` are not in contradiction (see conflict rules) | ✓ |

### Inputs that require reconcile first

| Input condition | Why reconcile is required |
|---|---|
| `target` is missing or malformed | Cannot route without resolved target identity |
| `copilotState` is missing or empty | Cannot route without family-local state |
| `reviewerState` is missing or empty | Cannot route without family-local state |
| `outerAction` is missing, empty, or unknown | Cannot route without outer-loop decision |
| `ownershipState === "duplicate_local_owners"` | Multiple local owners; ownership must be resolved first |
| `outerAction === "done"` but `copilotState !== "done"` | Contradictory terminal signals |
| `copilotState === "done"` but `outerAction !== "done"` | Contradictory terminal signals |
| `outerAction === "stop"` with `outerReason === "unknown_state"` | Unresolvable state; not a clean human-blocked stop |

---

## Routing outcome taxonomy

| Outcome | Meaning | Loop family |
|---|---|---|
| `continue_current_wait` | Outer-loop wait state; re-enter after bounded wait interval | `outer_loop` |
| `handoff_to_copilot_loop` | Copilot inner loop should handle the next step | `copilot_loop` |
| `handoff_to_reviewer_loop` | Reviewer inner loop should handle the next step | `reviewer_loop` |
| `stay_with_current_live_owner` | A live owner already has control; no new handoff needed | varies |
| `stop_needs_human` | Blocked; requires human intervention before any loop can proceed | none |
| `done_terminal` | PR is merged, closed, or fully done; no further action needed | none |
| `needs_reconcile` | Ambiguous, conflicting, stale, or insufficient signals | none |

---

## Handoff envelope

Every routing decision emits a `handoffEnvelope` with the following fields:

| Field | Type | Description |
|---|---|---|
| `targetIdentity` | `{ repo: string, pr: number }` | Normalized target identity for downstream workers |
| `loopFamily` | `string \| null` | Which loop family receives control; `null` for terminal/blocked/reconcile |
| `entrypoint` | `string \| null` | Specific handler identifier; `null` when no automated handler applies |
| `reason` | `string` | Human-readable reason/evidence summary for the routing decision |
| `requiredArgs` | `object` | Minimum args required by the entrypoint handler (`{ repo, pr }` at minimum) |
| `requiresLocalIsolation` | `boolean` | Whether the next step needs an isolated local checkout |
| `confidence` | `string` | Source mode: `"authoritative"` \| `"local"` \| `"snapshot"` |

### Entrypoint identifiers

| Entrypoint | Handler | Used for |
|---|---|---|
| `copilot_pr_handoff` | `scripts/loop/copilot-pr-handoff.mjs` | Copilot loop re-entry |
| `reviewer_loop_handler` | Reviewer-side loop handler | Reviewer loop re-entry |
| `outer_loop_wait` | `scripts/loop/outer-loop.mjs` (wait path) | Outer wait re-run |
| `null` | none | Terminal, blocked, or reconcile states |

---

## Outer-loop action → routing outcome mapping

| Outer action | `outerReason` | Routing outcome |
|---|---|---|
| `done` | — | `done_terminal` |
| `continue_wait` | — | `continue_current_wait` |
| `reenter_copilot_loop` | — | `handoff_to_copilot_loop` |
| `reenter_reviewer_loop` | — | `handoff_to_reviewer_loop` |
| `stop` | `unknown_state` | `needs_reconcile` |
| `stop` | any other reason | `stop_needs_human` |
| unknown / missing | — | `needs_reconcile` |

---

## Conflict and fail-closed rules

The evaluator fails closed to `needs_reconcile` rather than guessing a handoff when:

1. **Target is unresolved**: `target` is missing, `null`, or missing required `repo`/`pr` fields.
2. **State inputs are absent**: `copilotState`, `reviewerState`, or `outerAction` is missing or empty.
3. **Unknown outer action**: `outerAction` is not one of the five known values (`done`, `continue_wait`, `reenter_copilot_loop`, `reenter_reviewer_loop`, `stop`).
4. **Ownership conflict**: `ownershipState === "duplicate_local_owners"`.
5. **Terminal contradiction**: `outerAction === "done"` but `copilotState !== "done"`, or `copilotState === "done"` but `outerAction !== "done"`.
6. **Unresolvable stop**: `outerAction === "stop"` with `outerReason === "unknown_state"`.

### Non-goal: this rule does not apply to noise fields

Callers may pass extra fields on the input object; unknown fields are ignored. Only the declared
required and optional fields listed above affect routing decisions.

---

## Scenario matrix

### 1. Outer wait remains outer wait

| Field | Value |
|---|---|
| `outerAction` | `"continue_wait"` |
| `copilotState` | `"waiting_for_copilot_review"` |
| `reviewerState` | `"waiting_for_review_request"` |
| Expected `routingOutcome` | `"continue_current_wait"` |
| `loopFamily` | `"outer_loop"` |
| `entrypoint` | `"outer_loop_wait"` |

### 2. Reviewer-active routes to reviewer-loop handoff

| Field | Value |
|---|---|
| `outerAction` | `"reenter_reviewer_loop"` |
| `copilotState` | `"pr_ready_no_feedback"` |
| `reviewerState` | `"review_requested"` |
| Expected `routingOutcome` | `"handoff_to_reviewer_loop"` |
| `loopFamily` | `"reviewer_loop"` |
| `entrypoint` | `"reviewer_loop_handler"` |

### 3. Copilot-active routes to Copilot-loop handoff

| Field | Value |
|---|---|
| `outerAction` | `"reenter_copilot_loop"` |
| `copilotState` | `"unresolved_feedback_present"` |
| `reviewerState` | `"waiting_for_author_followup"` |
| Expected `routingOutcome` | `"handoff_to_copilot_loop"` |
| `loopFamily` | `"copilot_loop"` |
| `entrypoint` | `"copilot_pr_handoff"` |

### 4. Blocked routes to stop_needs_human

| Field | Value |
|---|---|
| `outerAction` | `"stop"` |
| `outerReason` | `"copilot_blocked"` |
| `copilotState` | `"blocked_needs_user_decision"` |
| `reviewerState` | `"waiting_for_review_request"` |
| Expected `routingOutcome` | `"stop_needs_human"` |
| `loopFamily` | `null` |
| `entrypoint` | `null` |

### 5. Terminal state routes to done_terminal

| Field | Value |
|---|---|
| `outerAction` | `"done"` |
| `copilotState` | `"done"` |
| `reviewerState` | `"waiting_for_review_request"` |
| Expected `routingOutcome` | `"done_terminal"` |
| `loopFamily` | `null` |
| `entrypoint` | `null` |

### 6. Conflicting inner/outer signals fail closed to needs_reconcile

| Field | Value |
|---|---|
| `outerAction` | `"done"` |
| `copilotState` | `"unresolved_feedback_present"` (contradicts "done") |
| `reviewerState` | `"waiting_for_author_followup"` |
| Expected `routingOutcome` | `"needs_reconcile"` |
| `loopFamily` | `null` |
| `entrypoint` | `null` |

### 7. Non-target / noise inputs do not alter routing for a targeted run

| Condition | Expected `routingOutcome` |
|---|---|
| `target` is `null` | `"needs_reconcile"` |
| `target.pr` is not a positive integer | `"needs_reconcile"` |
| `copilotState` is empty string | `"needs_reconcile"` |
| `outerAction` is an unknown string | `"needs_reconcile"` |

---

## Non-goals

This contract intentionally does **not** cover:

- ownership-key design, duplicate-owner handling, or start/attach/resume idempotency rules (→ #32)
- PR lifecycle states, draft/ready gate order, remediation ownership classes, or approval-gate semantics (→ #26)
- Copilot request / re-request / watch helper semantics (→ #34)
- inspection, viewer, or steering surface design (→ #57/#58/#59)
- PR-visible projection / closeout artifacts (→ #48)
- replacing or redefining the existing family-local state machines
- backend discovery, remote polling, or transport coordination
- broad generic multi-family conductor rollout beyond the current Copilot PR outer-loop family

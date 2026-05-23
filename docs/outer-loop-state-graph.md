# Outer Loop State Graph

This document defines the authoritative deterministic outer-loop graph above the Copilot and reviewer inner state machines.

## Overview

The outer loop is the routing-and-handoff layer for one explicitly targeted PR.
It does **not** model family-local substeps and it does **not** build a cartesian product of all inner states.

Instead, it reuses the repository's deterministic conductor routing outcome as the authoritative outer runtime state.

Implementation lives in:

- **Pure logic**: `packages/core/src/loop/outer-loop-state.mjs`
- **Routing authority reused by that module**: `packages/core/src/loop/conductor-routing.mjs`
- **Compatibility CLI surface**: `scripts/loop/outer-loop.mjs`
- **Inspection surface**: `packages/core/src/loop/run-inspection.mjs` and `scripts/loop/inspect-run.mjs`
- **Viewer**: `scripts/loop/inspect-run-viewer.mjs`

## Authoritative Outer States

| State | Meaning |
|---|---|
| `continue_current_wait` | Outer loop is in a durable wait state; re-inspect after a bounded wait |
| `handoff_to_copilot_loop` | The next meaningful work belongs to the Copilot loop |
| `handoff_to_reviewer_loop` | The next meaningful work belongs to the reviewer loop |
| `stay_with_current_live_owner` | A live owner already controls the active run; do not issue a new handoff |
| `stop_needs_human` | Automated progress must stop until a human resolves the blocking condition |
| `done_terminal` | The PR is complete; outer automation is done |
| `needs_reconcile` | Inputs are ambiguous, conflicting, or insufficient; reconcile before routing |

These values are byte-for-byte identical to `ROUTING_OUTCOME` values from `conductor-routing.mjs`.

## Semantic Start and End

`Start` and `End` are graph semantics, not runtime states.

- `Start` means: one new outer evaluation cycle begins for the targeted PR
- `End` means: automated outer processing has reached a terminal sink for this cycle

A later human/reconcile-triggered resume is a fresh re-entry from `Start`, not an automated transition out of a terminal state.

## Terminal vs nonterminal runtime states

Terminal states:
- `stop_needs_human`
- `done_terminal`
- `needs_reconcile`

Nonterminal states:
- `continue_current_wait`
- `handoff_to_copilot_loop`
- `handoff_to_reviewer_loop`
- `stay_with_current_live_owner`

## Transition Graph

This graph is a graph of **authoritative re-evaluation outcomes across outer cycles**.

For the current first slice, the contract stays conservative:
- terminal states have no automated outgoing transitions
- nonterminal states may transition to any outer state on a later authoritative re-evaluation cycle
- the graph does **not** invent narrower pairwise restrictions that the current deterministic routing contract does not yet encode

So the exact exported transition table is:

- `continue_current_wait` -> all outer states
- `handoff_to_copilot_loop` -> all outer states
- `handoff_to_reviewer_loop` -> all outer states
- `stay_with_current_live_owner` -> all outer states
- `stop_needs_human` -> none
- `done_terminal` -> none
- `needs_reconcile` -> none

This is intentionally broad. It is authoritative because it reflects the current routing-first contract honestly.

## Compatibility projection to `outerAction`

The authoritative outer state is **not** `outerAction`.
`outerAction` remains a backward-compatible projection.

| Outer state | Compatibility `outerAction` |
|---|---|
| `continue_current_wait` | `continue_wait` |
| `handoff_to_copilot_loop` | `reenter_copilot_loop` |
| `handoff_to_reviewer_loop` | `reenter_reviewer_loop` |
| `stay_with_current_live_owner` | `continue_wait` |
| `stop_needs_human` | `stop` |
| `done_terminal` | `done` |
| `needs_reconcile` | `stop` |

Important consequences:
- `stay_with_current_live_owner` and `continue_current_wait` remain distinct authoritative states even though both project to `continue_wait`
- `needs_reconcile` and `stop_needs_human` remain distinct authoritative states even though both project to `stop`

## Fail-closed behavior

Malformed or incomplete inputs fail closed to:
- `state: needs_reconcile`
- `outerAction: stop`
- `stopReason: unknown_state`
- no allowed transitions

Checkpoint-only inspection must not fabricate authoritative current outer transitions.

## Non-goals

- rewriting conductor routing priorities
- rewriting the Copilot or reviewer inner state machines
- inventing a cartesian-product outer graph
- collapsing distinct authoritative states into the lossy `outerAction` projection

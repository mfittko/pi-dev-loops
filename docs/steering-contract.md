# Steering Contract

This document describes the deterministic mid-flight operator steering contract
for active dev loops. It covers how to submit steering directives, how the loop
acknowledges them, what the safe-point rules are, and what each result means.

## Overview

Once a dev loop is running, operators can issue a **bounded, durable steering
directive** to tighten or redirect the run — without restarting it and without
silently editing prompts. Each directive receives a deterministic
acknowledgement/result so you always know whether a correction took effect.

**This is not arbitrary prompt injection.** Steering events are schema-validated,
sequenced, persisted to durable run state, and applied only at safe points. You
can inspect the full history at any time.

## First proving target

The first implementation of this contract covers the **async Copilot review/fix
loop** (`copilot-loop-state.mjs`). The safe-point rules and integration below
are defined for that loop family. Other loop families will adopt the same contract
in subsequent work.

## Implementation

| Component | Location |
|---|---|
| Core steering module | `packages/core/src/loop/steering.mjs` |
| CLI entry-point | `scripts/loop/steer-loop.mjs` |
| Core unit tests | `packages/core/test/steering.test.mjs` |
| CLI integration tests | `test/loop/steer-loop.test.mjs` |

---

## Steering kinds

| Kind | Meaning |
|---|---|
| `hard_constraint` | A hard requirement that must be respected by subsequent steps. Additive: multiple constraints stack. Exact duplicates (case-insensitive) are rejected. |
| `preference` | A preference that should be followed but is not blocking. Multiple preferences accumulate on the effective stack. |
| `clarification` | Additional context that does not change requirements but affects how the loop interprets its task. |
| `stop_at_next_safe_gate` | Request the loop to stop at the next safe approval/mutation gate instead of continuing to the next loop step. |

---

## Acknowledgement / result classes

Each submitted steering event receives exactly one of the following results:

| Result | Meaning |
|---|---|
| `applied_now` | The directive was immediately added to the effective stack. The loop will respect it from the current step forward. |
| `queued_for_safe_point` | The loop is currently in a state where immediate application could produce inconsistent behavior. The directive is durably queued and will be promoted to the effective stack when the loop next reaches a safe point. |
| `rejected_unsafe_now` | The loop is in a terminal state (`done`, `review_request_unavailable`, `no_pr`). Steering has no effect and is rejected. The run must be restarted for a fresh steering session. |
| `rejected_invalid_or_conflicting` | The event was malformed (missing required fields), the `seq` value was out of order, or the directive exactly duplicates an existing `hard_constraint` already on the effective stack. |
| `needs_human_decision` | The loop is in `blocked_needs_user_decision`. A human must act on the blocking condition before automated steering can be applied. |

---

## Safe-point model

The safe-point classification for each copilot loop state determines whether
steering is applied immediately, queued, or rejected.

### IMMEDIATE (steering applied now)

The loop is between steps, idle, or waiting on external state. Applying steering
here is safe: no mutation is in progress.

| Loop state | Reason |
|---|---|
| `pr_ready_no_feedback` | Idle — no review has been requested yet |
| `ready_to_rerequest_review` | Between review cycles — all threads resolved, waiting for next pass |
| `waiting_for_copilot_review` | Waiting on external state (Copilot) |
| `waiting_for_ci` | Waiting on external state (CI checks) |

### NEXT_POINT (queued for next safe point)

The loop is actively computing or in the middle of a non-interruptible mutation.
Steering is accepted and queued; it is promoted to the effective stack the next
time the loop reaches an IMMEDIATE state.

| Loop state | Reason |
|---|---|
| `pr_draft` | Pre-review state — between steps but not at a mutation gate |
| `unresolved_feedback_present` | Actively computing — about to apply fixes |
| `already_fixed_needs_reply_resolve` | Non-interruptible mutation — replying to and resolving review threads |

### TERMINAL (rejected)

The loop run is complete, irreversibly failed, or has no active run. There is no
loop to steer.

| Loop state | Result |
|---|---|
| `no_pr` | `rejected_unsafe_now` — no active run |
| `done` | `rejected_unsafe_now` — run already complete |
| `review_request_unavailable` | `rejected_unsafe_now` — terminal error state |
| `blocked_needs_user_decision` | `needs_human_decision` — human action required first |

---

## Durable run state

Steering state is persisted to a JSON file so subsequent loop steps and
resumptions see the updated constraints. The default path is:

```
.pi/steering/<run-id>.json
```

You can override this with `--state-file <path>`.

### State schema

```json
{
  "runId": "string",
  "schemaVersion": 1,
  "events": [ /* all submitted events, in submission order */ ],
  "effectiveStack": [ /* events currently in effect */ ],
  "queuedEvents": [ /* events waiting for the next safe point */ ],
  "resultHistory": [ /* all acknowledgement results, in order */ ],
  "latestResult": { /* most recent acknowledgement, or null */ },
  "nextSeq": 3
}
```

---

## Ordering and sequencing

Every steering event carries a `seq` field — a positive integer that must be
monotonically increasing per run. The loop enforces this:

- If `seq < nextSeq`, the event is rejected with `rejected_invalid_or_conflicting`.
- After a successful submission (any result), `nextSeq` advances to `max(nextSeq, seq + 1)`.

This ensures a durable ordering that survives serialization, process restarts, and
replay.

---

## Conflict behavior

For `hard_constraint` events:

- Two constraints with **different** directives are allowed and stack additively.
- An event with an **identical** directive (case-insensitive) to one already on the
  effective stack is rejected with `rejected_invalid_or_conflicting` and the reason
  includes the seq number of the existing constraint.

`preference`, `clarification`, and `stop_at_next_safe_gate` events do not conflict
with each other in v1; they accumulate additively.

---

## What happens when steering arrives during a non-interruptible mutation?

When the loop is in `already_fixed_needs_reply_resolve` (replying to and resolving
review threads), it is in the middle of a multi-step GitHub mutation that must
complete atomically. Interrupting it could leave threads in a half-resolved state.

Steering submitted during this state is **queued** (`queued_for_safe_point`) and
promoted automatically when the mutation finishes and the loop transitions to a
safe point (`ready_to_rerequest_review`).

The same applies to `unresolved_feedback_present`: the loop is about to apply code
fixes. Steering is queued and promoted when the loop next reaches an idle state.

---

## Operator usage

### Submitting a directive

```sh
node scripts/loop/steer-loop.mjs submit \
  --run-id <run-id> \
  --kind hard_constraint \
  --directive "Do not add new npm dependencies" \
  --seq 1 \
  [--loop-state <current-loop-state>] \
  [--state-file .pi/steering/<run-id>.json]
```

**Required flags:**

| Flag | Description |
|---|---|
| `--run-id` | Target run identifier |
| `--kind` | One of: `hard_constraint`, `preference`, `clarification`, `stop_at_next_safe_gate` |
| `--directive` | Operator payload / directive text (non-empty) |
| `--seq` | Positive integer sequence number (must be >= current `nextSeq`) |

**Optional flags:**

| Flag | Default | Description |
|---|---|---|
| `--loop-state` | `ready_to_rerequest_review` | Current copilot loop state value |
| `--apply-mode` | `immediate` | `immediate` or `next_safe_point` |
| `--state-file` | `.pi/steering/<run-id>.json` | Path to persisted steering state |
| `--event-id` | auto-generated | Unique event identifier |

**Output (stdout, JSON):**
```json
{
  "ok": true,
  "result": {
    "eventId": "evt-...",
    "seq": 1,
    "result": "applied_now",
    "reason": null,
    "acknowledgedAt": "2026-05-16T08:00:00.000Z"
  },
  "steeringState": { ... }
}
```

### Inspecting steering state

```sh
node scripts/loop/steer-loop.mjs status \
  --run-id <run-id> \
  [--state-file .pi/steering/<run-id>.json]
```

**Output (stdout, JSON):**
```json
{
  "ok": true,
  "status": {
    "runId": "run-abc",
    "schemaVersion": 1,
    "eventCount": 2,
    "queuedCount": 0,
    "effectiveStackCount": 2,
    "effectiveConstraints": {
      "hardConstraints": ["Do not add new npm dependencies"],
      "preferences": [],
      "clarifications": [],
      "stopAtNextSafeGate": false
    },
    "latestResult": { ... },
    "resultHistory": [ ... ],
    "history": [ ... ],
    "nextSeq": 3
  }
}
```

---

## Programmatic integration

For programmatic use (e.g. inside a loop orchestrator), import from the core module:

```js
import {
  STEERING_KIND,
  STEERING_RESULT,
  SAFE_POINT_CATEGORY,
  normalizeSteeringEvent,
  normalizeSteeringState,
  createSteeringState,
  classifySafePoint,
  submitSteering,
  promoteQueuedSteering,
  getEffectiveConstraints,
  resolveEffectiveLoopState,
  getSteeringStatus,
} from "./packages/core/src/loop/steering.mjs";
```

### Integrating with the copilot loop

Use `resolveEffectiveLoopState` instead of `interpretLoopState` when steering may
be active. This function wraps `interpretLoopState` and augments its output:

```js
const { state, nextAction, steeringApplied, effectiveConstraints } =
  resolveEffectiveLoopState(snapshot, steeringState);

// When stop_at_next_safe_gate is active and the loop is at a safe point,
// nextAction is overridden to direct the operator to stop.
if (steeringApplied && effectiveConstraints.stopAtNextSafeGate) {
  // Stop instead of continuing
}

// Inject hard constraints into agent context before a fix step:
for (const constraint of effectiveConstraints.hardConstraints) {
  // Pass to agent as a constraint
}
```

### Promoting queued events on state transition

After each loop state transition, call `promoteQueuedSteering` to apply any
queued events that are now safe to apply:

```js
const { steeringState: updated, promoted } = promoteQueuedSteering(
  steeringState,
  newLoopState,
);
// Persist updated steeringState
// If promoted.length > 0, the effective stack changed
```

---

## Non-goals

- **Free-form prompt injection** into a running child with no explicit schema or acknowledgement.
- **Replacing pause/stop/restart** when the right answer is to stop the run.
- **Mutation rewrites** in the middle of a non-interruptible action.
- **Generalizing immediately** across every loop family (this first slice covers the copilot review/fix loop; other loop families are follow-up work).

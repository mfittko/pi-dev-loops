# Conductor PR Projection Contract

This document defines the **conductor PR projection contract**: which conductor-owned PR lifecycle
transitions are mirrored into visible PR-side updates and durable closeout artifacts for
conductor-led hybrid PR loops.

## Overview

The projection layer answers one narrow question **after** upstream state truth has already been
determined by the authoritative conductor surfaces:

> Given that the conductor already knows what just happened, which transitions should be
> mirrored visibly on the PR, and what durable closeout evidence must remain when the run
> stops or merges?

This contract starts **after**:
- ownership/idempotency has been classified (from `conductor-ownership.mjs`, #32)
- family-local lifecycle states have been detected (`copilot-loop-state.mjs`, `reviewer-loop-state.mjs`, #26)
- conductor routing outcomes are known (`conductor-routing.mjs`, #61)
- merge/open/closed review facts are available from GitHub

## Relationship to other contracts

| Contract / Issue | Relationship |
|---|---|
| [#28 — conductor umbrella](https://github.com/mfittko/pi-dev-loops/issues/28) | Parent umbrella |
| [#32 — ownership/idempotency](https://github.com/mfittko/pi-dev-loops/issues/32) | **Upstream**: provides settled ownership/reconcile classification; this contract consumes it |
| [#26 — family-local lifecycle states](https://github.com/mfittko/pi-dev-loops/issues/26) | **Upstream**: provides already-detected family-local lifecycle states; this contract consumes them |
| [#34 — request/watch helper contract](https://github.com/mfittko/pi-dev-loops/issues/34) | **Upstream**: defines Copilot request/watch semantics; this contract consumes those facts |
| [#61 — conductor routing / handoff](https://github.com/mfittko/pi-dev-loops/issues/61) | **Upstream**: provides conductor routing outcomes and authoritative outer state; this contract consumes them |
| [#89 — iteration summary](https://github.com/mfittko/pi-dev-loops/issues/89) | **Optional upstream data**: iteration counts may enrich status comments when available |

## Implementation

| Component | Location |
|---|---|
| Published package export | `@pi-dev-loops/core/loop/conductor-pr-projection` |
| Core projection module (source repo) | `packages/core/src/loop/conductor-pr-projection.mjs` |
| Core unit tests | `packages/core/test/conductor-pr-projection.test.mjs` |

---

## Authority boundary

Visible PR updates and closeout artifacts are **downstream observability projections only**.

They **must**:
- mirror already-determined authoritative transitions
- be idempotent across retries, restarts, and repeated polls
- remain concise enough to aid operator trust and debugging

They **must not**:
- replace routing/inspection truth surfaces
- restate a divergent state model in comment form
- depend on lossy compatibility projections when authoritative state is available

**Important**: the `outerAction` compatibility projection (`continue_wait`, `stop`, `done`, etc.)
is **not** a valid input to projection decisions. When authoritative outer state is available
(from `conductor-routing.mjs` `ROUTING_OUTCOME`), use the authoritative state directly.

---

## Projection transitions

The following conductor-owned lifecycle transitions are candidates for visible projection
or durable closeout artifacts. Only transitions that materially change operator understanding
of conductor progress are listed. Low-level poll heartbeats, timing updates, and routine
wait-state re-evaluations are excluded.

| Transition | Constant | Default requirement |
|---|---|---|
| PR entered draft stage; conductor local review gate opened | `DRAFT_GATE_ENTERED` | `none` |
| PR marked ready for review | `READY_FOR_REVIEW_ENTERED` | `visible_comment` |
| Copilot review explicitly requested/confirmed for the current head | `COPILOT_REVIEW_REQUESTED` | `visible_comment` |
| Post-rerequest Copilot settle-wait entered for the current head | `COPILOT_SETTLE_WAIT_ENTERED` | `none` |
| Clean current-head Copilot settle achieved | `COPILOT_SETTLE_ACHIEVED` | `none` |
| Copilot loop converged or re-entered a new iteration | `COPILOT_LOOP_CONVERGED` | `visible_comment` |
| Final local pre-approval gate completed | `FINAL_GATE_COMPLETED` | `none` |
| Conductor waiting for human approval | `WAITING_FOR_HUMAN_APPROVAL` | `visible_comment` |
| Conductor waiting for merge after approval | `WAITING_FOR_MERGE` | `none` |
| Merge detected (terminal or resumable) | `MERGE_DETECTED` | `both` |
| Loop blocked; human decision required | `BLOCKED_NEEDS_HUMAN_DECISION` | `both` |
| Conductor stopped cleanly | `CONDUCTOR_STOP` | `durable_artifact` |
| Reconcile required; state ambiguous | `RECONCILE_REQUIRED` | `both` |

"Default requirement" is the minimum expected output when the corresponding config is enabled.
When `githubStatusComments.enabled = false` (the default), `visible_comment` and `both`
transitions do **not** emit a comment — they only produce a durable artifact where required.

---

## Projection requirement classes

| Class | Description |
|---|---|
| `visible_comment` | Emit a concise idempotent PR/issue comment for this transition |
| `durable_artifact` | Write a durable local closeout artifact under `tmp/` or the conductor artifact area |
| `both` | Emit both a visible comment and a durable artifact |
| `none` | No external output; transition is noted in local runtime only |

---

## Idempotent no-spam rule

Repeated polls, restarts, or resumes that observe the **same effective projected transition**
must **not** emit duplicate visible PR comments or write duplicate artifacts.

### Projection key

When the input is valid and authoritative enough to project safely, `computeProjectionKey` returns a stable idempotency key:

```
<normalized-repo>#<pr>/<transition>[/<extra>]
```

When the target, transition, or keyed context is invalid or non-authoritative, `computeProjectionKey` fails closed to `null`, and callers must suppress visible projection/artifact emission instead of inventing an unstable identity.

The `extra` component is included only when the transition's idempotency depends on additional
context:
- `MERGE_DETECTED` always appends a deterministic post-merge kind (`terminal_closeout` by default, or `resumable_continuation` when provided)
- `BLOCKED_NEEDS_HUMAN_DECISION` / `RECONCILE_REQUIRED` append an optional stable `blockerKey`
- `COPILOT_SETTLE_WAIT_ENTERED` / `COPILOT_SETTLE_ACHIEVED` append an optional `headSha`

### Key stability rules

- Keys are **stable across process restarts/resumes** — the same conductor-owned transition
  produces the same key regardless of which process instance observes it.
- A transition to a **genuinely different state** produces a different key and may emit a new
  visible update even if it reuses similar wording.
- Poll heartbeats that observe the same effective state produce the same key as the original
  transition and must be suppressed.

---

## Terminal vs resumable post-merge rule

Merge is not one generic outcome. The `classifyPostMergeKind` function distinguishes:

| Kind | When | Meaning |
|---|---|---|
| `terminal_closeout` | No known next owned step remains | The owned slice is complete; no follow-up automation is expected |
| `resumable_continuation` | A known next owned step or follow-up issue exists | Merge happened; a continuation step is still expected |

This distinction must be captured in the `MERGE_DETECTED` durable artifact so operators can
tell without replaying the whole run whether follow-up work is still expected.

---

## Configuration

Both projection modes are **opt-in and off by default**. See `defaultProjectionConfig()` for
the default shape.

### Status comment configuration

```json
{
  "githubStatusComments": {
    "enabled": false,
    "mode": "upsert",
    "target": "pr-or-issue",
    "verbosity": "concise"
  }
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Must be explicitly `true` to emit any visible PR/issue comments |
| `mode` | `"upsert"` | Prefer upserting a single conductor status comment for routine state |
| `target` | `"pr-or-issue"` | PR comments for PR lifecycle loops; issue comments when no PR exists yet |
| `verbosity` | `"concise"` | Keep comment bodies concise; avoid repeating state that GitHub already shows |

### Mention configuration

```json
{
  "mentions": {
    "enabled": false,
    "allowedUsers": [],
    "cooldownMinutes": 120
  }
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Must be explicitly `true` to emit any mention |
| `allowedUsers` | `[]` | Explicit allow-list; mentions are never sent to users not in this list |
| `cooldownMinutes` | `120` | Cooldown window between mentions for the same effective blocker |

---

## Guarded mention rule

Mentions (`@user`) are only emitted when **all five** eligibility criteria are simultaneously
satisfied (via `evaluateMentionEligibility`):

1. `mentions.enabled === true` in config
2. The trigger matches a known `MENTION_TRIGGER` value
3. The mention target is in `config.mentions.allowedUsers`
4. The cooldown window has fully elapsed since the last mention for the same effective blocker
5. The mention includes a specific, non-empty `actionableAsk`

### Valid mention triggers

| Trigger | When to use |
|---|---|
| `blocked_needs_human_decision` | Loop is in a genuine blocked state requiring a specific human decision |
| `reconcile_required` | Conductor must reconcile; human must intervene to resolve ownership conflict |
| `conductor_stop_with_pending_action` | Conductor stopped cleanly but a known next step needs human kickoff |

### Do NOT mention for routine wait states

Mentions must **not** be emitted for:
- waiting for CI
- waiting for Copilot review
- waiting for scheduled watcher polling
- clean converged states
- any poll heartbeat

### Example blocked mention

```md
Dev loop blocked.

@mfittko please decide whether to:
1. keep the compatibility shim behavior as-is, or
2. require a hard deprecation warning in this PR.

I will continue after that decision.
```

---

## Durable closeout artifacts

When a slice enters a terminal state or the live conductor owner stops, the following durable
evidence must remain:

| Trigger | Required evidence |
|---|---|
| `MERGE_DETECTED` (terminal closeout) | Local artifact recording that the slice completed with no continuation expected |
| `MERGE_DETECTED` (resumable continuation) | Local artifact recording the merge and the known next owned step or follow-up reference |
| `BLOCKED_NEEDS_HUMAN_DECISION` | Local artifact recording the specific blocker and what human action is required |
| `CONDUCTOR_STOP` | Local artifact recording that the conductor stopped cleanly and the state at stop time |
| `RECONCILE_REQUIRED` | Local artifact recording the ambiguous/conflicting condition before reconcile |

Artifacts are written under `tmp/` or the designated conductor artifact area. They persist
across process restarts so operators can inspect conductor state without re-running the loop.

---

## Related issue / epic log updates

An issue or epic log update is required as part of post-merge closeout or pilot observability
when:
- the merge outcome was a **resumable continuation** with a linked follow-up issue
- the conductor entered a **terminal stop** that terminates an entire planned phase or epic slice
- the **reconcile-required** state affects a parent-level tracking item

For routine slice completion (terminal closeout with no parent-level effect), an issue/epic
log update is **not** required.

---

## Non-goals

This contract intentionally does **not** cover:

- redesigning the request/watch state machine itself (→ #34)
- redesigning singleton ownership or live-owner attach semantics (→ #32)
- fully specifying the broader review/remediation choreography (→ #26)
- redefining conductor routing/handoff precedence (→ #61)
- replacing GitHub-native review/merge state with a custom status system
- turning every poll heartbeat into a visible PR comment
- making PR comments/artifacts the source of truth for routing or reconcile
- iteration count tracking (→ #89, consumed as optional enrichment when available)

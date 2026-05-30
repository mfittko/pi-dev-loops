# Retrospective checkpoint contract

This document defines the enforcement seam for the required post-run behavioral retrospective after qualifying async `dev-loop` completions in this repository.

## Packaged / installed skill use

This file is a required runtime contract doc for installed `dev-loop` skill consumers.

Installer/package guarantee for this slice:
- installed copies of the `dev-loop` and `copilot-dev-loop` skills must bundle this document once under the canonical shared installed path `.pi/skills/docs/retrospective-checkpoint-contract.md` (resolved as `../docs/retrospective-checkpoint-contract.md` from each installed skill directory)
- installed skill/runtime guidance must read that bundled installed copy instead of assuming a source-repository checkout is present
- if the bundled installed copy is missing, treat that as a packaging/installer bug rather than silently falling back to an unrelated checkout

## Relationship to formal dev mode

Formal local dev mode and the required post-run behavioral retrospective are related but distinct:

| Requirement | Scope |
|---|---|
| **Formal local dev mode** | Local implementation/self-improvement work; explicitly scoped in `skills/dev-loop/SKILL.md` |
| **Required post-run behavioral retrospective** | Every qualifying async GitHub-first `dev-loop` completion in this repo |

Routed GitHub-first async `dev-loop` runs do **not** need to be in full formal local dev mode, but they **do** require the retrospective checkpoint.

## Qualifying completions

A qualifying async `dev-loop` completion is one that:
- routes through a GitHub-first Copilot-owned strategy gate, and
- has `routeKind === "route"` (inspect/status-only results do not qualify).

Qualifying gates:

| Gate | Strategy | Description |
|---|---|---|
| `copilot_pr_followup` | Copilot PR follow-up | Primary routed GitHub-first async path |
| `issue_intake` | Issue intake | Copilot-first issue assignment path |

The authoritative classification function is `isQualifyingAsyncCompletion(routingResult)` in `packages/core/src/loop/retrospective-checkpoint.mjs`.

## Checkpoint states

A fresh session can determine the status of the required retrospective by reading `.pi/dev-loop-retrospective-checkpoint.json`:

| File state | Mapped checkpoint state | Meaning |
|---|---|---|
| File absent | `RETROSPECTIVE_CHECKPOINT_STATE.NONE` | No qualifying completion has occurred; no requirement |
| `{ "state": "required" }` | `RETROSPECTIVE_CHECKPOINT_STATE.MISSING` | Qualifying completion detected; retrospective pending |
| `{ "state": "complete" }` | `RETROSPECTIVE_CHECKPOINT_STATE.COMPLETE` | Retrospective recorded; requirement satisfied |
| `{ "state": "skipped" }` | `RETROSPECTIVE_CHECKPOINT_STATE.SKIPPED` | Explicitly skipped with reason; requirement satisfied |

## Enforcement gate

The enforcement seam is the pure function `evaluateRetrospectiveGate` in `packages/core/src/loop/retrospective-checkpoint.mjs`.

For convenience, the public routing helpers in `packages/core/src/loop/public-dev-loop-routing.mjs` also accept an optional `retrospectiveCheckpointState` input and apply the same gate internally before returning routed start/resume/status results.

### Inputs

```js
evaluateRetrospectiveGate({
  checkpointState,  // one of RETROSPECTIVE_CHECKPOINT_STATE
  proposedRouting,  // result from evaluatePublicDevLoopRouting()
})
```

### Outputs

- **Pass-through** (proposed routing returned unchanged) when:
  - `checkpointState` is `none`, `complete`, or `skipped`
  - `proposedRouting` is already `stop`, `needs_reconcile`, or `inspect`
- **Fail-closed** (`needs_reconcile` result) when:
  - `checkpointState` is `missing`
  - `checkpointState` is unrecognized

### Caller contract

Callers have two supported integration options:

#### Option A — direct public-routing helper integration (preferred)

1. Read `.pi/dev-loop-retrospective-checkpoint.json` (if it exists).
2. Map the file contents to a `RETROSPECTIVE_CHECKPOINT_STATE` value.
3. Pass that value as `retrospectiveCheckpointState` to one of:
   - `evaluatePublicDevLoopRouting(...)`
   - `resolveAuthoritativeStartupResumeBundle(...)`
   - `resolveAuthoritativeDevLoopStatus(...)`
4. Use the returned result directly. When the checkpoint is missing, these helpers fail closed to `needs_reconcile`.

#### Option B — explicit manual gate composition

1. Read `.pi/dev-loop-retrospective-checkpoint.json` (if it exists).
2. Map the file contents to a `RETROSPECTIVE_CHECKPOINT_STATE` value.
3. Call `evaluatePublicDevLoopRouting(...)` to get the proposed routing.
4. Call `evaluateRetrospectiveGate({ checkpointState, proposedRouting })`.
5. Use the gate result (not the raw routing result) as the effective routing decision.

If the gate result is `needs_reconcile`, the caller must not proceed with the proposed routing. The `nextAction` field instructs the operator to complete or explicitly skip the retrospective.

## Durable artifact format

The checkpoint file is written by `.pi/extensions/dev-loop-behavioral-review.ts` when it observes the standard async `dev-loop` completion message. The extension trigger is message-based; qualifying-path policy is enforced by the checkpoint gate and repo contract, not by deep route inspection in the extension itself:

### On observed async dev-loop completion message (written automatically by extension)

```json
{
  "state": "required",
  "triggeredAt": "2026-05-29T16:00:00.000Z"
}
```

### After retrospective is done (written by operator or skill)

```json
{
  "state": "complete",
  "completedAt": "2026-05-29T16:30:00.000Z",
  "notes": "Loop followed working agreement; minor drift on thread resolution."
}
```

### Explicit skip with reason

```json
{
  "state": "skipped",
  "skippedAt": "2026-05-29T16:30:00.000Z",
  "reason": "Trivial documentation-only change; no behavioral review needed."
}
```

## Authoritative source locations

| Artifact | Location |
|---|---|
| Checkpoint state machine | `packages/core/src/loop/retrospective-checkpoint.mjs` (`@pi-dev-loops/core/loop/retrospective-checkpoint`) |
| Tests | `packages/core/test/retrospective-checkpoint.test.mjs` |
| Extension (writes required marker, fires review prompt) | `.pi/extensions/dev-loop-behavioral-review.ts` |
| Checkpoint file | `.pi/dev-loop-retrospective-checkpoint.json` |
| AGENTS.md section | `AGENTS.md` — "Formal dev mode vs required post-run retrospective" |

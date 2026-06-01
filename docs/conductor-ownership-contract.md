# Conductor Ownership Contract

This document defines the **singleton ownership key model**, **local-vs-shared coordination
boundary**, **ownership state taxonomy**, **idempotency outcome taxonomy**, and **reconcile
classification rules** for conductor-managed orchestration scopes.

## Overview

Every conductor-managed orchestration scope must have **at most one effective live owner** at
any point in time. This contract makes that invariant deterministic and testable by:

- defining a normalized ownership key that uniquely identifies a scope
- classifying ownership state from local records and optional authoritative live signals
- routing every action request through one central policy entrypoint rather than scattered
  per-command logic
- making each routing decision verifiable by fixture-driven tests

## Relationship to other issues

| Issue | Relationship |
|---|---|
| [#28 — conductor umbrella](https://github.com/mfittko/pi-dev-loops/issues/28) | Parent umbrella |
| [#27 — ownership bug/example](https://github.com/mfittko/pi-dev-loops/issues/27) | Motivating example |
| [#34 — request/watch helper contract](https://github.com/mfittko/pi-dev-loops/issues/34) | Downstream: consumers of this policy |
| [#26 — remediation choreography](https://github.com/mfittko/pi-dev-loops/issues/26) / `skills/docs/pr-lifecycle-contract.md` | Downstream: uses ownership outcomes |
| [#48 — visible PR projection](https://github.com/mfittko/pi-dev-loops/issues/48) | Downstream: uses ownership outcomes |

## Implementation

| Component | Location |
|---|---|
| Core ownership module | `packages/core/src/loop/conductor-ownership.mjs` |
| Unit tests | `packages/core/test/conductor-ownership.test.mjs` |

---

## Normalized ownership key

The ownership key uniquely identifies a conductor-managed scope. It contains only
**identity-bearing fields**; noise fields are stripped so that two requests for the same
logical scope always produce the same key.

### Identity-bearing fields

| Field | Type | Description |
|---|---|---|
| `repo` | `string` | Fully-qualified repository slug in canonical lowercase `owner/name` format |
| `scopeType` | `"issue" \| "pr" \| "branch" \| "generic"` | Scope category discriminator |
| `scopeId` | `string` | Unique identifier within the scope type (e.g., issue number, PR number, branch name) |

The stable key string is the concatenation: `repo:scopeType:scopeId`
(e.g., `acme/my-repo:issue:42`). Repository slugs are normalized to lowercase so
case-only differences cannot create duplicate singleton keys.

### Excluded non-semantic noise fields

The following fields are accepted as raw input to `normalizeOwnershipKey` but are **never
included in the key** and never affect scope equivalence decisions:

- run identifiers (`runId`, `processId`, etc.)
- timestamps (`createdAt`, `updatedAt`, `recordedAt`, etc.)
- watcher flags
- retry counters, attempt numbers
- any other local implementation identifiers

### Ambiguity handling rules

A key is flagged `isAmbiguous: true` when:

- `scopeId` contains wildcard or glob characters: `*`, `?`, `[`, `]`, `{`, `}`
- `scopeId` is one of the well-known ambiguous placeholders: `"unknown"`, `"any"`

**Any request for an ambiguous key yields `reject_ambiguous_scope`.** The policy never
makes a routing or mutation decision for a scope that cannot be uniquely identified.

---

## Local-vs-shared coordination boundary

### When local-only coordination is sufficient

Local-only coordination (without authoritative consultation) is sufficient when:

- ownership state is `no_record` — no prior state exists; safe to start immediately
- ownership state is `stale_local_record` — superseded records; safe to create a new owner
- ownership state is `watcher_only` — watchers do not block starting a new owner for `start` / `resume`, but they are not sufficient for `request-review` / `assign`

### When authoritative live state must be consulted

Authoritative state **must** be consulted before making routing or mutation decisions when:

- `live_owner` (local-only signal, no authoritative confirmation) — the local record may be
  stale; authoritative state must confirm before committing a mutation
- `recorded_no_live_owner` (no authoritative signal) — cannot safely distinguish "inactive
  and resumable" from "still live but unresponsive" without authoritative confirmation
- `duplicate_local_owners` — conflicting local records cannot be resolved locally
- `watcher_only` for `request-review` / `assign` — watcher presence still requires authoritative confirmation of an active owner

The `requiresAuthoritativeConsultation` field on each outcome explicitly encodes this rule.

### Authoritative state precedence

**Provisional local state never overrides authoritative live/remote state** for final routing
or mutation decisions. Concretely:

- If `authoritativeLiveState.hasLiveOwner === true`, the scope has a live owner **after** duplicate-local-owner ambiguity is ruled out. Duplicate non-terminal local owner records still classify as `duplicate_local_owners` until reconciled.
- If `authoritativeLiveState.hasLiveOwner === false`, the scope has no live owner — even if
  a local `active` record exists. The local record is reclassified as
  `recorded_no_live_owner`.

---

## Ownership state taxonomy

| State | Description |
|---|---|
| `live_owner` | An active live owner exists — confirmed by authoritative signal or a single local `active` record after duplicate-local-owner ambiguity is ruled out |
| `recorded_no_live_owner` | A non-terminal record exists (`active` or `inactive`) but no live owner is confirmed |
| `stale_local_record` | Only `stale`/superseded records exist; no non-terminal owner record |
| `duplicate_local_owners` | Multiple non-terminal non-watcher local records exist for the same scope |
| `watcher_only` | Records exist but all are watchers (`isWatcher: true`); no owning record |
| `no_record` | No records that affect current ownership remain for this scope (for example, empty input or terminal-only owner records) |

### Local record states

Each local record carries one of:

| State | Meaning |
|---|---|
| `active` | Currently believed to be live |
| `inactive` | Was active; believed no longer live but not formally ended — a resume candidate |
| `stale` | Superseded by another run; no longer relevant |
| `terminal` | Explicitly ended (done, failed, or cancelled) |

---

## Idempotency outcome taxonomy

| Outcome | Meaning |
|---|---|
| `start_new` | Safe to create a new owner for this scope |
| `attach_existing_live_owner` | A live owner already exists; attach to it rather than creating a duplicate |
| `resume_recorded_but_not_live_state` | Prior non-terminal state exists and can be resumed; no live owner confirmed |
| `noop_already_satisfied` | The requested action is already satisfied; no ownership change required |
| `reject_duplicate_owner` | Multiple owners exist for this scope; must be resolved before routing |
| `needs_reconcile_before_resume` | State is ambiguous or conflicting; authoritative reconciliation required |
| `reject_ambiguous_scope` | Scope identity is ambiguous; cannot determine a single effective owner |

Each outcome also carries:

- `allowOwnerCreation` (`boolean`) — whether the caller is permitted to create a new owner
- `requiresAuthoritativeConsultation` (`boolean`) — whether the caller must consult
  authoritative live state before committing a routing or mutation decision. Any
  `needs_reconcile_before_resume` outcome sets this to `true`.

---

## Action applicability

### Per-action outcome rules

| Action | No record | Live owner | Recorded (no live) | Stale | Duplicate | Watcher-only |
|---|---|---|---|---|---|---|
| `start` | `start_new` | `attach` | `reconcile`* or `resume` | `start_new` | `reject_dup` | `start_new` |
| `kickoff` | same as `start` | same | same | same | same | same |
| `resume` | `start_new` | `attach` | `reconcile`* or `resume` | `start_new` | `reject_dup` | `start_new` |
| `watch` | `noop`* | `noop`* | `noop`* | `noop`* | `noop`* | `noop`* |
| `request-review` | `reconcile` | `noop` | `reconcile`* or `resume` | `reconcile` | `reject_dup` | `reconcile` |
| `assign` | `reconcile` | `noop` | `reconcile`* or `resume` | `reconcile` | `reject_dup` | `reconcile` |

Legend:
- `attach` = `attach_existing_live_owner`
- `resume` = `resume_recorded_but_not_live_state`
- `reconcile` = `needs_reconcile_before_resume`
- `noop` = `noop_already_satisfied`
- `reject_dup` = `reject_duplicate_owner`
- `*` = `reconcile` when no authoritative signal is available; `resume` when authoritative confirms no live owner
- `noop*` = `noop_already_satisfied` for unambiguous scopes; ambiguous scopes still yield `reject_ambiguous_scope`

### `watch` is non-owning

For unambiguous scopes, `watch` returns `noop_already_satisfied` with
`allowOwnerCreation: false`. Ambiguous scopes are still rejected as
`reject_ambiguous_scope` before the watch fast-path applies. `watch` never creates,
claims, or satisfies conductor ownership. Watcher presence alone is insufficient to
determine that a scope has an active owner.

### `kickoff` is a `start` alias

For this contract, `kickoff` is treated as a `start` alias. The ownership policy is identical.

---

## Reconcile and duplicate-owner classification rules

The evaluator distinguishes between reconcile-needed states and explicit duplicate-owner
rejection:

| Condition | Rule |
|---|---|
| Duplicate local records | Two or more non-terminal non-watcher records for the same scope — return `reject_duplicate_owner` and reconcile to one surviving owner using authoritative state before routing again |
| Stale local records with `request-review`/`assign` | Stale records cannot satisfy actions requiring an active owner |
| Recorded non-terminal without authoritative confirmation | Cannot safely distinguish "inactive resumable" from "still live" without authoritative signal |
| Watcher-only for `request-review`/`assign` | Watcher presence does not satisfy ownership for actions that require an active owner |
| Conflicting local vs authoritative signals | Authoritative wins; local records are reclassified accordingly |

---

## Scenario matrix

Each scenario below defines the input conditions, expected outcome, `allowOwnerCreation`,
and `requiresAuthoritativeConsultation`.

### 1. Repeated `start` against an already-live equivalent scope

| Field | Value |
|---|---|
| Input | `action=start`, `ownershipState=live_owner`, `authoritativeSignal=yes(live)` |
| Expected outcome | `attach_existing_live_owner` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

### 2. `resume` with recorded non-terminal state and no live owner

| Field | Value |
|---|---|
| Input | `action=resume`, `ownershipState=recorded_no_live_owner`, `authoritativeSignal=yes(not-live)` |
| Expected outcome | `resume_recorded_but_not_live_state` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

Without authoritative signal the outcome is `needs_reconcile_before_resume` with
`requiresAuthoritativeConsultation: true`.

### 3. `watch` against an active run owned elsewhere

| Field | Value |
|---|---|
| Input | `action=watch`, any ownership state |
| Expected outcome | `noop_already_satisfied` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

### 4. Duplicate local owner records for one clear scope

| Field | Value |
|---|---|
| Input | Two `active` non-watcher local records, any action except `watch` |
| Expected outcome | `reject_duplicate_owner` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `true` |

### 5. Stale local owner record with no live owner

| Field | Value |
|---|---|
| Input | `action=start`, one `stale` local record |
| Expected outcome | `start_new` |
| allowOwnerCreation | `true` |
| requiresAuthoritativeConsultation | `false` |

For `request-review`/`assign` against a stale record the outcome is
`needs_reconcile_before_resume` with `allowOwnerCreation: false`.

### 6. Ambiguous scope equivalence

| Field | Value |
|---|---|
| Input | `scopeId` contains wildcards or is `"unknown"` / `"any"` |
| Expected outcome | `reject_ambiguous_scope` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

### 7. Conflicting local vs authoritative state

| Field | Value |
|---|---|
| Input | Local record says `active`; authoritative says `hasLiveOwner: false` |
| Ownership state classified as | `recorded_no_live_owner` (authoritative wins) |
| Expected outcome (start) | `resume_recorded_but_not_live_state` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

### 8. `request-review` and `assign` against an already-satisfied scope

| Field | Value |
|---|---|
| Input | `action=request-review` or `action=assign`, `ownershipState=live_owner`, `authoritativeSignal=yes(live)` |
| Expected outcome | `noop_already_satisfied` |
| allowOwnerCreation | `false` |
| requiresAuthoritativeConsultation | `false` |

Without authoritative confirmation, the same local-only `live_owner` state still yields
`noop_already_satisfied`, but `requiresAuthoritativeConsultation: true`.

---

## Non-goals

This contract intentionally does **not** cover:

- the full conductor runtime/daemon lifecycle (see issue #28)
- distributed locking, leases, or production shared-coordination infrastructure
- registry/storage redesign or persistence migration
- request/watch helper routing mechanics (see issue #34)
- review/remediation/re-review choreography, CI wait policy, or merge gating (see `skills/docs/pr-lifecycle-contract.md`)
- PR-visible lifecycle projection, comments, status rendering, or closeout artifacts (see issue #48)
- broad reconcile CLI/tooling beyond classification rules
- backend discovery/transport semantics for authoritative live state

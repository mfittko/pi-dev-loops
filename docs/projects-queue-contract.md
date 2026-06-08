# GitHub Projects Queue Contract

This document defines the minimal board contract for dev-loop queue tooling that reads
and writes GitHub Projects V2 state.

## Purpose

When a dev-loop operator opts into the GitHub Projects queue path, queue helpers read queue
ordering from a project board and write status transitions back. This contract defines the
expected board shape so tooling can rely on deterministic field/column names and fail safely
when the board is absent or misconfigured.

**Board state is an optional scheduling input; it does not replace GitHub issue/PR state as
the source of truth.** This contract introduces no local queue file — the board is the
Projects-based ordering surface described here.

## Opt-in posture

GitHub Projects is **optional**. The dev-loop works without a project board — queue helpers
fall back to positional argument ordering when no board is configured. Setting up a board is
a one-time operator action, not a startup requirement.

Tooling never mutates project/field structure without explicit operator invocation of the
bootstrap wrapper (`ensure-queue-board.mjs`). Runtime queue operations only read/write item
position and Status field values.

## Board identification

### Owner and project

A board is identified by its owning entity (user or organization) and project title.

Tooling resolves the owner from the repository slug (`--repo <owner/name>`) and looks up the
project by title among that owner's Projects V2 instances.

| Field | Source | Example |
|---|---|---|
| Owner | First component of repo slug | `mfittko` |
| Project title | Configurable, defaults to `"Dev Loop Queue"` | `"Dev Loop Queue"` |
| Project number | Assigned by GitHub on creation | `1` |

The owner can be a user or an organization. Tooling resolves both via the GraphQL API.

### Discovery

Tooling uses the following GraphQL query pattern for paginated project listing:

```graphql
query($login:String!, $after:String) {
  user(login:$login) {           # or organization(login:$login)
    projectsV2(first:50, after:$after) {
      pageInfo { hasNextPage, endCursor }
      nodes { id, number, title, url }
    }
  }
}
```

Project lookup is by **exact title match** against the configured title. If no project with
the configured title exists, tooling fails closed — it does not create a project silently.

## Required fields

At minimum, the board must have a **Status** field of type `single-select`. This is the only
required field; all queue-state read/write operations key off Status.

### Querying the Status field

```graphql
query($projectId:ID!, $after:String) {
  node(id:$projectId) {
    ... on ProjectV2 {
      fields(first:50, after:$after) {
        pageInfo { hasNextPage, endCursor }
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id, name }
          }
        }
      }
    }
  }
}
```

Tooling identifies the Status field by name (`"Status"`) and reads its option IDs.
Field ID and option IDs are used in subsequent mutations to set Status on items.

## Conventional columns

The Status field must contain these four columns. Tooling keys off the option **names**:

| Column | Meaning |
|---|---|
| **Backlog** | Not yet scheduled. Default Status for newly added items. |
| **Next Up** | Next item(s) the queue should pick up. Ordered by POSITION within this column. |
| **In Progress** | Currently running through the dev-loop. |
| **Done** | Completed (merged or explicitly closed). |

Columns are case-sensitive exact matches. `"backlog"`, `"BACKLOG"`, or `"Backlog "` do not
match.

The bootstrap wrapper creates these four columns automatically. Operators may add additional
Status options but **must not remove or rename** the four conventional columns — tooling
fails closed when expected columns are missing.

## Queue ordering

Queue ordering is read from GitHub Projects V2 item **POSITION** within a Status-filtered
view.

### How ordering works

1. Tooling queries items for a specific Status column:

```graphql
query($projectId:ID!, $statusFieldId:ID!, $statusOptionId:ID!, $after:String) {
  node(id:$projectId) {
    ... on ProjectV2 {
      items(
        first:50, after:$after,
        orderBy: { field: POSITION, direction: ASC },
        filterBy: { fieldValues: [{ fieldId: $statusFieldId, optionId: $statusOptionId }] }
      ) {
        pageInfo { hasNextPage, endCursor }
        nodes {
          id
          fieldValues(first:10) {
            nodes {
              ... on ProjectV2ItemFieldTextValue { text }
            }
          }
          content {
            ... on Issue { number, title, url, state }
            ... on PullRequest { number, title, url, state }
          }
        }
      }
    }
  }
}
```

2. Items are returned in POSITION order (ascending), determined by the board's manual drag-drop
   or `updateProjectV2ItemPosition` API.

3. The operator reorders items by dragging within the GitHub Projects board UI or via the
   `reorder` helper. Tooling reads the resulting POSITION deterministically — it does not
   enforce its own ordering.

### Position semantics

- POSITION is a float maintained by GitHub. Items can be inserted between any two items.
- Ordering is **column-scoped**: the POSITION of an item in "Next Up" is independent of its
  position in "Backlog".
- A filtered query (`filterBy: { fieldValues: ... }`) returns only items in that column,
  ordered by POSITION.
- When the `--limit N` flag is used, tooling takes the first N items from the ordered result.

## Fail-closed behavior

Tooling never silently assumes board state is correct. Every operation that depends on the
board validates preconditions first:

| Situation | Behavior | Exit code |
|---|---|---|
| No board configured (not opted in) | Fall back to positional ordering; no board mutations | N/A (normal) |
| Board not found by title | Operation fails; no fallback to creation | 2 |
| Board exists but Status field missing | Operation fails; manual reconciliation needed | 3 |
| Board exists but Status field missing expected column | Operation fails; manual reconciliation needed | 3 |
| GitHub API returns error | Operation fails; queue continues with next item | 2 |
| Item not found on board (move/add operation) | Operation fails; no silent creation | 2 |

### Idempotent bootstrap exception

The `ensure-queue-board.mjs` bootstrap wrapper has relaxed fail-closed behavior: it
**creates** a missing project and/or Status field with conventional columns. This is the only
tool allowed to mutate project structure. Runtime queue helpers (list, move, add, reorder)
never create or modify project/field structure.

### Error reporting

When tooling fails closed, it emits a structured JSON error on stderr:

```json
{
  "ok": false,
  "error": "Project 'Dev Loop Queue' not found for owner 'mfittko'."
}
```

The example hints at a remediation command. The stderr payload follows the
repo's standard CLI error format (`formatCliError`): the payload carries `{ ok: false, error }`
and may include an optional `usage` field when available. The `code` and `remediation`
keys shown in the example are illustrative documentation, not part of the structured stderr output.

## Configuration shape

Queue board configuration lives under `.pi/dev-loop/settings.yaml`. All keys are optional;
the queue path works without a board.

```yaml
queue:
  # Maximum parallel entries the queue may process concurrently.
  maxParallel: 3

  # Maximum bug issues the queue driver may auto-file in one run.
  maxAutoFiledIssues: 10

  # Maximum retry attempts per entry for recoverable failures.
  reDispatchMaxRetries: 1

  # Board title for Projects V2 lookup. Defaults to "Dev Loop Queue".
  # Omit or leave unset to not use Projects-based queue ordering.
  boardTitle: "Dev Loop Queue"
```

### Board title key

The `queue.boardTitle` key is the sole opt-in signal for Projects-based queue ordering:

| Value | Meaning |
|---|---|
| Not set (key missing) | Projects path not active; use positional ordering |
| `"Dev Loop Queue"` (default) | Look up project by this title under the repo owner |
| Any other string | Look up project by that exact title |

If `boardTitle` is set but the project does not exist, queue operations that depend on board
ordering fail closed — they do not treat the missing board as equivalent to "not opted in."

### Settings precedence

1. `.pi/dev-loop/defaults.yaml` — shipped defaults (does not set `boardTitle`)
2. `.pi/dev-loop/settings.yaml` — operator overrides (may set `boardTitle`)

Project number and URL are discoverable at runtime via the GraphQL API — no explicit config
entry is required.

## Required GraphQL operations

Helpers consume these minimal GraphQL operations:

| Operation | Purpose | Used by |
|---|---|---|
| `projectsV2` query (user/org) | List projects by owner, find by title | bootstrap, list, move, add, reorder |
| `createProjectV2` mutation | Create project board | bootstrap only |
| `createProjectV2Field` mutation | Create Status field with columns | bootstrap only |
| `fields` query (with `ProjectV2SingleSelectField`) | Read Status field + options | bootstrap, list, move, add |
| `items` query (with `orderBy` + `filterBy`) | List items in a column by POSITION | list, reorder |
| `updateProjectV2ItemFieldValue` mutation | Set Status on an item (move between columns) | move |
| `addProjectV2ItemById` mutation | Add an existing issue/PR to the project | add |
| `updateProjectV2ItemPosition` mutation | Reorder an item within/between columns | reorder |

## Non-goals

This contract explicitly does **not** define:

- **Full Kanban automation** — GitHub has built-in workflows for Status transitions. The
  queue helpers only read ordering and set Status; they do not react to Status changes.
- **Local persistence replacement** — Board state is an optional scheduling input. This
  contract introduces no new local queue file; it complements existing queue mode persistence.
- **Bi-directional sync** — Tooling reads board ordering at dispatch time and writes Status
  on transitions. It does not continuously sync local state to board state or vice versa.
- **Framework/library abstraction** — All helpers are thin wrappers around `gh api graphql`.
  No additional GraphQL client or abstraction layer is introduced.

## Relationship to queue mode

The [Queue Mode SPEC](./specs/queue-mode/SPEC.md) and [Queue Board Setup](./queue-board-setup.md)
describe a queue-mode implementation that uses `.pi/dev-loop-queue.json` for durable entry
lifecycle tracking. This contract adds an **optional** Projects-board scheduling input on top
of that existing queue infrastructure — it does not replace local queue persistence and does
not introduce a second local queue file. When the board is not configured, queue ordering falls
back to positional arguments as described in the queue mode specification.

## See also

- [Queue Board Setup](./queue-board-setup.md) — one-time setup guide
- [Queue Mode SPEC](./specs/queue-mode/SPEC.md) — full queue mode specification
- Issue [#625](https://github.com/mfittko/pi-dev-loops/issues/625) — parent epic
- Issue [#626](https://github.com/mfittko/pi-dev-loops/issues/626) — this contract refinement

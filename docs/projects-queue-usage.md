# Opt-in GitHub Projects queue workflow

This document is the practical operator's guide for using GitHub Projects V2 as an optional
scheduling view for `dev-loop` queue work. For the formal board contract, see
[Projects Queue Contract](./projects-queue-contract.md). For one-time setup, see
[Queue Board Setup](./queue-board-setup.md).

## Why board state is OK for outer queue ordering

The dev-loop uses GitHub Projects V2 board **position** as a human-readable scheduling hint —
not as a database or transactional state store.

- **Board state is durable** — survives CI restarts, local machine wipes, and session boundaries
- **Board state is visible** — operators inspect and reorder the queue from the GitHub UI
- **Board state is optional** — queue helpers treat it as an optional scheduling input, not mandatory authority. Without the board, `dev-loop queue` falls back to positional argument ordering.
- **No local queue file duplication** — the board complements `.pi/dev-loop-queue.json` for entry lifecycle tracking; it does not replace it and does not introduce a second local file

This means board position is a **good-enough** signal for ordering the outer queue. The board
does not need to be transactionally consistent with local state for the queue to work correctly:
if the board is absent, the queue falls back; if a board operation fails, the queue continues
with the next item.

## How to opt in

Set `queue.boardTitle` in `.pi/dev-loop/settings.yaml`:

```yaml
queue:
  # Opt into Projects-based queue ordering
  boardTitle: "Dev Loop Queue"
```

Without this key, the Projects path is inactive and the queue uses positional argument
ordering.

Then bootstrap the board (one-time):

```sh
node scripts/projects/ensure-queue-board.mjs --repo <owner/name>
```

## How to use the helpers

All helpers are thin wrappers around `gh api graphql`. They emit machine-readable JSON on
stdout and structured errors on stderr. All accept `--help` for usage.

### List queue items

```sh
# List all items in a project
node scripts/projects/list-queue-items.mjs --repo mfittko/pi-dev-loops --project 1

# List only items in "Next Up" column
node scripts/projects/list-queue-items.mjs --repo mfittko/pi-dev-loops --project 1 --column "Next Up"

# Limit to top 5 items
node scripts/projects/list-queue-items.mjs --repo mfittko/pi-dev-loops --project 1 --limit 5
```

### Add an item to the queue

```sh
# Add issue #42 to the Backlog column (default)
node scripts/projects/add-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item 42

# Add issue #42 to a specific column
node scripts/projects/add-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item 42 --status "Next Up"
```

### Move an item between columns

```sh
# Move issue #42 from its current column to In Progress
node scripts/projects/move-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item 42 --to-column "In Progress"

# Move a project item by its node ID
node scripts/projects/move-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item "PVTI_..." --to-column "Done"
```

### Reorder items

```sh
# Move issue #42 to the top of the column
node scripts/projects/reorder-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item 42

# Move issue #42 after issue #17
node scripts/projects/reorder-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item 42 --after 17

# Reorder by project item node IDs
node scripts/projects/reorder-queue-item.mjs --repo mfittko/pi-dev-loops --project 1 --item "PVTI_abc" --after "PVTI_xyz"
```

### Typical workflow

1. Bootstrap the board once: `node scripts/projects/ensure-queue-board.mjs --repo <owner/name>`
2. Add items as they are queued: `node scripts/projects/add-queue-item.mjs --repo ... --project 1 --item <n>`
3. Reorder by priority: drag in the GitHub UI, or use `reorder-queue-item.mjs`
4. When a worker picks up an item: `node scripts/projects/move-queue-item.mjs ... --to-column "In Progress"`
5. When done: `node scripts/projects/move-queue-item.mjs ... --to-column "Done"`
6. Inspect the queue at any time: `node scripts/projects/list-queue-items.mjs ...`

## Fail-closed behavior

Every helper validates preconditions before mutating board state. No helper silently assumes
the board is in a correct state.

| Situation | Behavior |
|---|---|
| No board configured (`boardTitle` not set) | Fall back to positional ordering; no board mutations attempted |
| Board not found by title | Operation fails; no fallback to creation |
| Board exists but Status field missing | Operation fails; manual reconciliation needed |
| Board exists but expected Status column missing | Operation fails; manual reconciliation needed |
| GitHub API returns an error | Operation fails; structured stderr JSON with error details |
| Item not found on board (move/reorder) | Operation fails; no silent creation |
| Self-referential reorder (`--after` same as `--item`) | Operation fails with clear error message |

### Error format

On failure, helpers emit structured JSON on stderr:

```json
{"ok": false, "error": "Item #999 not found in project for repo \"owner/name\""}
```

Exit codes:
- `1` — usage or argument error
- `2` — GitHub API error
- `3` — project, field, column, or item not found

### Idempotent bootstrap exception

The `ensure-queue-board.mjs` bootstrap wrapper is the only helper allowed to **create**
project structure. It safely re-runs: if the board and Status field already exist, it exits
clean with the existing project details. Runtime helpers (list, move, add, reorder) never
create or modify project/field structure.

## How dev-loop should treat board state

Dev-loop queue drivers treat board state as **optional scheduling input**, not as
mandatory authority:

- When the board is configured and reachable: queue ordering is read from board position,
  with the configured `--limit` cap
- When the board is configured but unreachable (API error): the queue continues with the
  next item; no board mutations are attempted
- When the board is not configured: the queue falls back to positional argument ordering
- Board state is read at dispatch time; the queue does not continuously sync local state
  to board state

This posture keeps the queue resilient: a transient GitHub API outage or misconfigured
board does not block the entire queue run.

## See also

- [Projects Queue Contract](./projects-queue-contract.md) — formal board contract
- [Queue Board Setup](./queue-board-setup.md) — one-time setup guide
- Issue [#625](https://github.com/mfittko/pi-dev-loops/issues/625) — parent epic
- Issue [#626](https://github.com/mfittko/pi-dev-loops/issues/626) — queue contract
- Issue [#627](https://github.com/mfittko/pi-dev-loops/issues/627) — list helper
- Issue [#628](https://github.com/mfittko/pi-dev-loops/issues/628) — move helper
- Issue [#629](https://github.com/mfittko/pi-dev-loops/issues/629) — add helper
- Issue [#630](https://github.com/mfittko/pi-dev-loops/issues/630) — reorder helper
- Issue [#631](https://github.com/mfittko/pi-dev-loops/issues/631) — this doc
- Issue [#632](https://github.com/mfittko/pi-dev-loops/issues/632) — board bootstrap

# Entrypoint briefing: Tracker-first

**Strategy:** `tracker_first` (reserved for future `dev-loop` routing when tracker context detected)

**Purpose:** Tracker-first workflow for story/epic tracker items that follow a PR-based GitHub execution path.

**Routing status:** Routing integration in `resolve-dev-loop-startup.mjs` is deferred (no `tracker_first` route exists yet). This briefing documents the intended contract surface; the state machine and detector are implemented and tested.

**Key artifacts:**
- Tracker issue (canonical spec)
- [Tracker-First Loop State](tracker-first-loop-state.md) — state machine doc
- `detect-tracker-first-loop-state.mjs` — loop state detector
- `detect-tracker-pr-state.mjs` — PR-level state detector

**Routing:** `dev-loop` will resolve to tracker-first when a tracker context is detected (issue has tracker labels, is a tracker-backed issue). Fail-closed: unknown tracker state → `needs_triage`.

**State vocabulary:** `drafting`, `needs_triage`, `in_progress`, `in_review`, `merge_ready`, `blocked`, `completed`, `unknown`

**Interface contract:** Same as Copilot loop: `{ ok, state, snapshot, allowedTransitions, nextAction }`

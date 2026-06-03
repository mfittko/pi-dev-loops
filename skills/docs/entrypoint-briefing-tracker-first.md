# Entrypoint briefing: Tracker-first

**Strategy:** `tracker_first` (routed from `dev-loop` when tracker context detected)

**Purpose:** Tracker-first workflow for story/epic tracker items that follow a PR-based GitHub execution path.

**Key artifacts:**
- Tracker issue (canonical spec)
- [Tracker-First Loop State](tracker-first-loop-state.md) — state machine doc
- `detect-tracker-first-loop-state.mjs` — loop state detector
- `detect-tracker-pr-state.mjs` — PR-level state detector

**Routing:** `dev-loop` resolves to tracker-first when a tracker context is detected (issue has tracker labels, is a tracker-backed issue). Fail-closed: unknown tracker state → `needs_triage`.

**State vocabulary:** `drafting`, `needs_triage`, `in_progress`, `in_review`, `merge_ready`, `blocked`, `completed`, `unknown`

**Interface contract:** Same as Copilot loop: `{ ok, state, snapshot, allowedTransitions, nextAction }`

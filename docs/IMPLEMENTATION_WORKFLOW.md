# Implementation workflow

This repository uses a docs-first local dev-loop convention.

## Layers of truth

### 1. `PLAN.md`
Use for durable product, architecture, and roadmap truth across phases.

### 2. `docs/phases/phase-<n>.md`
Use for the durable plan for one phase:
- why the phase exists now
- in-scope work
- explicit non-goals
- acceptance criteria
- validation approach
- durable decisions and open questions

A fresh human or agent should be able to read the active phase doc first and understand the current intent without replaying tmp artifacts.

### 3. `tmp/phases/phase-<n>/`
Use for temporary local execution artifacts and audit trails:
- planning variants
- merged plan drafts
- review notes
- retrospectives
- subagent summaries
- deterministic logs such as `bash-exit-1.jsonl`

These files are normally local-only and do not need to be committed to git.

## Default operating mode

- one phase at a time
- refine the active phase before coding it
- keep durable decisions in docs and execution traces in `tmp/`
- use fan-out / fan-in / review before implementation
- write tests first for non-trivial changes
- validate locally before closing a phase
- prefer dedicated local branches over direct work on `main`
- treat phase closure as including review/fix, commit history capture, and merge back to local `main` when authorized

## Phase completion semantics

Use these terms consistently:

- `in-progress` / `planning` = the phase is still being refined or executed
- `awaiting-finalization` = scoped work, required support files, artifacts, and validation are done, but commit and/or merge steps are still pending authorization or execution
- `completed` = the phase is fully finalized, including commit history capture and merge back to local `main`

For bootstrap/setup phases, do not use `awaiting-finalization` or `completed` until the expected durable support files for the workflow contract exist in the repository. Temporary `tmp/` artifacts do not need to be committed.

Do not mark a phase `completed` if the only thing left is “commit later” or “merge later.” In that case, mark it `awaiting-finalization` and record the missing step explicitly.

## Bootstrap expectation

The dev-loop skill should create or maintain:
- `AGENTS.md`
- `docs/IMPLEMENTATION_STATE.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `docs/phases/phase-<n>.md`
- `tmp/phases/index.json`
- `tmp/phases/phase-<n>/...`

## Convention goal

This split is intentional:
- docs are for durable human-and-agent understanding
- tmp is for resumable execution detail and machine-friendly artifacts

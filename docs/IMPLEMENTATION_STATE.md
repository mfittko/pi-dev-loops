# Implementation state

## Status

Phase 0 is complete. The docs-first workflow convention and initial support-package boundary are established.

## Current source of truth

- Product plan: `PLAN.md`
- Durable phase plans: `docs/phases/phase-<n>.md`
- Execution skill: `skills/dev-loop/SKILL.md`
- Repo contract: `AGENTS.md`
- Workflow explainer: `docs/IMPLEMENTATION_WORKFLOW.md`
- tmp index for fresh-context inspection: `tmp/phases/index.json`

## Current phase

- Most recently completed phase: `phase-0`
- Durable phase plan: `docs/phases/phase-0.md`
- Status: completed

## Next action for a fresh session

If the user says **"start implementation"** or **"continue implementation"**:

1. read `PLAN.md`
2. load/read the `dev-loop` skill
3. read `AGENTS.md`
4. read `docs/IMPLEMENTATION_WORKFLOW.md`
5. read this file
6. read `docs/phases/phase-1.md`
7. inspect `tmp/phases/index.json` and `tmp/phases/phase-0/` for prior phase context
8. refine Phase 1 only before starting any Phase 1 implementation

## Next unfinished phase

Phase 1 — normalize the imported assets without changing intent.

## Phase queue

- `phase-0` — complete
- `phase-1` — next; placeholder exists at `docs/phases/phase-1.md` and should be refined before implementation starts

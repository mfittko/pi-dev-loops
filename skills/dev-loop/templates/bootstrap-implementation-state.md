# Implementation state

## Status

Preparation is in place. Implementation has not started.

## Current source of truth

- Product plan: `PLAN.md`
- Durable phase plans: `docs/phases/phase-<n>.md`
- Execution skill: `dev-loop`
- Repo contract: `AGENTS.md`
- Workflow explainer: `docs/IMPLEMENTATION_WORKFLOW.md`
- tmp index for fresh-context inspection: `tmp/phases/index.json`

## Next action for a fresh session

If the user says **"start implementation"**:

1. read `PLAN.md`
2. load the `dev-loop` skill
3. read `AGENTS.md` if it exists
4. read `AGENTS.md`
5. read `docs/IMPLEMENTATION_WORKFLOW.md`
6. read the current durable phase plan under `docs/phases/` if it exists
7. read this file
8. start with the next unfinished phase only

## Next unfinished phase

Phase 0 — define the workflow convention, durable phase-plan format, and initial package boundary.

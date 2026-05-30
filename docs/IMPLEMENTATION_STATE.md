# Implementation state

## Status

Phase 1 imported-asset normalization is complete, locally validated, committed, and merged. Phase 2 dedicated refiner-agent work is complete, locally validated, committed, and merged. Phase 3 package extension and setup UX work is complete, locally validated, committed, and merged. Phase 4 shared deterministic library and npm support package work is complete, locally validated, committed, and merged. Phase 5 deterministic scripts work is complete, locally validated, committed, and merged. Phase 6 public release hardening is complete, merged, and synced back to local `main`. Phase 7 second-repo pilot refinement remains the next durable roadmap phase and is still in planning.

Separately, issue #70 tracks a bounded workflow-remediation preparation chain. Those chunks harden the current workflow foundation before later improvements continue. They do **not** replace Phase 7 or the existing roadmap.

Current `main` also includes the current conductor-adjacent ownership/routing contracts plus the inspection and steering surfaces. The next durable repo-level execution phase is still the bounded Phase 7 pilot rather than a new architecture expansion.

## Current source of truth

- Backlog and remote execution trail: GitHub issues and PRs
- Product/repo roadmap: `PLAN.md`
- Repo contract: `AGENTS.md`
- Workflow explainer: `docs/IMPLEMENTATION_WORKFLOW.md`
- Durable local phase plan: `docs/phases/phase-7.md`
- tmp index for fresh-context inspection if present locally: `tmp/phases/index.json`

## Supporting context

- Workflow-remediation findings memo for issue #70: `docs/workflow-remediation-prep.md`

## Current phase

- Active phase: `phase-7`
- Durable phase plan: `docs/phases/phase-7.md`
- Status: `planning`

## Next action for a fresh session

If the user says **"continue implementation"**:

1. read `README.md`
2. read `PLAN.md`
3. read `AGENTS.md`
4. read `docs/IMPLEMENTATION_WORKFLOW.md`
5. read this file
6. read `docs/phases/phase-7.md`
7. start from the public `dev-loop` entrypoint and let routing choose the right internal path
8. inspect `tmp/phases/index.json` and any useful prior artifacts only if prior context helps
9. if durable repo truth changed during the work, sync `README.md`, `PLAN.md`, `docs/IMPLEMENTATION_STATE.md`, and any affected contract docs before closing the slice
10. if the request is about workflow-remediation preparation, read `docs/workflow-remediation-prep.md` and work the next bounded #70 chunk without widening scope
11. for Phase 7 specifically, clarify the target repository and pilot path if they are still unset before implementation starts

## Next unfinished phase

Phase 7 — second-repo pilot.

## Phase summary

- Completed: `phase-0` through `phase-6`
- Active: `phase-7` (`planning`)
- Later phases remain intentionally undescribed here until Phase 7 is settled

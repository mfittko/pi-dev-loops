# Implementation state

## Status

Phase 1 imported-asset normalization is complete, locally validated, committed, and merged. Phase 2 dedicated refiner-agent work is complete, locally validated, committed, and merged. Phase 3 package extension and setup UX work is complete, locally validated, committed, and merged. Phase 4 shared deterministic library and npm support package work is complete, locally validated, committed, and merged. Phase 5 deterministic scripts work is complete, locally validated, committed, and merged. Phase 6 public release hardening is complete, merged, and synced back to local `main`. Phase 7 second-repo pilot refinement shipped ahead of schedule (the code landed before the formal Phase 7 doc was started). Phase 8 (current) is the post-pilot stabilization and cleanup pass.

Separately, issue #70 tracks a bounded workflow-remediation preparation chain. Those chunks harden the current workflow foundation before later improvements continue. They do **not** replace Phase 7 or the existing roadmap.

Current `main` also includes the current conductor-adjacent ownership/routing contracts plus the inspection and steering surfaces. The next durable repo-level execution phase is still the bounded Phase 7 pilot rather than a new architecture expansion.

## Current source of truth

- Backlog and remote execution trail: GitHub issues and PRs
- Product/repo roadmap: [Project Plan](PLAN.md)
- Repo contract: [Agent Instructions](AGENTS.md)
- Workflow explainer: [Implementation Workflow](docs/IMPLEMENTATION_WORKFLOW.md)
- Durable local phase plan: [Phase 7 Plan](docs/phases/phase-7.md)
- tmp index for fresh-context inspection if present locally: `tmp/phases/index.json`

## Supporting context

- Workflow-remediation findings memo for issue #70: [Workflow Remediation Prep](docs/archive/workflow-remediation-prep.md)

## Current phase

- Active phase: `phase-7`
- Durable phase plan: [Phase 7 Plan](docs/phases/phase-7.md)
- Status: `planning`

## Next action for a fresh session

If the user says **"continue implementation"**:

1. read [README](README.md)
2. read [Project Plan](PLAN.md)
3. read [Agent Instructions](AGENTS.md)
4. read [Implementation Workflow](docs/IMPLEMENTATION_WORKFLOW.md)
5. read this file
6. read [Phase 7 Plan](docs/phases/phase-7.md)
7. start from the public `dev-loop` entrypoint and let routing choose the right internal path
8. inspect `tmp/phases/index.json` and any useful prior artifacts only if prior context helps
9. if durable repo truth changed during the work, sync [README](README.md), [Project Plan](PLAN.md), [Implementation State](docs/IMPLEMENTATION_STATE.md), and any affected contract docs before closing the slice
10. if the request is about workflow-remediation preparation, read [Workflow Remediation Prep](docs/archive/workflow-remediation-prep.md) and work the next bounded #70 chunk without widening scope
11. for Phase 7 specifically, clarify the target repository and pilot path if they are still unset before implementation starts

## Next unfinished phase

Phase 7 — second-repo pilot.

## Phase summary

- Completed: `phase-0` through `phase-6`
- Active: `phase-7` (`planning`)
- Later phases remain intentionally undescribed here until Phase 7 is settled

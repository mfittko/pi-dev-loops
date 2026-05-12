# phase-0 durable plan

## Status

Completed

## Objective

Define the initial workflow convention for this repository and tighten the package boundary before broader implementation continues.

## Why this phase exists now

This repository is building reusable Pi development loops, not just consuming them. Before extracting more helpers or adding workflow mechanics, we need a clear convention for where durable phase intent lives, where execution traces live, and how shared deterministic logic should be packaged.

## In scope

- adopt a docs-first phase convention where `docs/phases/phase-<n>.md` is the durable plan for each phase
- keep `PLAN.md` as the strategic cross-phase roadmap
- keep `tmp/phases/phase-<n>/` for execution artifacts and machine-friendly logs
- update the local `dev-loop` skill and helper scaffolding to reflect that convention
- define the initial boundary for a shared npm support package usable by Pi skills, repo-local scripts, and GitHub Actions
- identify the first deterministic helpers that should move into the shared package

## Explicit non-goals

- fully implementing all later roadmap phases
- extracting all shared helpers in Phase 0
- finalizing every agent prompt or every GitHub/Copilot workflow detail
- polishing package distribution or second-repo adoption yet

## Acceptance criteria

- the workflow convention is explicit in repo docs
- the active phase has a durable phase doc under `docs/phases/`
- the `dev-loop` skill reflects the docs-first phase convention
- deterministic phase scaffolding can create both the durable phase doc and tmp planning artifacts
- Phase 0 clearly states what belongs in the shared support package versus Pi-specific orchestration
- the first extraction targets are named and justified

## Definition of done

Phase 0 is complete when all of the following are true:

- `PLAN.md` and `docs/IMPLEMENTATION_WORKFLOW.md` both describe the docs-first phase convention consistently
- `docs/IMPLEMENTATION_STATE.md` points a fresh session at `docs/phases/phase-0.md` as the active durable phase plan
- `docs/phases/phase-0.md` clearly states scope, non-goals, acceptance criteria, and open questions for the phase
- `skills/dev-loop/SKILL.md` treats `docs/phases/phase-<n>.md` as a first-class durable artifact
- the phase scaffold helper can generate `docs/phases/phase-<n>.md` plus the expected tmp artifacts in a temp repo smoke test
- the expected bootstrap support files for this workflow contract exist in the repository, including `AGENTS.md`, `docs/IMPLEMENTATION_STATE.md`, `docs/IMPLEMENTATION_WORKFLOW.md`, the active `docs/phases/phase-0.md`, and `tmp/phases/index.json`
- no additional broad helper extraction work is required to claim the workflow convention is established
- the phase has passed the required review/fix and validation steps
- the resulting branch state has been committed and merged back to local `main`, or the phase is explicitly marked `awaiting-finalization` pending authorization for that last step

## Deliverables

- `AGENTS.md`
- durable workflow docs under `docs/`
- a durable Phase 0 doc under `docs/phases/`
- aligned `dev-loop` skill instructions and templates
- aligned deterministic phase scaffold helpers
- Phase 0 tmp planning artifacts showing the chosen direction and review
## Validation approach

- inspect the updated docs and skill for consistency
- verify deterministic scaffolding can create/update the durable phase doc and tmp artifacts
- run the tests or smoke checks available for any changed deterministic helpers
- explicitly check that Phase 0 has not drifted into Phase 1 normalization work

## Durable decisions

- `PLAN.md` remains the cross-phase roadmap and product-truth document
- `docs/phases/phase-<n>.md` is the durable per-phase plan
- `tmp/phases/phase-<n>/` remains the execution-artifact surface
- shared deterministic logic should move toward a package-first support layer

## Shared support-package boundary

The initial package boundary is:

### Put in the shared npm support package
- deterministic helpers that can run without Pi session context
- file/path/manifest helpers
- artifact formatting and mutation helpers
- pure workflow/state logic that can be unit tested directly
- reusable CLI entrypoints and JS APIs for skill scripts, repo-local scripts, and GitHub Actions

### Keep in Pi-facing skills and docs
- read order and execution policy
- phase transitions and stop conditions
- confirmation and user-interaction rules
- subagent orchestration
- repo-specific workflow guidance and human-facing summaries

### Initial seed already established
- `packages/core/` now hosts the first extracted deterministic helper pattern
- skill-local wrappers can remain in place while shared logic migrates gradually

## Open questions

- how much of the existing dev-loop helper surface should move into `packages/core` during the next phase
- whether phase-doc generation should eventually be centralized in the shared support package rather than remaining skill-local first
- what the cleanest workspace/test contract is for skill-local Jest helpers versus package-level Node tests

## Candidate next-phase extraction targets

These are intentionally candidates for the next phase, not required Phase 0 deliverables:

- `skills/dev-loop/scripts/phase-files.mjs`
- `skills/dev-loop/scripts/init-phase.mjs`
- `skills/dev-loop/scripts/render-template.mjs`
- any shared path/manifest utilities needed by both skills and future GitHub automation

## Phase boundary to phase-1

Phase 0 ends once the workflow convention is established and the current repo can scaffold durable phase docs plus tmp artifacts consistently.

Phase 1 begins when we start normalizing imported assets without changing intent, including:
- classifying repo-specific assumptions asset by asset
- cleaning up imported wording and path assumptions
- deciding which deterministic helpers should actually move into `packages/core`

Until Phase 0 is closed, treat those items as future work only.

## Operational closure status

Phase 0 has been finalized in git. The branch state has been committed and merged back to local `main`, so this phase is now `completed`.

## Links to execution artifacts

- `tmp/phases/phase-0/`

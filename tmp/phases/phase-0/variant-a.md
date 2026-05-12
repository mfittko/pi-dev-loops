# Phase phase-0 variant a

## Intent

Smallest safe workflow refinement.

## Phase scope

- add durable phase docs under `docs/phases/`
- update workflow docs and implementation state
- update the `dev-loop` skill to read and maintain phase docs
- avoid broader implementation beyond the first shared-package seed already added

## Files/modules touched

- `PLAN.md`
- `docs/IMPLEMENTATION_STATE.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `docs/phases/phase-0.md`
- `skills/dev-loop/SKILL.md`
- supporting templates/scripts only where needed for scaffolding alignment

## Tests to add first

- smoke test the phase scaffold helpers on a temp repo

## Implementation order

1. define the convention in docs
2. update the skill
3. align templates/scripts
4. smoke test deterministic scaffolding

## Acceptance criteria

- docs-first phase convention is explicit
- `dev-loop` reads/maintains `docs/phases/phase-<n>.md`
- current repo has a real `docs/phases/phase-0.md`

## Risks / non-goals

- does not fully migrate every helper into `packages/core`
- does not complete later phases

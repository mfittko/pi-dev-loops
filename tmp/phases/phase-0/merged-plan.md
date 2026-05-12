# Phase phase-0 merged plan

## Selected direction

Use a docs-first local dev-loop convention:
- `PLAN.md` for strategic roadmap truth
- `docs/phases/phase-<n>.md` for durable per-phase planning
- `tmp/phases/phase-<n>/` for execution artifacts

## Exact scope

- create durable workflow docs for the new convention
- create `docs/phases/phase-0.md`
- update `dev-loop` instructions to treat phase docs as first-class durable artifacts
- align the deterministic phase scaffold so it can create the durable phase doc as well as tmp artifacts
- stop after workflow refinement and scaffold alignment

## Explicit non-goals

- broad new feature implementation
- wholesale helper extraction into `packages/core`
- second-repo testing
- agent generalization work beyond what this workflow clarification directly requires

## Tests to write first

- helper smoke tests for phase scaffolding in a temp repo

## Implementation order

1. write workflow docs
2. write Phase 0 durable plan
3. update skill and templates
4. update/init smoke-tested scaffold helpers
5. stop and reassess before deeper implementation

## Validation steps

- YAML/frontmatter parse still succeeds for skills
- smoke test `init-phase` in a temp repo
- run available package-level tests for changed shared helpers where applicable

## Acceptance criteria

- docs-first convention is explicit in repo docs and skill text
- a durable phase doc exists for Phase 0
- tmp planning artifacts exist for Phase 0
- scaffolding can generate the durable phase doc in new repos
- the shared-package boundary is stated clearly enough to defer further extraction work to the next phase
- Phase 0 remains planning/refinement-first rather than drifting into normalization or implementation work
## Risks / watchpoints

- avoid letting Phase 0 drift into broad implementation
- avoid conflicting durable/docs and tmp representations of the same phase intent
- avoid quietly doing Phase 1 normalization work under a Phase 0 label
- avoid treating candidate extraction targets as mandatory Phase 0 deliverables
- if a Phase 1 placeholder exists, keep it intentionally provisional rather than fully refined

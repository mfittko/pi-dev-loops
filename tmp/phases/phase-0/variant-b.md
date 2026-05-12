# Phase phase-0 variant b

## Intent

Best practical workflow reset with deterministic support alignment.

## Phase scope

- everything in variant A
- add a reusable phase-doc template
- make `init-phase` aware of `docs/phases/phase-<n>.md`
- record the shared-package boundary as a durable phase decision

## Files/modules touched

- variant A files
- `skills/dev-loop/templates/phase-doc.md`
- `skills/dev-loop/scripts/init-phase.mjs`
- `skills/dev-loop/scripts/phase-files.mjs`
- related helper tests

## Tests to add first

- smoke test `init-phase` against a temp repo layout
- maintain/update helper tests where practical

## Implementation order

1. define docs-first convention
2. add durable phase-doc template
3. update scaffolding helpers
4. confirm smoke behavior

## Acceptance criteria

- phase scaffolding can create both durable docs and tmp planning artifacts
- docs and skill agree on the new convention
- Phase 0 names the next extraction targets

## Risks / non-goals

- still not a full package-boundary implementation phase
- test coverage may remain split between package-level and skill-local harnesses

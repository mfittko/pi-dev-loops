# Phase phase-0 summary

## What was planned

- establish a docs-first dev-loop convention
- make `docs/phases/phase-<n>.md` the durable phase-planning surface
- keep `tmp/phases/phase-<n>/` as the execution-artifact surface
- align the local `dev-loop` skill and deterministic phase scaffold with that convention
- clarify the initial boundary between shared deterministic support logic and Pi-facing orchestration

## What was implemented

- bootstrapped `AGENTS.md`
- added durable workflow docs under `docs/`
- created `docs/phases/phase-0.md` as the durable phase plan and `docs/phases/phase-1.md` as a minimal placeholder only
- updated `skills/dev-loop/SKILL.md` to treat phase docs as first-class durable artifacts and to require support files before a bootstrap/setup phase can be considered done
- added `skills/dev-loop/templates/phase-doc.md`
- updated phase scaffolding helpers so `init-phase` can generate a durable phase doc plus tmp planning artifacts
- established the first shared support-package seed in `packages/core/` and kept a thin skill-local wrapper for the extracted helper pattern

## Tests added or updated

- updated helper tests for the phase-path and init-phase behavior to account for durable phase docs
- preserved and passed the package-level tests under `packages/core/test/`

## Validation results

- passed: `npm run test:core`
- passed: temp-repo smoke test for `skills/dev-loop/scripts/init-phase.mjs`
- passed: YAML frontmatter parse check for `skills/dev-loop/SKILL.md` and `skills/copilot-dev-loop/SKILL.md`
- not run: coverage workflow
- not run: `skills/dev-loop` Jest-based local test suite in this checkout because `skills/dev-loop/node_modules/jest` is not installed

## Decisions recorded

- use `PLAN.md` for cross-phase roadmap truth
- use `docs/phases/phase-<n>.md` for durable per-phase plans
- use `tmp/phases/phase-<n>/` for execution artifacts and resumable machine-friendly state
- put deterministic, Pi-independent helpers into a shared npm support package over time
- keep policy, read order, stop conditions, and subagent orchestration in Pi-facing skills/docs
- require expected bootstrap support files to exist before a setup/bootstrap phase can be marked done
## Follow-ups for next phase

- finalize Phase 0 in git with authorized commit/merge steps
- refine `docs/phases/phase-1.md`
- classify imported repo-specific assumptions asset by asset
- decide which existing deterministic helpers should move next into `packages/core`
- keep Phase 1 normalization work separate from any later package-polish or extension UX work

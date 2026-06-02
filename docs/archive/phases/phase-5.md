# phase-5 durable plan

## Status

Completed

## Objective

Turn the Phase 4 shared package logic into a small set of real deterministic root scripts that prove value without broadening into a generic watcher framework or wider GitHub orchestration layer.

## Why this phase exists now

Phase 4 established the first reusable deterministic package seams: phase-file handling and fixture-backed review-thread parsing. The next immediate need is to expose those seams through real root script entrypoints so later workflows can rely on deterministic capture, bounded watch behavior, and loop-state summarization instead of ad hoc shell logic.

## In scope

- add `scripts/github/capture-review-threads.mjs`
- add `scripts/github/watch-copilot-review.mjs`
- add `scripts/loop/summarize-loop-state.mjs` (later deleted during deslop cleanup, issue #319)
- keep all outputs machine-readable and deterministic
- reuse Phase 4 package helpers wherever logic is pure and shared
- allow bounded custom polling only for fresh Copilot review activity because native `gh` watch does not express that exact condition well
- update root docs and test wiring so the script contracts are explicit and reviewable

## Explicit non-goals

- no `scripts/github/watch-pr-rereview.mjs` in this phase
- no `scripts/github/find-pr-for-issue.mjs`
- no broad `scripts/github/capture-pr-state.mjs`
- no timeout-policy abstraction
- no workflow-run/check normalization module
- no `scripts/loop/clean-stale-artifacts.mjs`
- no extension UX changes
- no second-repo pilot
- no package publishing/distribution work
- no GitHub mutations such as comments, PR reviews, thread resolution, assignment, or merge actions

## Acceptance criteria

- root `scripts/` gains exactly three Phase 5 entrypoints:
  - `scripts/github/capture-review-threads.mjs`
  - `scripts/github/watch-copilot-review.mjs`
  - `scripts/loop/summarize-loop-state.mjs` (deleted)
- `capture-review-threads`:
  - accepts fixture/stdin or explicit live PR arguments via `--repo <owner/name> --pr <number>`
  - reuses the shared review-thread parser
  - emits machine-readable success/error JSON
- `watch-copilot-review`:
  - uses bounded custom polling only for the exact fresh Copilot-review condition that native `gh` watch does not express well
  - emits deterministic changed/timeout/idle JSON with an explicit minimal machine-readable result shape
  - does not mutate GitHub state
  - does not wake on fresh non-Copilot review activity
- `summarize-loop-state` (deleted):
  - reads existing phase artifacts only
  - emits a deterministic machine-readable summary
  - does not mutate or clean files
- all new scripts are testable without live GitHub access
- the phase remains bounded away from broader PR-state modeling, issue discovery, rereview watching, cleanup automation, and package strategy work

## Definition of done

- [Phase 5 Plan](./phase-5.md) records the narrowed objective, exact scope, non-goals, tests-first plan, AC, DoD, validation steps, durable decisions, and unresolved questions
- failing tests for all three scripts exist before implementation is considered complete
- script success and malformed-argument/error JSON contracts are explicit and tested
- the live capture contract is explicit: live mode requires both `--repo` and `--pr`
- the watcher contract is explicit: fresh non-Copilot review activity does not count as a change event
- any new shared helper added to `packages/core` is pure, fixture-backed, and justified by actual reuse
- [Scripts Documentation](../../../scripts/README.md) documents supported scripts, arguments, success outputs, and failure behavior accurately
- `npm test` passes
- `npm run test:core` passes
- `git diff --check` passes
- coverage is explicitly verified when tooling is available, or a bounded coverage-tooling gap is recorded under `tmp/phases/phase-5/`
- `npm run test:dev-loop` is run as the repo-level dev-loop script
- no Phase 6+ work is half-implemented under the Phase 5 label

## Validation approach

- write the three root script tests first
- _(summarize-loop-state test was deleted during deslop cleanup)_
- run `npm test`
- run `npm run test:core`
- run `git diff --check`
- run `npm run test:dev-loop`
- probe for local coverage tooling and record a bounded gap if unavailable
- do a focused read-through of the new root scripts, any shared helper added for them, and [Scripts Documentation](../../../scripts/README.md)

## Durable decisions

- Phase 5 should prove deterministic script value with a small script set rather than a broad suite
- exactly one bounded watcher is in scope now: fresh Copilot review activity
- live `gh` usage should remain a thin capture/wait layer over fixture-backed parsing and diffing logic
- loop-state summarization should reflect stored artifact truth only and must not mutate or clean files
- in this source-loaded workspace repo, root scripts may consume shared package helpers through a thin local adapter instead of assuming published package import resolution during local development
- the dev-mode follow-up for this phase tightened planning expectations around watcher timing semantics and source-loaded workspace/package boundaries
- broader rereview watching, PR-state capture, issue discovery, cleanup automation, timeout policy, and check normalization remain deferred

## Open questions

- what is the narrowest stable JSON contract for `watch-copilot-review` that still supports later follow-up automation without over-modeling every poll detail beyond the explicit changed/timeout/idle result shape?
- if a tiny shared diff helper is added under `packages/core`, what is the narrowest reusable seam that avoids premature generalization?
- should [Scripts Documentation](../../../scripts/README.md) move fully from `lib/` terminology to package-first shared-helper terminology in this phase, or is a smaller wording correction enough?

## Operational closure status

Phase 5 implementation, validation, review/fix, and the bounded dev-mode follow-up are complete.

The reviewed phase branch has been captured in local commit history and merged back to local `main`.

## Links to execution artifacts

- local execution artifacts may exist under `tmp/phases/phase-5/`

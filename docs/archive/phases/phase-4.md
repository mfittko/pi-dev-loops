# phase-4 durable plan

## Status

Completed

## Objective

Create the first intentionally reusable shared deterministic support layer in `@pi-dev-loops/core` by:
- moving the existing phase-file/path/index logic out of the skill-local script and into the package as the new source of truth
- adding one minimal fixture-backed GitHub parsing seam for review-thread parsing and actionable-comment detection
- exposing the new shared helpers through stable JS and CLI entrypoints with explicit machine-readable output contracts

## Why this phase exists now

Phase 3 established the runtime/build/test contract for the package surface and kept the extension thin. The next bottleneck is deterministic logic that already exists locally or is about to be duplicated across skills, repo-local scripts, and later GitHub automation.

This phase exists now to centralize the smallest proven reusable slice before Phase 5 script work begins. It should prove the package-first direction without prematurely expanding into watcher orchestration, second-repo rollout, or package strategy work that belongs to later phases.

## Roadmap alignment note

[Project Plan](PLAN.md) still describes a broader aspirational Phase 4 bundle. For implementation and review of `phase-4`, this durable phase doc intentionally narrows that roadmap wording and is the acceptance-criteria / definition-of-done source of truth. Any broader roadmap bullets not listed as in-scope here are explicitly deferred to later phases unless this document is revised.

## In scope

- extract `skills/dev-loop/scripts/phase-files.mjs` into `packages/core` as the source of truth for deterministic phase-file mechanics
- keep `skills/dev-loop/scripts/phase-files.mjs` as a thin compatibility wrapper and CLI forwarder so the current skill path does not break
- preserve and document the current stable machine-readable contract for:
  - phase path resolution
  - default phase manifest shape
  - default phase index shape
  - manifest patch merging behavior
  - phase-file CLI success output
- add a new package CLI for deterministic phase-file creation/update
- perform a bounded scan of shipped skills for non-deterministic logic that can realistically and efficiently move to shared deterministic helpers or CLI tooling
- record prioritized extraction candidates from that scan in the phase artifacts and durable decisions without trying to rewrite every skill in this phase
- add one minimal GitHub helper surface in `packages/core` for:
  - review-thread parsing from stored JSON fixtures only
  - actionable-comment / actionable-thread detection
- add a matching package CLI for review-thread parsing that emits normalized machine-readable JSON
- add fixture-backed package tests for the extracted loop helper and the new GitHub parser helper
- keep the existing `bash-exit-one` helper and tests intact as an established package regression guard
- update durable docs and package metadata so the Phase 4 package contract is concrete and reviewable

## Explicit non-goals

- no root `scripts/github/*` rollout yet
- no broad rewrite of every skill to remove all prose or judgment; Phase 4 only records realistic deterministic extraction candidates
- no watcher implementation, custom polling loop, or `gh ... watch` orchestration yet
- no GitHub issue/PR discovery module in this phase
- no workflow-run/check normalization module in this phase
- no timeout-policy framework in this phase
- no artifact cleanup/deletion automation beyond the already-existing phase-file surface
- no broader restart/resume model beyond current phase manifest/index handling
- no extension UX work
- no second-repo pilot or install/override strategy work
- no package publishing/distribution pipeline work
- no reliance on Pi private internals

## Tests to write first

1. `packages/core/test/phase-files.test.mjs`
   - parity coverage for the current `phase-files` behavior
   - covers phase-name validation, deterministic path building, default manifest/index creation, manifest patch merging, on-disk `ensurePhaseFiles` behavior, and CLI argument parsing/output
2. `packages/core/test/review-threads.test.mjs`
   - fixture-backed parsing coverage for unresolved actionable threads, resolved threads, and non-actionable bot/system comment cases
   - asserts stable normalized output objects rather than prose-only matching
3. `packages/core/test/review-threads-cli.test.mjs`
   - asserts stable machine-readable CLI output on success
   - asserts deterministic failure behavior for invalid JSON / invalid arguments
4. thin-wrapper regression coverage
   - retain equivalent root smoke coverage proving the skill still works through the shared package boundary without reintroducing wrapper-specific duplicate tests
5. keep passing regression coverage for `packages/core/test/bash-exit-one.test.mjs`

## Acceptance criteria

- `@pi-dev-loops/core` exports a shared loop helper module for deterministic phase paths, manifests, indexes, and phase-file updates
- the phase leaves behind a bounded skill audit identifying non-deterministic logic that is a realistic candidate for replacement by shared deterministic helpers or CLI tooling, with explicit prioritization rather than a blanket rewrite mandate
- `skills/dev-loop/scripts/phase-files.mjs` becomes a thin compatibility wrapper and is no longer the source of truth for phase-file logic
- the shared phase-file contract remains stable for the existing workflow fields:
  - manifest fields: `phase`, `status`, `startedAt`, `completedAt`, `nextPhase`, `validation`, `artifacts`, `subagents`, `decisions`, `notes`
  - validation fields: `check`, `test`, `coverage`
  - index shape: `{ phases: [...] }` with deterministic phase ordering and `manifestPath` tracking
  - path shape includes the current resolved paths needed by callers, including `phaseDir`, `phasePlanPath`, `manifestPath`, `indexPath`, and `bashExitOnePath`
- `@pi-dev-loops/core` provides a new Phase 4-relevant CLI for phase-file creation/update, and its success output is machine-readable JSON that includes `ok: true` plus the resolved phase-path information needed by callers
- `@pi-dev-loops/core` exports a shared GitHub helper module for review-thread parsing and actionable-comment / actionable-thread detection from stored JSON input only
- the normalized review-thread result has an explicit, stable machine-readable shape at minimum:
  - `summary` with counts for total threads, unresolved threads, actionable threads, and actionable comments
  - `threads[]` entries with stable identifiers plus resolution/actionability state and deterministic ordering
  - `comments[]` entries with stable identifiers plus author/body/actionability data needed by later scripts
- the review-thread parser is fixture-backed and does not make live `gh` or network calls in tests
- at least one new helper beyond the pre-existing `bash-exit-one` helper ships with both JS and CLI entrypoints
- the current repo-level dev-loop smoke path continues to pass through the new shared boundary
- the package surface remains deterministic and thin:
  - no Pi runtime coupling
  - no GitHub mutation logic
  - no watcher orchestration loop

## Definition of done

- [Phase 4 Plan](docs/phases/phase-4.md) records the final objective, scope, non-goals, tests-first plan, acceptance criteria, definition of done, validation steps, durable decisions, and unresolved questions
- [Phase 4 Summary](tmp/phases/phase-4/summary.md) and the durable phase doc record the prioritized skill-scan findings for realistic deterministic extraction candidates
- failing package tests for `phase-files` parity and review-thread parsing are added before implementation is considered complete
- `packages/core/src/loop/phase-files.mjs` is the shared source of truth for phase-file behavior
- `packages/core/src/github/review-threads.mjs` exists with fixture-backed normalized parsing and actionable-comment detection
- `packages/core/bin/ensure-phase-files.mjs` exists and matches the documented machine-readable contract
- `packages/core/bin/parse-review-threads.mjs` exists and matches the documented machine-readable contract
- `packages/core/package.json` exports/bin metadata accurately reflect the supported source-loaded package surface
- `skills/dev-loop/scripts/phase-files.mjs` stays thin and does not retain duplicated core logic
- package fixtures for review-thread parsing live in a deterministic committed location under `packages/core/test/fixtures/`
- `packages/core/test/bash-exit-one.test.mjs` still passes unchanged unless a strictly necessary package-contract adjustment is documented
- `npm run test:core` passes
- `npm test` passes
- `npm run test:dev-loop` is run as the repo-level dev-loop script
- `git diff --check` passes
- changed deterministic logic has explicit coverage evidence against the repo coverage contract when local tooling is available; otherwise a bounded coverage-tooling gap is recorded under [Coverage Report](tmp/phases/phase-4/coverage.md) and coverage is not marked as validated implicitly
- no timeout-policy module, check-status normalization module, watcher script suite, second-repo pilot, or package-strategy work is partially implemented under the Phase 4 banner

## Validation approach

- write the new `packages/core` tests before finishing implementation of extracted/new helpers
- perform a bounded audit of shipped skills and record realistic deterministic-extraction candidates before closing the phase
- run `node --test packages/core/test/*.test.mjs`
- run `npm run test:core`
- run `npm test`
- probe for reusable local coverage tooling with `npx --no-install c8 --version`
- if `c8` is available locally, run `NODE_V8_COVERAGE=tmp/phases/phase-4/coverage/raw npx --no-install c8 --reporter=text-summary node --test packages/core/test/*.test.mjs` and capture the summary under [Coverage Report](tmp/phases/phase-4/coverage.md)
- if `c8` is not available locally, write [Coverage Report](tmp/phases/phase-4/coverage.md) recording the attempted command, the missing-tooling limitation, the changed files that still require coverage confidence, and that coverage remains a tracked validation gap rather than a passed check
- run `npm run test:dev-loop`
- run `git diff --check`
- do a focused read-through of:
  - `packages/core/package.json`
  - `packages/core/src/loop/phase-files.mjs`
  - `packages/core/src/github/review-threads.mjs`
  - `packages/core/bin/ensure-phase-files.mjs`
  - `packages/core/bin/parse-review-threads.mjs`
  - `skills/dev-loop/scripts/phase-files.mjs`
- confirm the durable docs and package metadata do not promise timeout policy, watcher behavior, check normalization, or publishing support that this phase did not implement

## Durable decisions

- Phase 4 is intentionally narrowed to the safest useful package-first slice: extracted phase-file helpers plus one minimal GitHub review-thread parsing seam
- the phase also records which existing skill behaviors are realistic candidates for later deterministic extraction into shared helpers or CLI tooling, without attempting to rewrite every skill now
- `packages/core` becomes the source of truth for shared deterministic logic; skill-local scripts remain compatibility wrappers where needed
- fixture-backed pure parsing is the standard for new GitHub normalization helpers in this phase
- CLI entrypoints added in this phase must emit machine-readable JSON on success and avoid Pi-runtime coupling
- the review-thread parser CLI accepts stdin or `--input <path>` and emits the same normalized success shape either way
- the existing `bash-exit-one` helper remains an established regression guard, but it does not by itself satisfy the requirement to prove new shared package value in Phase 4
- timeout policy, workflow/check normalization, watcher behavior, and broader restart/cleanup mechanics are deferred until a later phase with a concrete consumer and clearer boundary
- the current source-loaded workspace/package contract from Phase 3 remains the operative package mode for Phase 4
- the durable phase doc intentionally supersedes the broader roadmap wording in [Project Plan](PLAN.md) for Phase 4 implementation acceptance until the roadmap is updated
- the dev-mode follow-up for this phase tightened planning expectations around bounded audits/scans and malformed-argument/error-contract coverage for new CLIs

## Risks / watchpoints

- scope creep into Phase 5 script work is the main risk; do not add watcher loops, shell polling, or root `scripts/github/*` entrypoints here
- export names and CLI names chosen now may become sticky public package surface; keep them explicit and minimal
- the extraction can accidentally preserve duplicate logic in the skill-local wrapper if the wrapper is not reduced aggressively enough
- GitHub fixture design can overfit or drift from real payloads; keep the normalized shape narrow and driven by actual fixture-backed use cases
- wrapper regression detection must rely on the surviving root/core smoke coverage rather than on duplicate wrapper-specific test paths

## Unresolved questions

- what is the narrowest normalized review-thread output shape that still supports later deterministic scripts without prematurely modeling every GitHub field?
- which shipped skills still contain the highest-value non-deterministic logic that should realistically move to shared helpers or CLI tooling in later phases?
- should package-surface documentation for `packages/core` live in a package README immediately, or remain phase-doc-first until a second consumer exists?

## Bounded skill-scan findings

Bounded scan scope for this phase:
- [Dev Loop Skill](skills/dev-loop/SKILL.md)
- `skills/dev-loop/scripts/*.mjs`
- [Copilot Dev Loop Skill](skills/copilot-dev-loop/SKILL.md)

Prioritized deterministic extraction candidates recorded for later phases:
1. **P1 — GitHub review baseline diffing and fresh-activity detection for Copilot PR follow-up**
   - Source signals: [Copilot Dev Loop Skill](skills/copilot-dev-loop/SKILL.md) sections covering async watch behavior, baseline capture, and waiting for new Copilot-authored review bodies/comments.
   - Why it is realistic: this is adjacent to the new Phase 4 fixture-backed review-thread parser and can stay deterministic if it compares stored snapshots instead of live orchestration state.
   - Deferred boundary: no watcher/polling loop implementation in Phase 4; only the future snapshot-diff helper/CLI is a candidate.
2. **P1 — GitHub check-run / workflow snapshot normalization**
   - Source signals: [Copilot Dev Loop Skill](skills/copilot-dev-loop/SKILL.md) guidance around `gh pr checks`, `gh run watch`, CI interpretation, and merge-readiness reporting.
   - Why it is realistic: the skill currently relies on prose around repeated GitHub status interpretation, which is a strong fit for fixture-backed normalization before Phase 5 watcher entrypoints.
   - Deferred boundary: no timeout policy or native-watch orchestration was added in Phase 4.
3. **P2 — dev-loop phase artifact summarization for dev-mode review inputs**
   - Source signals: `skills/dev-loop/scripts/dev-mode-context.mjs` plus the [this skill file](SKILL.md) dev-mode retrospective flow.
   - Why it is realistic: it already consumes deterministic phase paths and machine-readable artifacts; now that phase-file/path logic lives in `packages/core`, the context collector is a plausible later package helper after the artifact schema is proven across more than one consumer.
   - Deferred boundary: keep current dev-mode logic skill-local until a second consumer or stronger shared schema need appears.
4. **P3 — keep skill-local for now: template rendering/materialization**
   - Source signals: `skills/dev-loop/scripts/render-template.mjs`.
   - Why it is lower priority: it is deterministic but currently tied to dev-loop template conventions rather than a demonstrated cross-skill/shared package need.

## RFC escalation

No RFC escalation is required to proceed with the narrowed Phase 4 plan.

If implementation pressure attempts to broaden this phase to include timeout policy, check-status normalization, watcher orchestration, or a larger public package API than defined here, escalate that re-scope through the coordinator for RFC consideration with:
- lead dev
- specialized dev
- systems architect

## Operational closure status

Phase 4 implementation, validation, review/fix, bounded skill-scan recording, and the bounded dev-mode follow-up are complete.

The reviewed phase branch has been captured in local commit history and merged back to local `main`.

## Links to execution artifacts

- local execution artifacts may exist under `tmp/phases/phase-4/`

# phase-3 durable plan

## Status

Completed

## Objective

Turn the existing package extension scaffold into a clearly supported setup/readiness UX surface with an explicit runtime/build/test contract while keeping the extension thin.

## Why this phase exists now

Phase 2 improved local phase refinement and clarified RFC boundaries. The next immediate need is to make the package extension useful and honest: users should be able to discover readiness, understand missing prerequisites, and know what to do next without the extension quietly absorbing workflow mechanics that belong in later phases.

## In scope

- harden the existing `/dev-loops` package extension surface
- keep `/dev-loops` as the single command entrypoint with distinct roles for:
  - `status` = concise readiness summary and lightweight next steps
  - `doctor` = full diagnostic report with explicit pass/fail detail
  - `setup` = diagnostic report plus ordered first-time setup guidance
  - `hide` = remove the widget cleanly
- keep the extension thin by separating:
  - Pi wiring and command/session registration in `extension/index.ts`
  - deterministic readiness discovery in `extension/checks.ts`
  - pure presentation/next-step composition in a small helper module when needed
- keep setup guidance advisory only in this phase
- make the reported prerequisite set explicit and stable:
  - `gh` installed
  - `gh` authenticated
  - `pi-subagents` available
  - inside a git repo
  - local dev-loop skill discoverable
  - Copilot dev-loop skill discoverable
- define the runtime/build/test contract for the current repo/package shape
- update extension docs and package scripts so the implemented contract is clear and testable

## Explicit non-goals

- no installer automation or environment mutation
- no dashboard/TUI redesign beyond the current lightweight status/widget surface
- no shared-library extraction into `packages/core`
- no new deterministic `scripts/` beyond what this phase strictly needs
- no package publishing/distribution pipeline work
- no new workflow commands or expansion of GitHub/Copilot loop mechanics
- no reliance on Pi private internals

## Acceptance criteria

- the package exposes a working extension entrypoint from `package.json` via `./extension/index.ts`
- `/dev-loops` remains the single command surface and supports `status`, `doctor`, `setup`, and `hide`
- `/dev-loops` with no subcommand defaults to `status`
- `status`, `doctor`, and `setup` have intentionally distinct and documented behaviors
- the extension reports the current prerequisite set at minimum:
  - `gh` installed
  - `gh` authenticated
  - `pi-subagents` available
  - inside a git repo
  - local dev-loop skill discoverable
  - Copilot dev-loop skill discoverable
- the messaging makes it explicit that local-loop readiness and remote-loop readiness are not identical
- `hide` removes the widget cleanly and confirms the action
- the extension stays thin:
  - Pi wiring in `extension/index.ts`
  - readiness checks in `extension/checks.ts`
  - pure presentation/copy logic in a small helper when needed
- the runtime/build/test contract is explicit and documented:
  - Node support floor matches `package.json`
  - Pi host expectations are documented from current peer dependencies without over-claiming a tested Pi version range
  - `gh` presence/auth expectations are documented without claiming a specific supported `gh` version yet
  - source-loaded extension execution is the supported Phase 3 mode
  - root extension tests are distinct from skill-local tests
- new automated tests cover command behavior, readiness reporting, and package/doc contract alignment

## Definition of done

- `docs/phases/phase-3.md` fully documents the objective, scope, AC, DoD, validation, and non-goals
- root failing tests for extension behavior and package contract are added before implementation completion
- `extension/index.ts` remains thin and primarily handles Pi registration and UI glue
- `extension/checks.ts` exposes a stable, testable check-result shape
- the new presentation helper is pure and small
- `extension/README.md` documents the command surface, prerequisites, setup intent, and current limitations accurately
- `package.json` scripts and metadata reflect the actual extension/test contract used in this phase
- targeted extension tests and existing root tests pass
- `git diff --check` passes
- any residual runtime/host limitations are documented explicitly instead of overpromised
- the durable phase doc and README define the command-behavior contract concretely enough that tests and review do not need to guess what `status`, `doctor`, and `setup` are supposed to do
- no new shared package, installer flow, or packaging/distribution pipeline is introduced

## Validation approach

- write the root extension tests first
- run `node --test test/extension-checks.test.mjs test/extension-command-contract.test.mjs test/extension-package-contract.test.mjs`
- run existing root tests via the updated root test script
- run `npm run test:dev-loop` if runnable in this checkout; otherwise record the limitation honestly
- run `git diff --check`
- do a focused read-through of `extension/index.ts`, `extension/checks.ts`, any new presentation helper, `extension/README.md`, and `package.json`

## Durable decisions

- Phase 3 should harden the extension UX contract before broader package/distribution work continues
- the extension should remain thin and package-facing rather than becoming a workflow orchestrator
- only the runtime/build/test contract supported by current repo evidence should be documented in this phase
- Phase 3 should document Node support from `package.json`, Pi host expectations from peer dependencies, and `gh` prerequisite checks without claiming tested Pi/`gh` version ranges that the repo cannot yet prove
- setup guidance remains advisory rather than mutating in this phase
- a small pure presentation helper is justified here to keep `extension/index.ts` thin while separating copy and readiness composition from Pi wiring
- the root test story should be explicit: `npm test` for the current root suite, `npm run test:extension` for extension-specific tests, and `npm run test:dev-loop` separately when the skill-local harness is available

## Open questions

- what is the smallest honest statement of Pi host compatibility that can be documented from current repo evidence?
- should extension-specific tests remain as explicit root test files, or later move behind a grouped root script once the suite grows further?
- should the current extension presentation helper remain extension-local indefinitely, or become a shared helper only after a second extension surface proves reuse is real?

## Operational closure status

Phase 3 implementation, validation, and review/fix are complete.

The reviewed phase branch has been captured in local commit history and merged back to local `main`.

## Links to execution artifacts

- local execution artifacts may exist under `tmp/phases/phase-3/`

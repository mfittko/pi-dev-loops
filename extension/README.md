# Extension scaffold

`pi-dev-loops` ships a lightweight package extension for setup and readiness UX.

## Command surface

- `/dev-loops`
  - defaults to `/dev-loops status`
- `/dev-loops status`
  - concise readiness summary plus lightweight next steps
- `/dev-loops doctor`
  - full diagnostic report with explicit pass/fail detail
- `/dev-loops setup`
  - diagnostic report plus ordered first-time setup guidance
- `/dev-loops hide`
  - removes the readiness widget cleanly

## Current readiness checks

The extension currently reports on:
- `gh` installed
- `gh` authenticated
- `pi-subagents` available
- inside a git repository
- `/skill:dev-loop` discoverable
- `/skill:copilot-dev-loop` discoverable

The messaging distinguishes between local loop readiness and remote GitHub/Copilot readiness. Missing `gh` or `gh auth` blocks remote-loop readiness, but does not imply that local phase-based work is completely unavailable.

## Setup contract for this phase

`/dev-loops setup` is advisory only in this phase.

It does **not**:
- install dependencies
- mutate the environment
- bootstrap repositories
- automate authentication

It only reports current readiness and points users at the next manual setup steps.

## Runtime / build / test contract

Current Phase 3 contract:
- Node runtime floor: `>=20` (from `package.json`)
- Pi host expectations are documented from current peer dependencies rather than a tested pinned Pi version range
- the extension is source-loaded from `./extension/index.ts` through `package.json` `pi.extensions`
- this phase does not yet claim a specific supported `gh` version; it only checks `gh` presence and authentication state
- this phase does not require a separate compiled build or `dist/` pipeline

Root tests and skill-local tests are intentionally separate:
- `npm test` runs the current root test suite (`test:assets`, `test:extension`, and `test:core`)
- `npm run test:extension`
- `npm run test:assets`
- `npm run test:dev-loop`

## Design rule

The extension should stay thin. Shared workflow mechanics should live in deterministic `lib/` modules and `scripts/`, not in extension-only event logic.

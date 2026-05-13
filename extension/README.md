# Extension scaffold

`pi-dev-loops` ships a lightweight package extension for readiness UX and explicit skill installation/update commands.

Installing the package exposes the `/dev-loops` command surface only. It does **not** automatically install packaged skills into the current repo or into `~/.pi/agent/skills`.

## Command surface

- `/dev-loops`
  - defaults to help output for the available subcommands
- `/dev-loops status`
  - concise readiness summary plus lightweight next steps
- `/dev-loops doctor`
  - full diagnostic report with explicit pass/fail detail
- `/dev-loops install`
  - prompts for `repo` or `system` when no target is provided
- `/dev-loops install repo`
  - copies packaged skills into the current repository under `.pi/skills`
- `/dev-loops install system`
  - copies packaged skills into `~/.pi/agent/skills`
- `/dev-loops update`
  - prompts for `repo` or `system` when no target is provided
- `/dev-loops update repo`
  - refresh installed skills in the current repository from the packaged source when they were already installed there
- `/dev-loops update system`
  - refresh installed skills in `~/.pi/agent/skills` from the packaged source when they were already installed there
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

## Install/update contract for this phase

`/dev-loops install ...` and `/dev-loops update ...` copy the packaged skill directories. For `copilot-dev-loop`, they also bundle the deterministic runtime support it references: `scripts/`, the required `packages/core/src/` subset, and the reviewer-loop state-graph docs under the installed skill directory.

`install` is for first-time setup. `update` refreshes installed skills only, reports missing targets, and guides users back to `install` when first-time setup is still needed.

These commands expect real directory targets. They intentionally refuse symlinked skill roots or symlinked skill directories so they do not accidentally mutate a shared source-of-truth directory through a symlink.

They do **not**:
- install `gh`
- install `pi-subagents`
- mutate GitHub authentication
- bootstrap repositories beyond writing skill directories and the bundled support files nested under them
- automatically refresh the current Pi session's already-loaded command list

After install or update, restart Pi or refresh skill discovery before expecting `/skill:dev-loop` or `/skill:copilot-dev-loop` to appear in the current session.

## Runtime / build / test contract

Current Phase 3+ contract:
- Node runtime floor: `>=20` (from `package.json`)
- Pi host expectations are documented from current peer dependencies rather than a tested pinned Pi version range
- the extension is source-loaded from `./extension/index.ts` through `package.json` `pi.extensions`
- the package does not automatically install skills through `package.json`; skill installation is an explicit `/dev-loops install ...` step
- this phase does not yet claim a specific supported `gh` version; it only checks `gh` presence and authentication state
- this phase does not require a separate compiled build or `dist/` pipeline

Root tests and skill-local tests are intentionally separate:
- `npm test` runs the current root test suite (`test:assets`, `test:extension`, `test:scripts`, and `test:core`)
- `npm run test:extension`
- `npm run test:assets`
- `npm run test:dev-loop`

## Design rule

The extension should stay thin. Shared workflow mechanics should live in deterministic `lib/` modules and `scripts/`, not in extension-only event logic.

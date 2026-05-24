# Extension scaffold

`pi-dev-loops` ships a lightweight package extension for readiness UX and explicit skill installation/update commands.

Installing the package exposes two thin wrappers over one shared deterministic core:
- the Pi extension command family rooted at `/dev-loops`
- the shell CLI entrypoint `pi-dev-loops`

Neither wrapper automatically installs packaged skills into the current repo or into `~/.pi/agent/skills`.

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
- `pi-dev-loops`
  - defaults to help output for the available subcommands
- `pi-dev-loops help`
  - prints shell help for the shared command family
- `pi-dev-loops status`
  - prints the concise readiness summary in shell-friendly output
- `pi-dev-loops doctor`
  - prints the full diagnostic report in shell-friendly output
- `pi-dev-loops install repo`
  - copies packaged skills into the current repository under `.pi/skills`
- `pi-dev-loops install system`
  - copies packaged skills into `~/.pi/agent/skills`
- `pi-dev-loops update repo`
  - refreshes already-installed packaged skills in the current repository from the shell
- `pi-dev-loops update system`
  - refreshes already-installed packaged skills in `~/.pi/agent/skills` from the shell
- `pi-dev-loops hide`
  - is intentionally unsupported and exits non-zero with a shell-friendly stderr message because `hide` is session-local Pi UI behavior

## Current readiness checks

The extension currently reports on:
- `gh` installed
- `gh` authenticated
- `pi-subagents` available
- inside a git repository
- `/skill:dev-loop` discoverable as the single public workflow entrypoint
- `/skill:copilot-dev-loop` discoverable as a compatibility/internal follow-up path
- `/skill:copilot-autopilot` discoverable as a compatibility/internal intake path

Readiness and help messaging should lead with `dev-loop`; the compatibility/internal skills remain installable and inspectable, but they are not presented as equal public workflow choices.

The messaging distinguishes between local loop readiness and remote GitHub/Copilot readiness. Missing `gh` or `gh auth` blocks remote-loop readiness, but does not imply that local phase-based work is completely unavailable.

The shell CLI currently treats packaged-skill discoverability as a filesystem check against the canonical repo (`.pi/skills`) and system (`~/.pi/agent/skills`) install roots. That can differ from Pi's live `/skill:*` registration state until Pi refreshes/restarts, or if a user relies on additional custom skill roots.

## Install/update contract for this phase

`/dev-loops install ...` and `/dev-loops update ...` copy the packaged skill directories. For `copilot-dev-loop` and `copilot-autopilot`, they also bundle an explicit allow-listed runtime support set under the installed skill directory: the required deterministic script files, the required `packages/core/src/` files, and both loop state-graph docs.

`install` is for first-time setup. `update` refreshes installed skills only, reports missing targets, and guides users back to `install` when first-time setup is still needed.

These commands expect real directory targets. They intentionally refuse symlinked skill roots or symlinked skill directories so they do not accidentally mutate a shared source-of-truth directory through a symlink.

They do **not**:
- install `gh`
- install `pi-subagents`
- mutate GitHub authentication
- bootstrap repositories beyond writing skill directories and the bundled support files nested under them
- automatically refresh the current Pi session's already-loaded command list

After install or update, restart Pi or refresh skill discovery before expecting newly installed or updated skills to appear in the current session. If `update` reports a packaged skill as missing, run `/dev-loops install repo|system` first for that skill set; a refresh alone will not make a missing skill appear.

## Runtime / build / test contract

Current Phase 3+ contract:
- Node runtime floor: `>=20` (from `package.json`)
- Pi host expectations are documented from current peer dependencies rather than a tested pinned Pi version range
- the extension is source-loaded from `./extension/index.ts` through `package.json` `pi.extensions`
- the shell CLI is exposed through `package.json` `bin.pi-dev-loops`
- the package does not automatically install skills through `package.json`; skill installation is an explicit `/dev-loops install ...` step
- this phase does not yet claim a specific supported `gh` version; it only checks `gh` presence and authentication state
- this phase does not require a separate compiled build or `dist/` pipeline

Root tests and skill-local tests are intentionally separate:
- `npm test` runs the current root test suite (`test:assets`, `test:extension`, `test:scripts`, and `test:core`)
- `npm run test:extension`
- `node --import tsx --test test/extension-checks.test.mjs test/extension-installer.test.mjs test/extension-command-contract.test.mjs test/extension-package-contract.test.mjs test/dev-loops-core.test.mjs test/dev-loops-cli.test.mjs`
- `npm run test:assets`
- `npm run test:dev-loop`

## Design rule

Both wrappers should stay thin. Shared workflow mechanics should live in deterministic `lib/` modules and `scripts/`, not in extension-only or CLI-only command logic.

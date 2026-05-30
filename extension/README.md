# Extension scaffold

`pi-dev-loops` ships a lightweight package extension for readiness UX.

Installing the package exposes two thin wrappers over one shared deterministic core:
- the Pi extension command family rooted at `/dev-loops`
- the shell CLI entrypoint `pi-dev-loops`

Installing the package with `pi install git:github.com/mfittko/pi-dev-loops` exposes the packaged skills through `package.json` `pi.skills`, and the extension syncs packaged `.pi/agents/*.agent.md` files into `~/.agents/` on `session_start`.

## Command surface

- `/dev-loops`
  - defaults to help output for the available subcommands
- `/dev-loops status`
  - concise readiness summary plus lightweight next steps
- `/dev-loops doctor`
  - full diagnostic report with explicit pass/fail detail
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
- `pi-dev-loops hide`
  - is intentionally unsupported and exits non-zero with a shell-friendly stderr message because `hide` is session-local Pi UI behavior

## Current readiness checks

The extension currently reports on:
- `gh` installed
- `gh` authenticated
- `pi-subagents` available
- inside a git repository

Readiness and help messaging should lead with `dev-loop` as the single public workflow entrypoint. Internal compatibility seams may still exist for runtime/routing purposes, but the readiness surface should not present them as separate user-facing checks or workflow choices.

The messaging distinguishes between local loop readiness and remote GitHub/Copilot readiness. Missing `gh` or `gh auth` blocks remote-loop readiness, but does not imply that local phase-based work is completely unavailable.

## Package install contract for this phase

- `pi install git:github.com/mfittko/pi-dev-loops` is the distribution mechanism for the extension, skills, scripts, and packaged agents
- `pi install -l git:github.com/mfittko/pi-dev-loops` is the project-local replacement for the old `install repo` flow
- `pi update git:github.com/mfittko/pi-dev-loops` refreshes an installed package
- packaged agents are refreshed into `~/.agents/` on each `session_start`
- `/dev-loops install ...` and `/dev-loops update ...` are removed; use `pi install` / `pi update` directly instead

## Runtime / build / test contract

Current Phase 3+ contract:
- Node runtime floor: `>=20` (from `package.json`)
- Pi host expectations are documented from current peer dependencies rather than a tested pinned Pi version range
- the extension is source-loaded from `./index.ts` through `package.json` `pi.extensions`
- the package exposes `.pi/skills` through `package.json` `pi.skills` for install-based global skill loading
- the shell CLI is exposed through `package.json` `bin.pi-dev-loops`
- the extension syncs packaged `.pi/agents/*.agent.md` files into `~/.agents/` on `session_start` so user-level agents are available outside this repo
- `/dev-loops install ...` and `/dev-loops update ...` are not part of the command surface; package install/update happens through `pi install` / `pi update`
- this phase does not yet claim a specific supported `gh` version; it only checks `gh` presence and authentication state
- this phase does not require a separate compiled build or `dist/` pipeline

Root verification and test commands are intentionally explicit:
- `npm run verify` is the canonical root verification path (`npm test` + `npm run test:dev-loop`)
- `npm test` runs the current root test suite (`test:assets`, `test:extension`, `test:scripts`, and `test:core`)
- `npm run test:extension`
- `npm run test:extension` currently expands to one `node --import tsx --test ...` invocation in `package.json`; prefer the script entrypoint over copying the file list into downstream docs or runbooks
- `npm run test:assets`
- `npm run test:dev-loop`
- `npm run test:playwright:viewer` remains an explicit viewer/browser smoke, not part of the default root verify path

## Design rule

Both wrappers should stay thin. Shared workflow mechanics should live in deterministic `lib/` modules and `scripts/`, not in extension-only or CLI-only command logic.

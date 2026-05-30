# pi-dev-loops

`pi-dev-loops` is a source-loaded workspace for reusable Pi development loops.

## Workflow posture

This repo supports both local and GitHub-first work, but the public workflow surface is intentionally narrow:
- use **`dev-loop`** as the single public façade and workflow entrypoint
- prefer the GitHub-first routed path for active implementation and release work when practical
- use the local implementation strategy only when the user explicitly wants phase-bounded local planning/implementation
- keep internal routed workflow logic behind that public façade rather than presenting it as peer workflow choices

The canonical public routing and shorthand contract lives in `docs/public-dev-loop-contract.md`.

## What this repository provides

This repo is built around generic role agents plus thin workflow entrypoint agents where needed.

Its main surfaces are:
1. **Role agents** in `agents/`
   - reusable prompts such as coordinator, developer, docs, quality, review, fixer, and refiner
2. **Workflow skills** in `skills/`
   - `dev-loop` is the public façade; internal routed logic stays internal
3. **Extension and CLI UX** in `extension/` and `cli/`
   - `/dev-loops` readiness checks plus the `pi-dev-loops` shell command
4. **Deterministic support code** in `packages/core/`, `scripts/`, and `lib/`
   - shared helpers, loop-state detectors, and GitHub/Copilot support code

Thin workflow entrypoint agents are allowed when they only load a skill and defer policy to it.

## Current status

A few durable current-state facts:
- the root package `pi-dev-loops` is currently `private: true`
- the shared workspace package `@pi-dev-loops/core` is also `private: true`
- the repo is currently documented as a source-loaded workspace, not a published npm-package workflow
- MIT is the current license
- the current implementation snapshot lives in `docs/IMPLEMENTATION_STATE.md`

## Package surface

Installing the package with `pi install git:github.com/mfittko/pi-dev-loops` exposes:
- the `/dev-loops` extension command surface
- the `pi-dev-loops` shell CLI
- the packaged skills from `package.json` `pi.skills`

For project-local installs, use `pi install -l git:github.com/mfittko/pi-dev-loops`.

Legacy `/dev-loops install` and `/dev-loops update` commands are removed; use `pi install` / `pi update` directly instead.

See `extension/README.md` for the full command and package-install contract.

## Requirements and assumptions

Current code and docs assume:
- Node `>=20`
- a Pi host that satisfies peer dependencies on `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`
- `pi-subagents` for current workflow assumptions
- `pi-intercom` if you want live mid-run async child steering / follow-up via `subagent({ action: "resume", ... })`
- `gh` installed and authenticated for GitHub/Copilot workflows
- a git repository checkout for the normal local and remote loop paths

Notes:
- without `pi-intercom`, async subagent workflows still support start, status inspection, interrupt, and post-completion resume/revive from saved child sessions
- live follow-up to a still-running async child depends on the `pi-subagents` intercom bridge, which requires `pi-intercom`
- install it with `pi install npm:pi-intercom`

## Repository layout

- `agents/` — reusable role-agent definitions
- `docs/` — durable workflow contracts, implementation status, and phase docs
- `cli/` — shell-facing `pi-dev-loops` entrypoint
- `extension/` — `/dev-loops` extension implementation and docs
- `lib/` — shared command helpers used by the extension and shell CLI
- `packages/core/` — private deterministic support package
- `scripts/` — deterministic CLI helpers for GitHub/review/loop mechanics
- `skills/` — packaged workflow skills
- `test/` — root contract and regression tests
- `tmp/` — gitignored local execution artifacts and resumable temporary state

## Development and validation

Root verification and test commands from `package.json`:
- `npm run verify` — canonical root verification path (`npm test` + `npm run test:dev-loop`)
- `npm test`
- `npm run test:assets`
- `npm run test:extension`
- `npm run test:scripts`
- `npm run test:core`
- `npm run test:dev-loop`
- `npm run test:playwright:viewer` — explicit viewer/browser smoke, not part of the default root verify path

CI currently runs `npm ci`, `npm run verify`, and the explicit Playwright viewer smoke in `.github/workflows/ci.yml`.

## Where to read next

- `PLAN.md` — durable repo intent and roadmap
- `docs/index.md` — docs start-here index for active docs, history, and presentations
- `docs/IMPLEMENTATION_STATE.md` — current implementation snapshot
- `docs/IMPLEMENTATION_WORKFLOW.md` — repo workflow contract and docs-sync rules
- `docs/public-dev-loop-contract.md` — canonical public façade and routing contract
- `extension/README.md` — `/dev-loops` command and package-install contract
- `scripts/README.md` — deterministic script contracts
- `skills/*/SKILL.md` — workflow-specific operating instructions
- `skills/docs/*.md` — canonical shared runtime contract docs for packaged skills

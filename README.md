# pi-dev-loops

`pi-dev-loops` is a private, source-loaded workspace for reusable Pi development loops.

## Workflow posture

This repo supports both local and GitHub-first work, but the public workflow surface is intentionally narrow:
- use **`dev-loop`** as the single public façade and workflow entrypoint
- prefer the GitHub-first routed path for active implementation and release work when practical
- use the local implementation strategy only when the user explicitly wants phase-bounded local planning/implementation
- keep internal routed workflow logic behind that public façade rather than presenting it as peer workflow choices

A canonical shorthand example still maps to the same public `dev-loop` intent:
- `auto dev loop on issue 112`

The canonical public routing and shorthand contract lives in [Public Dev Loop Contract](./skills/docs/public-dev-loop-contract.md).

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

## Package surface

Installing the package with `pi install git:github.com/mfittko/pi-dev-loops` exposes:
- the `/dev-loops` extension command surface
- the `pi-dev-loops` shell CLI
- the packaged skills from `package.json` `pi.skills`

For project-local installs, use `pi install -l git:github.com/mfittko/pi-dev-loops`.

Legacy `/dev-loops install` and `/dev-loops update` commands are removed; use `pi install` / `pi update` directly instead.

See [Extension Documentation](./extension/README.md) for the full command and package-install contract.

## Configuration

Gate review angles, refinement settings, persona mappings, workflow defaults, and review prompts are config-driven via `.pi/dev-loop/defaults.yaml`. Consumer repos can override any value through `.pi/dev-loop/overrides.yaml`.

```bash
# See what reviewers will check before handing off code
pi-dev-loops gates
```

Key configurable surfaces:
- **Gate angles** — which review lenses run at draft and pre-approval gates
- **Persona prompts** — focused instructions per angle (e.g. DRY, KISS, YAGNI, SRP, SoC)
- **Refinement** — fan-out count and mode for parallel review variants
- **Autonomy** — which gates require operator confirmation
- **Workflow defaults** — retrospective enforcement, draft-first posture, and formal dev-mode default policy

Full details: [Extension Documentation](extension/README.md) and `.pi/dev-loop/defaults.yaml`.

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

CI currently splits into a small changed-files gate plus parallel `verify` and conditional `viewer-smoke` jobs: `npm ci` + `npm run verify` still run on every change, while the workspace-local Playwright WebKit cache restore/install and explicit viewer smoke run only when files in the bounded inspect-run viewer surface or its smoke-path dependencies change.

## Where to read next

- [Docs Index](./docs/index.md) — start here for active docs and canonical-owner pointers
- [Extension Documentation](extension/README.md) — `/dev-loops` command and package-install contract
- [Scripts Documentation](./scripts/README.md) — deterministic script contracts
- [UI Smoke Harness](./docs/ui-smoke-harness.md) — reusable local Playwright/WebKit smoke baseline for opted-in UI slices
- [UI Artifact Contract](./docs/ui-artifact-contract.md) — screenshot/state artifact contract and bounded CI-promotion rules for UI slices
- [UI Designer Review Loop](./docs/ui-designer-review-loop.md) — designer-persona review loop contract for UI slices

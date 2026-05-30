# pi-dev-loops

`pi-dev-loops` is a source-loaded workspace for reusable Pi development loops. It combines generic role agents, local and GitHub-first workflow skills, a thin `/dev-loops` extension, and deterministic support code for the parts of planning, review, GitHub, and Copilot workflows that should not depend on ad hoc shell glue.

## Workflow posture

This repo supports both local and GitHub-first workflows, but the current repo contract is simple:
- use **`dev-loop`** as the single public façade and workflow entrypoint
- prefer the GitHub-first routed path for active implementation and release work when practical
- use the local implementation strategy only when the user explicitly wants phase-bounded local planning/implementation
- keep compatibility/internal strategy names behind that public façade rather than presenting them as peer workflow choices

High-level shorthand examples still map to the same public `dev-loop` intent:
- `auto dev loop on issue 112`
- `enter copilot auto dev loop on issue 112`
- `run auto dev loop on 112 until approval gate`

For the canonical public routing and shorthand contract, see `docs/public-dev-loop-contract.md`.

For the latest durable roadmap and status, start with:
- `PLAN.md`
- `docs/IMPLEMENTATION_STATE.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`

## What this repository provides

This repo currently contains four main layers. The design goal is generic role agents plus thin workflow entrypoint agents where needed, with thin workflow entrypoint agents allowed when they only load a skill and defer policy to it.

1. **Role agents** in `agents/`
   - reusable prompts such as coordinator, developer, docs, quality, review, fixer, and refiner
2. **Workflow skills** in `skills/`
   - `dev-loop` as the single public façade that routes to the correct internal loop strategy
   - internal compatibility seams remain runtime-only and are not public workflow choices
3. **Extension UX** in `extension/`
   - `/dev-loops` readiness checks plus install/update compatibility guidance
4. **Deterministic support code** in `packages/core/` and `scripts/`
   - shared pure/stateful helpers, loop-state detectors, and CLI entrypoints

This means the repo is no longer just a bootstrap import area. It is an active workflow toolkit with current tests, CI, and durable workflow docs.

## Current status

A few important current-state facts from the repo itself:
- the root package `pi-dev-loops` is currently `private: true`
- the shared workspace package `@pi-dev-loops/core` is also `private: true`
- the repo is currently documented as a source-loaded workspace, not a published npm-package workflow
- MIT is the current license
- current implementation/phase status lives in `docs/IMPLEMENTATION_STATE.md`

## `/dev-loops` extension surface

The root `package.json` loads `./extension/index.ts` through `pi.extensions`.

Current commands:
- `/dev-loops` — help output
- `/dev-loops status` — concise readiness summary
- `/dev-loops doctor` — full diagnostics
- `/dev-loops hide` — clear the readiness widget

Legacy `/dev-loops install` and `/dev-loops update` command names are removed; use `pi install` / `pi update` directly instead.

Important install/update contract:
- installing the package with `pi install git:github.com/mfittko/pi-dev-loops` exposes the `/dev-loops` extension command surface, the `pi-dev-loops` shell CLI, and the packaged skills from `package.json` `pi.skills`
- for a project-local install, use `pi install -l git:github.com/mfittko/pi-dev-loops`
- packaged `.pi/agents/*.agent.md` files are synchronized into `~/.agents/` on `session_start`
- `/dev-loops install ...` and `/dev-loops update ...` are removed; use `pi install` / `pi update` directly instead

See `extension/README.md` for the full command and package-install contract.

## Deterministic support surfaces

### Shared workspace package

`packages/core/` contains the current reusable support package, `@pi-dev-loops/core`.

Current exported areas include:
- `./bash-exit-one`
- `./loop/phase-files`
- `./loop/copilot-loop-state`
- `./loop/reviewer-loop-state`
- `./loop/outer-loop-state`
- `./loop/conductor-ownership`
- `./loop/tracker-pr-state`
- `./loop/public-dev-loop-routing`
- `./github/review-threads`

It also exposes these CLI binaries:
- `pi-dev-loops-log-bash-exit-1`
- `pi-dev-loops-ensure-phase-files`
- `pi-dev-loops-parse-review-threads`

Current in-repo core modules that are part of the source-loaded workflow surface, but are not yet package-exported as public entrypoints, include:
- `packages/core/src/loop/conductor-routing.mjs`
- `packages/core/src/loop/run-inspection.mjs`
- `packages/core/src/loop/steering.mjs`

### Root script entrypoints

Current script entrypoints include:
- `scripts/github/capture-review-threads.mjs`
- `scripts/github/detect-linked-issue-pr.mjs`
- `scripts/github/reply-resolve-review-thread.mjs`
- `scripts/github/request-copilot-review.mjs`
- `scripts/github/stage-reviewer-draft.mjs`
- `scripts/github/watch-copilot-review.mjs`
- `scripts/loop/copilot-pr-handoff.mjs`
- `scripts/loop/detect-copilot-loop-state.mjs`
- `scripts/loop/detect-initial-copilot-pr-state.mjs`
- `scripts/loop/detect-reviewer-loop-state.mjs`
- `scripts/loop/detect-tracker-pr-state.mjs`
- `scripts/loop/inspect-run.mjs`
- `scripts/loop/inspect-run-viewer.mjs`
- `scripts/loop/outer-loop.mjs`
- `scripts/loop/steer-loop.mjs`
- `scripts/loop/summarize-loop-state.mjs`

Reference docs:
- `scripts/README.md`
- `docs/public-dev-loop-contract.md`
- `docs/conductor-ownership-contract.md`
- `docs/conductor-routing-contract.md`
- `docs/copilot-loop-state-graph.md`
- `docs/reviewer-loop-state-graph.md`
- `docs/outer-loop-state-graph.md`
- `docs/steering-contract.md`
- `docs/tracker-first-mvp-state-graph.md`
- `docs/tracker-story-pr-contract.md`

## Requirements and assumptions

Current code and docs assume:
- Node `>=20`
- a Pi host that satisfies peer dependencies on `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`
- `pi-subagents` for the current workflow assumptions
- `gh` installed and authenticated for GitHub/Copilot workflows
- a git repository checkout for the normal local and remote loop paths

## Repository layout

- `agents/` — reusable role-agent definitions
- `docs/` — implementation state, workflow docs, contract/state-graph docs, and durable phase plans
- `bin/` — shell entrypoints exposed by the root package
- `cli/` — shell-facing command wrappers used by the root CLI
- `extension/` — `/dev-loops` extension implementation and docs
- `lib/` — shared deterministic library layer used by the extension and shell CLI
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

CI currently runs `npm ci`, `npm run verify`, and the explicit Playwright viewer smoke on Node 24 in `.github/workflows/ci.yml`.

## Where to read next

- `PLAN.md` — durable repo intent and roadmap
- `docs/IMPLEMENTATION_STATE.md` — current implementation snapshot
- `docs/IMPLEMENTATION_WORKFLOW.md` — repo workflow contract and docs-sync rules
- `docs/public-dev-loop-contract.md` — public façade, canonical state, and compatibility routing contract
- `extension/README.md` — `/dev-loops` command and package-install contract
- `scripts/README.md` — deterministic script contracts
- `skills/*/SKILL.md` — workflow-specific operating instructions

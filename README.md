# pi-dev-loops

`pi-dev-loops` is a source-loaded workspace for reusable Pi development loops. It combines generic role agents, local and GitHub-first workflow skills, a thin `/dev-loops` extension, and deterministic support code for the parts of planning, review, GitHub, and Copilot workflows that should not depend on ad hoc shell glue.

## What this repository provides

This repo currently contains four main layers. The design goal is generic role agents plus thin workflow entrypoint agents where needed, with thin workflow entrypoint agents allowed when they only load a skill and defer policy to it.

1. **Role agents** in `agents/`
   - reusable prompts such as coordinator, developer, docs, quality, review, fixer, and refiner
2. **Workflow skills** in `skills/`
   - `dev-loop` for docs-first local phase planning and implementation
   - `copilot-dev-loop` for GitHub/Copilot PR execution, watch, and follow-up loops
   - `copilot-autopilot` for issue-first GitHub intake through refinement, handoff, review, and merge
3. **Extension UX** in `extension/`
   - `/dev-loops` readiness checks plus explicit skill install/update flows
4. **Deterministic support code** in `packages/core/` and `scripts/`
   - shared state machines, review-thread parsing, phase-file helpers, and CLI entrypoints

This means the repo is no longer just a bootstrap import area. It is an active workflow toolkit with current tests, CI, and durable workflow docs.

## Current status

A few important current-state facts from the repo itself:

- the root package `pi-dev-loops` is currently `private: true`
- the shared workspace package `@pi-dev-loops/core` is also `private: true`
- the repo is currently documented as a source-loaded workspace, not a published npm package workflow
- MIT is the current license
- current implementation/phase status lives in `docs/IMPLEMENTATION_STATE.md`

For the latest durable status and roadmap, start with:

- `docs/IMPLEMENTATION_STATE.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `PLAN.md`

## `/dev-loops` extension surface

The root `package.json` loads `./extension/index.ts` through `pi.extensions`.

Current commands:

- `/dev-loops` — help output
- `/dev-loops status` — concise readiness summary
- `/dev-loops doctor` — full diagnostics
- `/dev-loops install repo` — copy packaged skills into the current repository under `.pi/skills`
- `/dev-loops install system` — copy packaged skills into `~/.pi/agent/skills`
- `/dev-loops update repo|system` — refresh previously installed packaged skills
- `/dev-loops hide` — clear the readiness widget

Important install/update contract:

- installing the package exposes the extension command surface only
- packaged skills are installed explicitly with `/dev-loops install ...`
- `update` refreshes existing installed copies but does not create first-time installs
- installed copies of `copilot-dev-loop` and `copilot-autopilot` include the allow-listed runtime support they need from `scripts/`, `packages/core/src/`, and `docs/`
- restart Pi or refresh skill discovery after install/update before expecting newly copied skills to appear in the current session

See `extension/README.md` for the full command and install/update contract.

## Deterministic support surfaces

### Shared workspace package

`packages/core/` contains the current reusable support package, `@pi-dev-loops/core`.

Current exported areas include:

- `./bash-exit-one`
- `./loop/phase-files`
- `./loop/copilot-loop-state`
- `./loop/reviewer-loop-state`
- `./github/review-threads`

It also exposes these CLI binaries:

- `pi-dev-loops-log-bash-exit-1`
- `pi-dev-loops-ensure-phase-files`
- `pi-dev-loops-parse-review-threads`

### Root script entrypoints

Current script entrypoints include:

- `scripts/github/capture-review-threads.mjs`
- `scripts/github/request-copilot-review.mjs`
- `scripts/github/watch-copilot-review.mjs`
- `scripts/github/stage-reviewer-draft.mjs`
- `scripts/github/reply-resolve-review-thread.mjs`
- `scripts/loop/detect-copilot-loop-state.mjs`
- `scripts/loop/detect-reviewer-loop-state.mjs`
- `scripts/loop/copilot-pr-handoff.mjs`
- `scripts/loop/summarize-loop-state.mjs`

Reference docs:

- `scripts/README.md`
- `docs/copilot-loop-state-graph.md`
- `docs/reviewer-loop-state-graph.md`

## Requirements and assumptions

Current code and docs assume:

- Node `>=20`
- a Pi host that satisfies peer dependencies on `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`
- `pi-subagents` for the current workflow assumptions
- `gh` installed and authenticated for GitHub/Copilot workflows
- a git repository checkout for the normal local and remote loop paths

## Repository layout

- `agents/` — reusable role-agent definitions
- `docs/` — implementation state, workflow docs, state graphs, and durable phase plans
- `extension/` — `/dev-loops` extension implementation and docs
- `lib/` — reserved shared-library area
- `packages/core/` — private deterministic support package
- `scripts/` — deterministic CLI helpers for GitHub/review/loop mechanics
- `skills/` — packaged workflow skills
- `test/` — root contract and regression tests
- `tmp/` — local execution artifacts and resumable temporary state

## Development and validation

Root test commands from `package.json`:

- `npm test`
- `npm run test:assets`
- `npm run test:extension`
- `npm run test:scripts`
- `npm run test:core`
- `npm run test:dev-loop`

CI currently runs `npm ci` and `npm test` on Node 24 in `.github/workflows/ci.yml`.

## Where to read next

- `PLAN.md` — product intent and roadmap
- `docs/IMPLEMENTATION_STATE.md` — current implementation snapshot
- `docs/IMPLEMENTATION_WORKFLOW.md` — local workflow contract
- `extension/README.md` — `/dev-loops` command and install/update contract
- `scripts/README.md` — deterministic script contracts
- `skills/*/SKILL.md` — workflow-specific operating instructions

# pi-dev-loops Plan

`pi-dev-loops` is a shared home for Pi-centered development workflow infrastructure.

The goal is to extract reusable local and remote development loops out of individual product repositories and consolidate them into one opinionated toolkit that can be reused across codebases.

## Product intent

This repo should eventually provide four layers:

1. **Generic role agents**
   - implementation, docs, quality, review, fixer, coordination, refinement
   - reusable across repositories
   - workflow-agnostic

2. **Loop skills**
   - local phase-based dev loop
   - async GitHub/Copilot dev loop
   - follow-up review/fix loops
   - re-review loops

3. **Extension UX and package glue**
   - setup/doctor commands
   - readiness/status widget or dashboard
   - future installer-style overlays
   - lightweight orchestration helpers that call into deterministic scripts rather than replacing them

4. **Deterministic shared tooling**
   - reusable npm support packages for logic shared by Pi skills, repo-local scripts, and GitHub Actions
   - reusable `lib/` modules for state discovery and interpretation
   - reusable `scripts/` for watch/review/fix mechanics
   - fixture-backed tests for the mechanical parts

## Initial opinionated assumptions

For the initial versions, it is acceptable to require:

- `pi`
- `pi-subagents`
- `gh`
- GitHub-hosted pull request workflows for remote loops
- repositories that can tolerate an opinionated PR/review/fix loop

The package may assume Pi-package installation and extension loading from the start.

Non-goals for the first phase:

- supporting every forge besides GitHub
- supporting every repo workflow convention
- producing a fully abstract workflow DSL
- making the first exported assets perfectly generic before shipping anything reusable

## Imported bootstrap material

Current imported sources:

- `skills/dev-loop/`
  - copied from `pi-image-drop/.pi/skills/dev-loop/`
  - includes templates, helper scripts, and skill-local test support
- `skills/copilot-dev-loop/SKILL.md`
  - copied from `repo-wiki`
- `agents/*.agent.md`
  - copied from `repo-wiki`

These are seed assets, not finished public interfaces.

## Current bootstrap contract

Until the package/override model is fully generalized, this repository should use the root-level directories as the source of truth:

- `skills/`
- `agents/`
- `docs/phases/`

And expose the Pi-facing assets through repo-local symlinks under:

- `.pi/skills -> ../skills`
- `.pi/agents -> ../agents`

This keeps the working tree usable with Pi immediately while avoiding duplicate copies of the same assets.

## Core design rules

### 1. Agents are role definitions, not workflow definitions

Agents should define:

- role
- scope boundaries
- judgment style
- expected outputs
- quality bar

Agents should **not** hardcode repository workflow policy such as:

- issue tracker conventions
- PR template rules
- exact merge policy
- exact Copilot handoff policy
- specific reviewer identity
- repo-specific documentation paths

### 2. Skills own the loop

Skills should define:

- sequencing
- state transitions
- required reads
- handoff decisions
- when to wait/watch
- what artifacts to log
- when to ask for confirmation
- how durable phase docs and ephemeral tmp artifacts relate

### 3. Scripts and shared library code should do the mechanical work

If a step can be handled deterministically, prefer:

- `lib/` helper modules
- `scripts/` entrypoints

Examples:

- PR discovery
- issue-to-PR linkage
- review-thread capture
- check-run normalization
- Copilot-review baseline capture
- watcher output formats
- stale-artifact cleanup
- restart-state discovery

### 4. Prefer native `gh ... watch` support when it fits the exact wait condition

For example:

- use `gh run watch` for known workflow run IDs

If `gh` does not natively watch the exact needed condition, use deterministic custom watchers instead of ad hoc shell polling.

### 5. The extension should stay thin

The extension should provide:

- doctor/setup commands
- lightweight widgets or overlays
- package-level status UX
- small orchestration glue

The extension should **not** become the main home for workflow mechanics that can live in deterministic scripts or shared library code.

### 6. Decide the install/override model early

Do not defer the package/override model until the end of the roadmap.

Before shared helpers and generalized agents harden the wrong assumptions, define the intended bootstrap and reuse contract:

- Pi package install is the primary target
- repo-local `.pi/` symlinks are an acceptable bootstrap/development mode
- repo-local overlays should override the shared defaults only where necessary
- asset path references inside skills and docs should not assume a single install mode forever

### 7. Shared logic belongs in a package-first support layer

Prefer a shared npm support package for logic that should work from Pi skills,
repo-local scripts, or GitHub Actions. Keep Pi-specific orchestration outside
that package.

Avoid duplicating:

- GitHub JSON parsing
- timeout policy
- watch-state interpretation
- actionable-thread detection
- artifact-path conventions
- phase/artifact mutation helpers
- CLI wrappers for deterministic helpers

## Target repository structure

```text
agents/
  coordinator.agent.md
  developer.agent.md
  docs.agent.md
  fixer.agent.md
  quality.agent.md
  review.agent.md

docs/
  IMPLEMENTATION_STATE.md
  IMPLEMENTATION_WORKFLOW.md
  phases/
    phase-0.md
    phase-1.md

packages/
  core/
    src/
    bin/
    test/

skills/
  dev-loop/
    SKILL.md
    package.json
    jest.config.mjs
    scripts/
    templates/
  copilot-dev-loop/
    SKILL.md

extension/
  index.ts
  checks.ts
  setup.ts
  ui/

lib/
  github/
  loop/
  agents/

scripts/
  github/
  loop/

test/
  fixtures/
  github/
  loop/
```

The exact layout can evolve, but the important separation is:

- durable planning docs
- agent definitions
- loop skills
- extension UX/package glue
- shared deterministic code
- test fixtures

## Consolidation roadmap

### Phase 0 — bootstrap, workflow convention, and inventory

- create this repository
- rename/package it as `pi-dev-loops`
- import the current local dev-loop assets
- import the current GitHub/Copilot loop skill
- import candidate reusable agent definitions
- scaffold a package extension
- document the intended architecture
- define the docs-first phase workflow convention
- record what is still repo-specific

Acceptance criteria:

- bootstrap assets exist in one repo
- imported sources are traceable
- the docs-first phase workflow convention is explicit in both repo docs and the local dev-loop skill
- a durable Phase 0 plan exists under `docs/phases/`
- the phase scaffold can create a durable phase doc plus tmp planning artifacts
- the next generalization steps are explicit without requiring broader normalization work yet

### Phase 1 — normalize the imported assets without changing intent

This phase must explicitly remove or classify imported repo-specific assumptions before the assets are treated as reusable.

#### Local dev loop

- keep the working deterministic helpers
- remove source-repo-specific naming where it blocks reuse
- audit templates for repo-specific wording
- ensure path references are relative and portable

#### Copilot dev loop

- keep the current workflow shape
- separate generic GitHub/Copilot behavior from repo-specific policy
- remove imported `repo-wiki` assumptions from required reads, trigger phrases, validation commands, and companion-skill references
- make timeout and watch policy explicit
- prefer deterministic helper scripts over prose-only workflow instructions where possible

#### Agents

Classify each imported agent:

- ready to globalize now
- reusable after moderate refactor
- keep local until split into base + overlay

Initial expectation:

- `developer`, `docs`, `quality` should become generic first
- `fixer` and `review` need refactoring to remove repo-specific process assumptions
- `coordinator` should likely split into a reusable base plus workflow-specific overlays

Mandatory policy-extraction pass:

For each imported asset, classify every non-trivial assumption as one of:

- reusable base behavior
- overlay-configurable policy
- source-repo-only behavior to remove

Specific imported blockers already known:

- `agents/review.agent.md` hardcodes reviewer identity and must be parameterized or removed before claiming reuse
- `skills/copilot-dev-loop/SKILL.md` contains `repo-wiki`-specific read paths, commands, and references that must be removed or converted into overlay policy
- `agents/coordinator.agent.md` currently encodes workflow policy that likely belongs in skills/scripts rather than in a generic role agent

Acceptance criteria:

- each imported asset has an explicit generalization status
- obvious hardcoded repo-specific assumptions are identified and classified
- the first reusable assets do not depend on source-repo-only paths or hardcoded reviewer identity

### Phase 2 — dedicated refiner agent and refinement contract

This phase should strengthen the local phase-refinement workflow before broader UX/package work continues.

Add a dedicated refiner agent and integrate it into the local dev loop so refinement produces complete acceptance criteria and definition-of-done lists.

Goals:

- add a dedicated `refiner` role for phase refinement
- make AC and DoD generation first-class refinement outputs
- preserve parallel fan-out/fan-in refinement where it adds value
- escalate RFC-worthy technical decisions through the coordinator instead of guessing through them
- define the RFC handoff team boundary as:
  - lead dev
  - specialized dev
  - systems architect

Acceptance criteria:

- a dedicated refiner agent exists and is clearly scoped to phase refinement
- the refiner requires complete acceptance-criteria and definition-of-done output
- the refiner escalates RFC-worthy technical decisions through the coordinator
- the coordinator-side contract names the RFC team boundary clearly
- the local dev-loop planning contract uses the refiner without collapsing coordinator responsibilities
- durable planning surfaces can carry stable definition-of-done output

### Phase 3 — package extension and setup UX

This phase should also define the runtime/build/test contract for the package.

Add an initial extension that can:

- register doctor/setup commands
- show readiness/status in a widget or overlay
- report whether `gh` and `pi-subagents` are available
- point users to the relevant skills and installation requirements

Acceptance criteria:

- package exposes a working extension entrypoint
- users can run a doctor/setup command from Pi
- the extension remains thin and mostly delegates to deterministic checks/helpers
- the runtime/build/test contract is explicit:
  - supported Pi/Node/`gh` versions
  - source-loaded vs built-distribution expectations
  - root-level vs per-skill test execution story

### Phase 4 — shared deterministic library and npm support package

Add reusable package/library modules for:

- GitHub issue/PR state discovery
- review-thread parsing
- actionable-comment detection
- workflow-run/check status normalization
- timeout policy
- loop artifact paths and cleanup
- loop restart/resume state

Acceptance criteria:

- repeated GitHub parsing logic is centralized
- at least one helper ships through a shared npm support package with both JS and CLI entrypoints
- watcher scripts consume shared library modules
- library outputs have stable machine-readable shapes

### Phase 5 — deterministic scripts

Add reusable `scripts/` entrypoints such as:

- `scripts/github/find-pr-for-issue.mjs`
- `scripts/github/capture-pr-state.mjs`
- `scripts/github/capture-review-threads.mjs`
- `scripts/github/watch-copilot-review.mjs`
- `scripts/github/watch-pr-rereview.mjs`
- `scripts/loop/clean-stale-artifacts.mjs`
- `scripts/loop/summarize-loop-state.mjs`

Acceptance criteria:

- common watch/inspection behavior can be run without re-implementing shell loops
- scripts prefer native `gh` watch support when possible and only use custom polling when necessary
- scripts are testable with fixtures

### Phase 6 — public release hardening

Now that the repository is public, add the minimum release-readiness pieces needed so outside users can evaluate and adopt it safely.

Goals:

- choose and add an explicit open-source license
- add baseline GitHub Actions CI for the supported Node versions
- make the public-repo quality gate explicit around the existing test suite
- document the release-readiness expectations so later packaging/reuse work builds on a stable baseline

Acceptance criteria:

- a top-level `LICENSE` file exists with the chosen license text
- `package.json` includes a matching SPDX `license` field
- a GitHub Actions workflow runs the repository test suite on push and pull request
- the initial CI baseline runs on an explicit Node 24 environment
- the public release baseline is reflected in the roadmap and implementation state docs

### Phase 7 — second-repo pilot

Before polishing the extension or broadening the package surface further, prove reuse in at least one unrelated repository.

Goals:

- install `pi-dev-loops` outside this bootstrap repo
- identify which assumptions still leak from the imported source repos
- validate the package/overlay contract in a real second codebase
- validate an early local-skill iteration path where downstream repos can improve local overrides without losing upstream compatibility
- use the findings to drive the remaining agent and skill cleanup

Acceptance criteria:

- one non-bootstrap repository can load the package and use at least one loop skill successfully
- second-repo breakages are documented and fed back into the roadmap
- the second-repo pilot produces concrete evidence about how local skill changes should coexist with upstream updates instead of being blindly overwritten

### Phase 8 — agent generalization

Refactor the imported agent definitions so they work for both:

- local dev loops
- async GitHub/Copilot loops

Likely work:

- remove repo-specific plan/document path assumptions from agent prompts
- remove hardcoded reviewer identity from `review`
- move PR lifecycle and Copilot policy out of agents and into skills/scripts
- preserve role-specific quality bars and output expectations

Acceptance criteria:

- role agents are workflow-agnostic
- loop-specific mechanics live outside the agent definitions

### Phase 9 — package and reuse strategy

Decide how this repo is consumed:

- direct clone + symlink
- Pi package install
- selective copying into `~/.pi/agent/`
- repo-local overlays on top of global defaults

Initial bias:

- use this repo as the source of truth
- install reusable skills globally
- let product repos override only what they must

Acceptance criteria:

- a documented install/override story exists
- local overrides and upstream updates have a documented reconciliation strategy rather than a blind overwrite model
- at least one reusable global workflow can be used from another repository without forking its definitions

## Testing strategy

Test the deterministic parts first.

Priority order:

1. shared library parsing/state tests
2. watcher script fixture tests
3. skill-support helper tests
4. end-to-end workflow dry-run fixtures where practical

Examples:

- parse review thread state from stored GraphQL/REST JSON
- determine whether a Copilot comment is actionable
- choose native `gh run watch` vs custom watcher path correctly
- clean stale artifacts without removing authoritative summaries
- restore/restart loop state from prior artifacts deterministically

## Open questions

- Should agents remain as plain markdown definitions only, or should some shared prompt fragments also move into deterministic templates or generated prompt builders? _(target: Phase 8)_
- How much of the GitHub/Copilot loop should stay skill-driven versus script-driven? _(target: Phase 5)_
- What is the right minimum package/install contract for global Pi reuse? _(target: Phase 3)_
- Should there be one generic coordinator, or a base coordinator plus loop-specific coordinator overlays? _(target: Phase 8)_
- How should repo-local policy overlays be layered on top of these global defaults without duplicating the whole asset? _(target: Phase 9)_
- How should dev-mode improvements discovered in downstream repos flow back into `pi-dev-loops`: local skill iteration only, patch exchange, or GitHub PRs to the source repo? _(target: Phases 7 and 9)_
- What extension/package tooling is needed so downstream repos can carry local skill changes while still incorporating upstream updates intelligently instead of blindly overwriting them? _(target: Phase 9)_

## Immediate next steps

1. use root `skills/` and `agents/` as the source of truth and expose them through repo-local `.pi/` symlinks
2. keep the imported assets intact as the bootstrap baseline while classifying repo-specific assumptions
3. remove the first known blockers to reuse:
   - hardcoded reviewer identity in `agents/review.agent.md`
   - `repo-wiki`-specific assumptions in `skills/copilot-dev-loop/SKILL.md`
4. design and integrate a dedicated refiner agent for phase-refinement work so planning/refinement can be delegated without overloading the coordinator
5. choose the public license and add `LICENSE` plus matching package metadata
6. add baseline GitHub Actions CI for the existing test suite
7. finish documenting the runtime/build/test and install/override contract
8. identify the first shared library modules to extract
9. move the first deterministic helper into a shared npm support package with a thin skill-local wrapper
10. add the first deterministic GitHub helper scripts
11. refactor the first three generic agents: `developer`, `docs`, `quality`

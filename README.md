# pi-dev-loops

Shared Pi workflow infrastructure for reusable local and remote development loops.

This repo is intended to become a reusable **Pi package** that bundles:

- generic role agents plus thin workflow entrypoint agents where needed
- reusable loop skills
- a small extension for status/doctor plus explicit skill install/update UX
- deterministic helper scripts
- shared library code for GitHub/review/watch state

Initial imported sources:

- local phased dev loop from `pi-image-drop`
- Copilot/GitHub loop from `repo-wiki`
- agent definitions from `repo-wiki`

## Current status

This is a bootstrap repo, not yet a polished reusable package.

The current contents are intentionally copied in with minimal normalization so they can be consolidated here without losing working behavior.

See `PLAN.md` for the migration and generalization plan.

## Initial assumptions

For the first implementation phase, this repo may be opinionated and require:

- `pi`
- `pi-subagents`
- `gh`
- GitHub-based workflows for remote loops

## Package intent

`pi-dev-loops` should eventually install as a Pi package that exposes:

- `skills/` for local and remote loop orchestration
- `extension/` for the `/dev-loops` Pi command plus shared status/doctor/install/update presentation
- `bin/pi-dev-loops.mjs` for the matching `pi-dev-loops` shell CLI
- deterministic `lib/` and `scripts/` shared by multiple skills

## Layout

- `agents/` — candidate global role agents
- `skills/` — local and remote dev-loop skills
- `extension/` — package extension and Pi-facing UI/doctor helpers
- `cli/` and `bin/` — shell CLI wrapper for the shared deterministic dev-loops core
- `lib/` — shared deterministic library code
- `scripts/` — deterministic workflow helpers

## Imported assets

- `skills/dev-loop/` — copied from `pi-image-drop/.pi/skills/dev-loop/` without `node_modules/`
- `skills/copilot-dev-loop/SKILL.md` — copied from `repo-wiki/.pi/skills/copilot-dev-loop/SKILL.md`
- `agents/*.agent.md` — copied from `repo-wiki/.pi/agents/`

## Near-term goal

Turn these imported assets into a coherent, reusable toolkit where:

- agents are primarily workflow-agnostic role definitions, with thin workflow entrypoint agents allowed when they only load a skill and defer policy to it
- skills orchestrate loops
- deterministic scripts and shared library code handle as much mechanical work as possible
- the extension provides status/doctor plus explicit skill install/update UX while the package CLI exposes the same deterministic command family for shell users
- the CLI's packaged-skill readiness checks currently inspect the canonical repo/system install roots, while the extension can reflect Pi's live `/skill:*` registrations after refresh/restart
- repo-local overlays can specialize behavior without forking the core workflow stack

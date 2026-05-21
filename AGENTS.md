# AGENTS.md

## Project contract

This repository now prefers the GitHub remote-loop workflow for active implementation and release work.

- Use `dev-loop-unified` as the primary public entrypoint — it routes deterministically to the correct internal strategy based on user intent and current state.
- The old entrypoints remain as compatibility shims:
  - `copilot-dev-loop` routes to the Copilot PR follow-up strategy
  - `copilot-autopilot` routes to the issue intake strategy
  - `dev-loop` routes to the local implementation strategy

Users should prefer intent-based commands (e.g., "start dev loop on issue #83", "continue PR 85") over choosing an internal loop name directly.

These skills may be provided repo-locally or globally; this contract does not assume a local skill path.

## Working agreement

- Work test-first for all non-trivial logic.
- Maintain at least 90% coverage for lines, statements, functions, and branches.
- Implement one phase at a time.
- Use fan-out / fan-in / review / merge before implementing each phase.
- Default phase and issue refinement to multiple parallel variants before converging on a merged plan; do not rely on a single-plan synthesis when fan-out is practical.
- Keep logs under `tmp/` in deterministic phase-scoped paths.
- Use feature branches and small commits only after local verification.
- For public-facing or release-bound changes, prefer GitHub issues/PRs/CI over direct local-main finalization.
- Use detailed structured PR descriptions, not thin placeholder summaries. At minimum include: change summary, scope/context, explicit acceptance criteria, explicit definition of done, and explicit non-goals.
- In PR review/fix loops, do not stop at local code changes alone: after an accepted fix is pushed, reply to the addressed review comments with the resolving commit reference and resolve the corresponding threads when genuinely satisfied.
- Do not merge directly to `main` without review when a PR-based remote loop is practical.

## Core guard rails

- KISS
- SRP
- YAGNI
- strict TypeScript
- thin runtime glue
- no production reliance on Pi private internals

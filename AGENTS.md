# AGENTS.md

## Project contract

This repository now prefers the GitHub remote-loop workflow for active implementation and release work.

- Use `copilot-dev-loop` as the primary workflow when work should move through GitHub branches, pull requests, CI, and review.
- Use `dev-loop` only when the user explicitly wants a local phase-based implementation path.

These skills may be provided repo-locally or globally; this contract does not assume a local skill path.

## Working agreement

- Work test-first for all non-trivial logic.
- Maintain at least 90% coverage for lines, statements, functions, and branches.
- Implement one phase at a time.
- Use fan-out / fan-in / review / merge before implementing each phase.
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

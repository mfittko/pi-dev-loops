# AGENTS.md

## Project contract

This repository now uses `dev-loop` as the single public workflow entrypoint.

- Route `dev-loop` deterministically to the GitHub-first internal strategies when work should move through GitHub branches, pull requests, CI, and review.
- Route `dev-loop` to the local implementation strategy only when the user explicitly wants a local phase-based path.
- Treat `copilot-dev-loop` and `copilot-autopilot` as internal strategy seams behind `dev-loop`, not as equal public entrypoints and not as default compatibility commitments.
- This is a greenfield, declutter-first repo: when workflow or agent guidance can be simplified safely, prefer removing or demoting extra surface area over preserving it just in case.

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

## Dev loop defaults

- Use the `dev-loop` skill in **dev mode by default** for all local implementation work.
- After every completed async dev loop run, run a **behavioral review**: inspect what the loop did, whether it followed the working agreement, what it got right and where it drifted, and record any corrective notes before the next loop starts.
- The behavioral review should be brief but honest — it is not a formality. If the loop made a bad decision or skipped a step, say so explicitly.

## Core guard rails

- KISS
- SRP
- YAGNI
- for workflow surface and agent guidance decisions, YAGNI-driven simplification takes priority over preserving speculative compatibility or extra entrypoint names
- strict TypeScript
- thin runtime glue
- no production reliance on Pi private internals

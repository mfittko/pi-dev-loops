# AGENTS.md

## Project contract

This repository uses `dev-loop` as the single public workflow entrypoint.

For the canonical public routing and shorthand contract, see `docs/public-dev-loop-contract.md`.

Repo-specific posture summary:
- prefer the GitHub-first routed path when work should move through GitHub branches, pull requests, CI, and review
- use the local implementation strategy only when the user explicitly wants a local phase-based path
- treat `copilot-dev-loop` and `copilot-autopilot` as internal routed seams behind `dev-loop`, not equal public entrypoints
- this is a greenfield, declutter-first repo: when workflow or agent guidance can be simplified safely, prefer removing or demoting extra surface area over preserving it just in case

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

## Formal dev mode vs required post-run retrospective

These are related but distinct requirements:

| Requirement | Scope | Enforcement |
|---|---|---|
| **Formal local dev mode** | Local implementation/self-improvement phases; explicitly scoped in `skills/dev-loop/SKILL.md` | Skill procedure; operator choice |
| **Required post-run behavioral retrospective** | Every qualifying async GitHub-first `dev-loop` completion in this repo (copilot PR follow-up, issue intake) | Machine-checkable enforcement seam (see below) |

Routed GitHub-first async `dev-loop` runs in this repo **do not** need to be in full formal local dev mode, but they **do** require the post-run behavioral retrospective checkpoint.

### Retrospective checkpoint enforcement

The enforcement seam is:

1. **Detection**: `.pi/extensions/dev-loop-behavioral-review.ts` detects "Background task completed: dev-loop" and writes `.pi/dev-loop-retrospective-checkpoint.json` with `state: "required"`.
2. **Review**: the extension also sends the behavioral review prompt (as before).
3. **Recording**: after completing the review, write the checkpoint file with:
   - `{ "state": "complete", "completedAt": "<ISO>", "notes": "<summary>" }` — review done, or
   - `{ "state": "skipped", "skippedAt": "<ISO>", "reason": "<reason>" }` — explicitly skipped.
4. **Gate**: the next `dev-loop` start/resume reads the checkpoint file, maps it to `RETROSPECTIVE_CHECKPOINT_STATE`, and calls `evaluateRetrospectiveGate` from `@pi-dev-loops/core/loop/retrospective-checkpoint`. If the state is `missing`, the gate fails closed and returns a `needs_reconcile` result instead of proceeding.

A fresh session can always determine the retrospective status by reading `.pi/dev-loop-retrospective-checkpoint.json`:
- File absent → `none` (no qualifying completion; no requirement)
- `state: "required"` → `missing` (retrospective pending)
- `state: "complete"` → `complete` (satisfied)
- `state: "skipped"` → `skipped` (satisfied)

## Core guard rails

- KISS
- SRP
- YAGNI
- for workflow surface and agent guidance decisions, YAGNI-driven simplification takes priority over preserving speculative compatibility or extra entrypoint names
- strict TypeScript
- thin runtime glue
- no production reliance on Pi private internals

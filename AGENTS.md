# AGENTS.md

## Project contract

This repository uses `dev-loop` as the single public workflow entrypoint.

For the canonical public routing and shorthand contract, see [Public Dev Loop Contract](skills/docs/public-dev-loop-contract.md).

Canonical skill-required docs rule:
- any contract doc that is required by skills, read by skills, or intended to ship as part of the installed skill/runtime surface must live canonically under `skills/docs/`
- do not create a second canonical copy of a skill-required contract under `docs/`
- `docs/` may link to canonical skill docs for index/discovery purposes, but must not become a parallel source of truth for those contracts
- when adding or moving a skill-required contract, update skill references to the `skills/docs/` path and keep any `docs/` reference as a thin pointer only if needed

Repo-specific posture summary:
- prefer the GitHub-first routed path when work should move through GitHub branches, pull requests, CI, and review
- use the local implementation strategy only when the user explicitly wants a local phase-based path
- `dev-loop` is the only public workflow entrypoint; keep one concise canonical workflow description instead of parallel skill surfaces
- this is a greenfield, declutter-first repo: when workflow or agent guidance can be simplified safely, prefer removing or demoting extra surface area over preserving it just in case
- this repo has no default compatibility requirements: compatibility is out of scope unless the user explicitly asks for a specific compatibility target in the current conversation
- do not preserve backwards compatibility, legacy aliases, compatibility wrappers, or duplicate prompt/docs surfaces unless the user explicitly asks for that specific compatibility in the current conversation

These skills may be provided repo-locally or globally; this contract does not assume a local skill path.

## Working agreement

- Work test-first for all non-trivial logic.
- Maintain at least 90% coverage for lines, statements, functions, and branches.
- Implement one phase at a time.
- Use fan-out / fan-in / review / merge before implementing each phase.
- Default phase and issue refinement to multiple parallel variants before converging on a merged plan; do not rely on a single-plan synthesis when fan-out is practical.
- Standard refinement chain pattern: run parallel fan-out with the `refiner` agent, then run the consolidation/fan-in synthesis as a `refiner` agent too.
- Never route review-only comparison, synthesis, or consolidation steps through `dev-loop` + `local-implementation`; reserve that path for actual implementation/edit work only.
- Keep logs under `tmp/` in deterministic phase-scoped paths.
- Use feature branches and small commits only after local verification.
- Use `npm run verify` as the default repo-level local verification path when a full local validation pass is warranted.
- For public-facing or release-bound changes, prefer GitHub issues/PRs/CI over direct local-main finalization.
- Use detailed structured PR descriptions, not thin placeholder summaries. At minimum include: change summary, scope/context, explicit acceptance criteria, explicit definition of done, and explicit non-goals.
- In PR review/fix loops, do not stop at local code changes alone: after an accepted fix is pushed, reply to the addressed review comments with the resolving commit reference and resolve the corresponding threads when genuinely satisfied.
- Do not merge directly to `main` without review when a PR-based remote loop is practical.

## Dev loop defaults

Repo-local workflow defaults are configured under `.pi/dev-loop/overrides.yaml` `workflow.*`. In this repo, that override is the source of truth for opting into:
- `workflow.requireRetrospective: true`
- `workflow.requireDraftFirst: true`
- `workflow.devModeDefault: true`

Current behavior notes:
- Use the `dev-loop` skill in **dev mode by default** for local implementation work in this repo.
- After every completed async dev loop run, run a **behavioral review**: inspect what the loop did, whether it followed the working agreement, what it got right and where it drifted, and record any corrective notes before the next loop starts.
- The behavioral review should be brief but honest — it is not a formality. If the loop made a bad decision or skipped a step, say so explicitly.

## Formal dev mode vs required post-run retrospective

These are related but distinct requirements:

| Requirement | Scope | Enforcement |
|---|---|---|
| **Formal local dev mode** | Local implementation/self-improvement phases; explicitly scoped in [Dev Loop Skill](skills/dev-loop/SKILL.md) | Skill procedure; operator choice |
| **Required post-run behavioral retrospective** | Every qualifying async GitHub-first `dev-loop` completion in this repo (copilot PR follow-up, issue intake) | Machine-checkable enforcement seam |

Routed GitHub-first async `dev-loop` runs in this repo do **not** need to be in full formal local dev mode, but they **do** require the post-run behavioral retrospective checkpoint when `workflow.requireRetrospective` is enabled. This repo enables that policy through `.pi/dev-loop/overrides.yaml`.

Authoritative checkpoint details live in [Retrospective Checkpoint Contract](skills/docs/retrospective-checkpoint-contract.md).

Practical rule:
- qualifying async `dev-loop` completions write `.pi/dev-loop-retrospective-checkpoint.json`
- the next qualifying `dev-loop` start/resume must honor that checkpoint gate
- complete or explicitly skip the retrospective before starting the next qualifying run

## Core guard rails

- KISS
- SRP
- YAGNI
- for workflow surface and agent guidance decisions, YAGNI-driven simplification takes priority over preserving speculative compatibility or extra entrypoint names
- one concise canonical version of each workflow contract, prompt surface, and operator path; delete superseded variants instead of keeping them around for comfort
- no backwards-compatibility-by-default posture: do not add or preserve legacy names, aliases, compatibility shims, compatibility entrypoints, or duplicate docs/tests unless that compatibility is explicitly required and approved
- when choosing between a clean canonical replacement and legacy support, choose the clean canonical replacement
- strict TypeScript
- thin runtime glue
- no production reliance on Pi private internals

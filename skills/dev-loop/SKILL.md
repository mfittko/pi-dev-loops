---
name: dev-loop
description: Use for phased local development in this repo when the user says to start or continue work. Reads project docs, resumes from the next unfinished phase, runs a fan-out/fan-in/review/merge planning loop for that phase only, logs structured artifacts under tmp/, records subagent summaries, writes tests first, validates locally, updates implementation state, and stops at phase boundaries unless explicitly told to continue.
---

# Local Implementation Loop

This skill is the execution engine for phased implementation in this repository.

Use it when the user says things like:
- start implementation
- continue implementation
- implement the next phase
- resume the local implementation loop
- start implementation in dev mode
- continue implementation in dev mode

Do not assume GitHub PRs, issues, or remote review workflows. This repo is local-first.

## Minimal required project inputs

For a new project, the only required inputs are:

1. `PLAN.md`
2. this skill at `.pi/skills/dev-loop/SKILL.md`

Everything else is optional and may be bootstrapped by this skill.

## Required read order

Before doing any planning or coding:

1. read `PLAN.md`
2. read this skill
3. if `AGENTS.md` exists, read it
4. if `docs/IMPLEMENTATION_STATE.md` exists, read it
5. if `docs/IMPLEMENTATION_WORKFLOW.md` exists, read it

Treat missing optional files as normal bootstrap conditions, not as errors.

## Primary execution rules

- Implement **one phase at a time**.
- Do not refine later phases in detail before the current phase is complete.
- Work **test-first** for all non-trivial logic.
- Maintain **90% coverage** thresholds.
- Log detailed iteration artifacts under `tmp/` using the required structure below.
- Keep source-of-truth decisions in docs, but keep detailed execution artifacts in `tmp/`.
- When a phase changes durable product truth in ways `PLAN.md` should express (for example command surface, accepted product decisions, resolved open questions, or scope changes), update `PLAN.md` before closing the phase.
- Do implementation work on a dedicated local branch, not directly on `main`.
- If the repo has no commits yet, still create the working branch first so the first commits land off `main`; only move `main` forward after review and validation.
- Use small atomic local commits as progress checkpoints whenever a coherent slice is green and reviewable.
- Before a branch is considered ready, run a full parallel review / fix loop, apply accepted fixes, rerun validation, and then merge the reviewed branch back into local `main`.
- When subagents are used, log what each subagent was asked to do and what it concluded.
- If `PLAN.md` is too rough or ambiguous to safely start the current phase, do not guess: run a clarification/interview step with the user first.

## Deterministic logging structure

Treat `tmp/` as both:
- a human-readable audit trail
- a machine-friendly input for fresh-context continuation and later process improvement

Maintain these paths:

- `tmp/phases/index.json`
- `tmp/phases/phase-x/manifest.json`
- `tmp/phases/phase-x/variant-a.md`
- `tmp/phases/phase-x/variant-b.md`
- optional `tmp/phases/phase-x/variant-c.md`
- `tmp/phases/phase-x/merged-plan.md`
- `tmp/phases/phase-x/review.md`
- `tmp/phases/phase-x/summary.md`
- `tmp/phases/phase-x/retrospective.md`
- `tmp/phases/phase-x/subagents/`
- `tmp/phases/phase-x/bash-exit-1.jsonl`
- in dev mode: `tmp/phases/phase-x/dev-mode-context.json`
- in dev mode: `tmp/phases/phase-x/dev-mode-review.md`
- in dev mode: `tmp/phases/phase-x/dev-mode-skill-changes.md`

Use the templates in `templates/`.

Use deterministic helper scripts from `scripts/` for repeatable support tasks such as phase initialization, phase-file updates, template materialization, bash-exit logging, and dev-mode context collection. Paths referenced from this skill are relative to the skill directory and should be treated as directly available to the skill.

## Bootstrap missing support files

If these files are missing, create them from `templates/` before continuing:

- missing `AGENTS.md` -> create from `templates/bootstrap-agents.md`
- missing `docs/IMPLEMENTATION_STATE.md` -> create from `templates/bootstrap-implementation-state.md`
- missing `docs/IMPLEMENTATION_WORKFLOW.md` -> create from `templates/bootstrap-implementation-workflow.md`
- missing `tmp/phases/index.json` -> create or reinitialize it

The bootstrap files are support infrastructure. `PLAN.md` remains the product source of truth.

## Plan sufficiency check

Before phase planning, check whether `PLAN.md` contains enough information to proceed safely.

At minimum, the current phase needs enough information to infer:
- the goal of the phase
- the main constraints
- the intended scope or boundaries
- at least rough acceptance criteria or success shape

If that information is missing or too ambiguous, pause implementation and run a clarification/interview step.

## Clarification / interview step

When the plan is insufficient, use one of these modes:

### Mode A — interactive clarification
- ask only the missing high-value questions needed to safely refine the current phase
- prefer a short interview or wizard-style sequence over one giant question dump
- record the answers in `tmp/phases/phase-x/clarification.md`
- update `PLAN.md` only if the clarified information is durable product/project truth
- update `docs/IMPLEMENTATION_STATE.md` if the clarification changes the next phase boundary

### Mode B — auto clarification
Use this when the user explicitly asks for an auto option, says to just proceed, or is clearly optimizing for speed over discussion.

In auto mode:
- infer the smallest safe defaults for the current phase only
- prefer conservative assumptions over ambitious ones
- never auto-resolve product, security, or architecture decisions that could materially change scope
- write all assumptions to `tmp/phases/phase-x/clarification.md`
- mark them clearly as `auto-assumptions`
- surface the assumptions in the phase review so they can be challenged later
- if an assumption is too risky to make safely, stop and ask the user anyway

Do not begin fan-out planning until the current phase is sufficiently specified, either by user clarification or safe auto-assumptions.

## Determine where to resume

Read `docs/IMPLEMENTATION_STATE.md` and identify the next unfinished phase.

If `tmp/phases/index.json` exists, use it as a fast index for prior artifacts.
If the state file and the tmp index disagree, trust the docs first and note the mismatch in the phase review log.

If the state file is ambiguous, resolve ambiguity conservatively:
- prefer the earliest clearly unfinished phase
- do not skip ahead
- note the ambiguity in the phase review log under `tmp/`
- if this is a first-run bootstrap, start from the earliest phase implied by `PLAN.md`

## Phase planning loop

For the **current phase only**, run this loop before implementation.

### 1. Create or update the phase directory under tmp

Use a path like:
- `tmp/phases/phase-0/`
- `tmp/phases/phase-1/`

Create or update:
- `tmp/phases/phase-x/manifest.json`
- `tmp/phases/index.json`

Prefer the deterministic helper:
- `scripts/init-phase.mjs`

Use `scripts/phase-files.mjs` only when you need a narrower manifest/index update without regenerating the standard phase-planning scaffold.

### 2. Read the previous phase's learning before planning the next one

If a previous phase exists, read:
- its `summary.md`
- its `retrospective.md`
- any relevant subagent summaries

Use those lessons to improve the current phase plan.

### 3. Fan out short plan variants

Write 2-3 short variants:
- `variant-a.md` = smallest safe implementation
- `variant-b.md` = best practical UX/developer-experience option within phase scope
- `variant-c.md` = safest boundary/risk-reduction option when useful

When subagents are available, the default fan-out path should use **parallel fresh-context subagents** so the variants are independently generated rather than serially contaminated by one another.

Use the template in `templates/phase-variant.md`.

Each variant should cover only:
- scope for this phase
- files/modules touched
- tests to add first
- implementation order
- acceptance criteria
- risks/non-goals

If subagents generate the variants:
- run them in parallel with clean context when practical
- save each raw subagent output under `tmp/phases/phase-x/subagents/raw/`
- then write the human-oriented `variant-a.md` / `variant-b.md` / `variant-c.md` files from those raw outputs

Update `manifest.json` with the planned artifact list and current status.

### 4. Fan in to a merged phase plan

Write:
- `tmp/phases/phase-x/merged-plan.md`

Use the template in `templates/merged-phase-plan.md`.

The merged plan must include:
- exact scope for this phase
- explicit non-goals
- tests to write first
- implementation order
- validation steps
- acceptance criteria

### 5. Review the merged phase plan adversarially

Write:
- `tmp/phases/phase-x/review.md`

Use the template in `templates/review.md`.

The review must check for:
- overreach beyond phase scope
- KISS/SRP/YAGNI violations
- missing tests
- weak validation
- unclear module boundaries
- hidden coupling to Pi runtime internals
- ambiguous acceptance criteria

If the review finds real issues, revise the merged plan and briefly update the review.

### 6. Only then start implementation

Do not begin coding before the merged phase plan has passed review.
Update `manifest.json` to show that phase implementation has started.

## Subagent summary logging

If subagents are used for planning, review, research, or implementation support:

Create one summary file per subagent run under:
- `tmp/phases/phase-x/subagents/`

Recommended naming:
- `001-planner.md`
- `002-reviewer-correctness.md`
- `003-reviewer-maintainability.md`
- `004-worker-followup.md`

Each summary should record:
- agent name
- whether it was sync or async
- task/prompt summary
- why it was used
- main findings or output
- files or artifacts it influenced
- whether its advice was accepted, partially accepted, or rejected
- run id if available
- raw output path if output was saved separately

If the subagent ran asynchronously, update its summary when results arrive so fresh sessions can understand what happened without replaying the whole conversation.

## Implementation loop for the phase

After the phase plan passes review:

1. Write or update tests first.
2. Implement only enough code for the current phase.
3. Run local validation:
   - `npm run check`
   - `npm test`
   - `npm run test:coverage`
4. Review the implementation against the merged phase plan.
5. Run a full parallel review / fix loop on the branch before merge readiness:
   - use at least two focused review passes in parallel when practical
   - when reviewer subagents stumble on raw source-tree reads (for example unresolved build artifacts or import assumptions), generate a deterministic diff/review artifact under `tmp/` and have reviewers inspect that artifact instead of the raw file set
   - synthesize actionable findings
   - apply accepted fixes on the same branch
   - rerun validation after fixes
   - log review artifacts and subagent summaries under `tmp/`
6. Update `PLAN.md` when the phase changed durable product truth, resolved an open question, or made the shipped command/behavior surface more concrete.
7. Write `tmp/phases/phase-x/summary.md` using `templates/phase-summary.md`.
8. Write `tmp/phases/phase-x/retrospective.md` using `templates/retrospective.md`.
9. Update `tmp/phases/phase-x/manifest.json` and `tmp/phases/index.json`.
10. Update `docs/IMPLEMENTATION_STATE.md`.
11. If authorized, make sure the phase branch history is captured with atomic commits and merge the fully reviewed branch back into local `main`.

## Retrospective requirements

The retrospective must capture:
- what worked well in the local dev loop
- what caused friction or waste
- whether the fan-out/fan-in/review loop improved the phase
- what should change in the skill or workflow next time
- what a fresh session should know before the next phase

This is the infrastructure for self-improvement. Do not skip it.

## Dev mode

Dev mode is for improving the local implementation loop itself while using it.

Trigger it when the user explicitly asks for dev mode, self-improvement mode, or says they want the skill to refine itself as it goes.

In dev mode, after the normal phase summary and retrospective are written, run one extra bounded self-improvement pass before moving on:

1. collect a deterministic context bundle for the phase using:
   - `scripts/dev-mode-context.mjs`
   - output to `tmp/phases/phase-x/dev-mode-context.json`
2. review the phase artifacts and logs with emphasis on the skill itself:
   - planning quality
   - review quality
   - validation friction
   - bash exit-code-1 patterns
   - places where deterministic tooling should replace ad hoc work
3. write `tmp/phases/phase-x/dev-mode-review.md`
4. if the review finds worthwhile skill/workflow improvements, patch only the skill-support surface:
   - `.pi/skills/dev-loop/SKILL.md`
   - `docs/IMPLEMENTATION_WORKFLOW.md`
   - `templates/`
   - `scripts/`
   - skill-local test/config files
5. write `tmp/phases/phase-x/dev-mode-skill-changes.md`
   - if no changes were needed, say so explicitly
6. if skill scripts or deterministic tooling changed, rerun the skill-local tests
7. stop after this bounded self-improvement pass; do not recurse into endless self-editing loops

Dev mode is still phase-bounded. It improves the loop around the completed phase; it does not authorize work on the next product phase.

## tmp/ logging requirements

At minimum, each phase should leave behind:
- `manifest.json`
- `variant-a.md`
- `variant-b.md`
- optional `variant-c.md`
- `merged-plan.md`
- `review.md`
- `summary.md`
- `retrospective.md`
- `bash-exit-1.jsonl` when any bash call during the phase exited with code `1`
- `clarification.md` when a plan-sufficiency interview or auto-clarification step was needed
- subagent summaries when subagents were used
- in dev mode: `dev-mode-context.json`, `dev-mode-review.md`, and `dev-mode-skill-changes.md`

Also log validation output summaries and notable decisions if they help evaluate the local dev loop later.

Additionally, append every bash call that exits with code `1` to:
- `tmp/phases/phase-x/bash-exit-1.jsonl`

Use the deterministic helper:
- `scripts/log-bash-exit-1.mjs`

Each line should be one JSON object with at least:
- `timestamp`
- `phase`
- `cwd`
- `command`
- `exitCode`
- `purpose`
- `summary`

If useful, also include truncated `stdout` and `stderr` fields or a path to a larger saved artifact. This log is for improving the local dev loop itself, so do not skip it just because the command was exploratory.

## Stop conditions

Stop after the current phase when:
- the current phase is implemented and validated
- the next step would require refining the next phase
- a decision requires user or coordination/main-agent approval
- validation fails in a way that needs a direction change

## Branch / review / merge policy

- Do not implement directly on `main`.
- Start or switch to a dedicated local working branch before the first mutating step.
- If the repository is unborn (no commits yet), still create the working branch first and make the initial atomic commits there.
- Use atomic local commits to log progress, but only for coherent reviewable slices.
- Before merging, run a full parallel review / fix loop and resolve accepted findings on the same branch.
- Rerun validation after review-driven fixes.
- Merge the fully reviewed, locally validated branch back into local `main` when authorized.

## Commit policy

- Do not commit speculative work.
- Do not commit before the relevant validation for that slice passes.
- Keep commits small and phase-bounded.
- Do not leave completed phase work stranded off `main`; once the reviewed branch is ready and authorized, merge it locally.
- Commit only when the coordination/main agent has decided the slice or phase is ready.

## Anti-patterns

Do not:
- assume a project must already have `AGENTS.md`, `docs/IMPLEMENTATION_STATE.md`, or `docs/IMPLEMENTATION_WORKFLOW.md`
- guess through missing plan details when a short clarification step would resolve them
- implement multiple future phases in one pass
- skip the fan-out/fan-in/review loop
- treat rough notes as implementation authorization
- expand scope because a helper may be useful later
- rely on Pi private internals when public hooks exist
- skip updating `docs/IMPLEMENTATION_STATE.md`
- skip writing `tmp/` artifacts
- use subagents without leaving readable summaries of what they did

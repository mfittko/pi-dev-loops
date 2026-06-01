---
name: dev-loop
description: >-
  Use as the single public dev-loop entrypoint. It reads the canonical current
  state and routes deterministically to the correct internal strategy: local
  phased implementation, issue-first GitHub/Copilot intake, PR follow-up,
  reviewer/fixer work, wait/watch, or final approval. When the selected
  strategy is local implementation, it resumes the next unfinished phase, uses
  the refiner for phase refinement, runs a fan-out/fan-in/review/merge planning
  loop for that phase only, logs structured artifacts under tmp/, records
  subagent summaries, writes tests first, validates locally, updates
  implementation state, and stops at phase boundaries unless explicitly told to
  continue.
compatibility: Pi skill for git-based repositories with Node.js/npm and optional subagent support.
allowed-tools: read bash edit write subagent review_loop
user-invocable: true
---

# Unified Dev Loop

This skill is the public `dev-loop` façade for this repository. It should route user intent from canonical state without making the user choose internal strategy names up front.

## First-slice public routing contract

The authoritative contract is `skills/docs/public-dev-loop-contract.md`; the executable evaluator is exported as `@pi-dev-loops/core/loop/public-dev-loop-routing` and lives in the source repository at `packages/core/src/loop/public-dev-loop-routing.mjs`.
For UI validation under `dev-loop`, see `docs/ui-validation-contract.md`, `docs/ui-smoke-harness.md`, `docs/ui-artifact-contract.md`, and `docs/ui-designer-review-loop.md`.

Required installed runtime contract docs for this skill are the shared bundled copies under `../docs/` from this skill directory:
- `../docs/public-dev-loop-contract.md`
- `../docs/retrospective-checkpoint-contract.md`
- `../docs/conductor-pr-projection-contract.md`

For installed packaged copies of this skill, read those bundled `../docs/` files from the installed skill layout instead of assuming a source-repository checkout is present. If any required bundled contract doc is missing from the installed skill layout, treat that as a packaging/installer bug.
When runtime package resolution is available, prefer exported `@pi-dev-loops/core/*` subpaths for active runtime logic. Conductor PR projection is currently source-only rather than a published runtime export, so projection / closeout work should use `packages/core/src/loop/conductor-pr-projection.mjs` from the source repository or the bundled installed-skill copy instead of assuming an `@pi-dev-loops/core/...` subpath exists.

Operational summary:
- route from the canonical current state through the shared gate contract before choosing any internal strategy; prefer the exported `DEV_LOOP_GATE` / `PUBLIC_DEV_LOOP_GATE_CONTRACT` semantics over restating route families ad hoc
- keep any specialized Copilot behavior behind `dev-loop` as internal routed logic rather than parallel user-invocable workflow entrypoints
- when the routed strategy is not local implementation, stop the local-phase procedure below and hand off instead of forcing the request into a local-only path
- for status/progress/readiness/merge-state/next-step questions, resolve authoritative active artifact identity + artifact state + loop state first (for example via `resolveAuthoritativeDevLoopStatus`); for issue targets, authoritative identity resolution must include explicit issue↔PR linkage resolution (for example via `detect-linked-issue-pr.mjs`) before saying there is no open linked PR; when that resolution reports an open linked PR, treat it as the single canonical artifact for the issue and reuse it instead of opening another PR; then answer with explicit artifact identity fields; if unresolved, fail closed to reconcile/unknown

Authority boundary for this skill:
- this skill owns the local phase procedure and artifact discipline when the routed strategy is local implementation
- it summarizes the public routing contract, and it does not redefine the shipped runtime semantics of helper CLIs, shared loop logic, or extension commands
- when helper behavior changes, update the relevant code/tests and contract docs in addition to any skill guidance that references them

Use it when the user says things like:
- start dev loop on issue 86
- continue dev loop on PR 88
- continue the current dev loop
- auto dev loop on issue 112
- what state is the dev loop in?
- start implementation
- continue implementation
- implement the next phase
- resume the local implementation loop
- start implementation in dev mode
- continue implementation in dev mode

Shorthand issue-based auto trigger contract:
- treat `auto dev loop on issue 112` as the public `dev-loop` intent `auto_continue_current` after authoritative current-state resolution
- continue through the normal GitHub/Copilot loop until the next genuine stop condition or the final human approval gate
- stop at the final human approval gate by default unless merge was explicitly authorized

## Minimal required project inputs

For a new project, the only required inputs are:

1. `PLAN.md`
2. this skill's `SKILL.md`

Everything else is optional and may be bootstrapped by this skill.

## Required startup reads

Read only what the current routed step actually needs.

### GitHub-first routed requests (`issue_intake`, `copilot_pr_followup`, `reviewer_fixer`, `wait_watch`, `final_approval`)

Before acting on a GitHub-first issue/PR request:

1. read this skill
2. if `AGENTS.md` exists, read it first as the repo constitution / working agreement
3. read `../docs/public-dev-loop-contract.md`
4. if the current step depends on async start/resume/status or retrospective enforcement, read `../docs/retrospective-checkpoint-contract.md`
5. read the relevant GitHub issue or PR
6. inspect the actual validation/runtime surface needed for the current step (`package.json`, CI/workflows, touched files, helper contracts)
7. when GitHub-first refinement produces multiple bounded child slices, prefer real GitHub sub-issue trees as the durable execution structure; keep parent issue bodies lean once the tree exists and use plain related-issue references when no tree is warranted

### Local implementation routed requests (`local_implementation`)

Before local phase planning or coding:

1. read this skill
2. if `AGENTS.md` exists, read it
3. read `PLAN.md`
4. if `docs/IMPLEMENTATION_WORKFLOW.md` exists, read it
5. if `docs/IMPLEMENTATION_STATE.md` exists, read it
6. if `docs/phases/phase-x.md` exists for the active phase, read it

Treat missing optional files as normal bootstrap conditions, not as errors.

### Tracker-backed local implementation (`local_implementation` with tracker issue input)

When a `local_implementation` session targets a tracker issue (GitHub `owner/repo#N`, Shortcut `sc#N`, Jira `PROJ-N`) whose body carries a spec, the tracker issue is the canonical spec source. This is an input-source variant, not a new routing mode.

Before local phase planning or coding:

1. read this skill
2. if `AGENTS.md` exists, read it
3. resolve the tracker spec — use `scripts/loop/resolve-tracker-spec.mjs --issue <N> [--repo <owner/repo>]` for GitHub issues, or the equivalent tracker adapter for Shortcut/Jira
4. if the resolved spec is not spec-bearing (no summary, scope, or acceptance criteria), fall back to full local mode or ask for clarification
5. if `docs/phases/phase-x.md` exists for the active phase, read it **as a thin pointer only** — the tracker issue body is the authoritative spec; do not treat the phase doc as the source of truth
6. optionally read `docs/IMPLEMENTATION_STATE.md` and `docs/IMPLEMENTATION_WORKFLOW.md` for repo context

Key differences from full local mode:
- the tracker issue body replaces `docs/phases/phase-x.md` as the canonical spec
- `docs/phases/phase-x.md` is a thin pointer (optional); use `scripts/loop/resolve-tracker-spec.mjs` or the `generateThinPhaseDoc()` helper to create it
- `PLAN.md` is not required reading for tracker-backed sessions
- state sync: update the issue with a comment when the phase advances
- the bootstrap-files rule does not apply — do not create a full phase doc from templates when a tracker spec already exists

Authoritative contract: `../docs/tracker-backed-local-contract.md`

## Primary execution rules

- Implement **one phase at a time**.
- Do not refine later phases in detail before the current phase is complete.
- Use the `refiner` agent for phase-refinement work when subagents are available; keep the coordinator as the escalation and decision owner when RFC-worthy technical decisions appear.
- Work **test-first** for all non-trivial logic.
- Maintain **90% coverage** thresholds.
- Log detailed iteration artifacts under `tmp/` using the required structure below.
- Keep durable phase intent and acceptance criteria in `docs/phases/phase-x.md`, but keep detailed execution artifacts in `tmp/`.
- Treat `tmp/` as temporary local execution state. Do not rely on it as durable repo history and do not force-add it to git unless the user explicitly wants checked-in examples or fixtures.
- When a phase changes durable product truth in ways `PLAN.md` should express (for example command surface, accepted product decisions, resolved open questions, or scope changes), update `PLAN.md` before closing the phase.
- Do implementation work on a dedicated local branch, not directly on `main`.
- If the repo has no commits yet, still create the working branch first so the first commits land off `main`; only move `main` forward after review and validation.
- Use small atomic local commits as progress checkpoints whenever a coherent slice is green and reviewable.
- Before a branch is considered review-complete, approval-ready, merge-ready, or ready for final handoff, run the default pre-approval gate as a full review / fix loop with focused DRY, KISS, and YAGNI lenses, then apply accepted fixes, rerun validation, and merge the reviewed branch back into local `main` when authorized.
- A phase is only fully complete when its scoped work, required support files, artifacts, validation, review/fix pass, commit(s), and merge back to local `main` are done, or when the only remaining step is an explicitly noted authorization-gated finalization action.
- When subagents are used, log what each subagent was asked to do and what it concluded.
- If `PLAN.md` is too rough or ambiguous to safely start the current phase, do not guess: run a clarification/interview step with the user first.

## Deterministic logging structure

Treat the workflow as three layers:
- `PLAN.md` = strategic product and architecture truth
- `docs/phases/phase-x.md` = durable per-phase plan and acceptance criteria **(full local mode)** or thin tracker pointer **(tracker-backed)**
- `tmp/` = temporary local execution audit trail and machine-friendly continuation state

In tracker-backed mode, the tracker issue body is the canonical spec; `docs/phases/phase-x.md` is a thin pointer and does not duplicate the issue body.

Maintain the core paths below while the phase is active locally, and create optional artifacts only when they are actually used:

Core paths:
- `docs/phases/phase-x.md` (full plan in full local mode; thin pointer in tracker-backed mode)
- `tmp/phases/index.json`
- `tmp/phases/phase-x/manifest.json`
- `tmp/phases/phase-x/variant-a.md`
- `tmp/phases/phase-x/variant-b.md`
- `tmp/phases/phase-x/merged-plan.md`
- `tmp/phases/phase-x/review.md`
- `tmp/phases/phase-x/summary.md`
- `tmp/phases/phase-x/retrospective.md`

Optional when used:
- `tmp/phases/phase-x/variant-c.md`
- `tmp/phases/phase-x/subagents/`
- `tmp/phases/phase-x/subagents/raw/`
- `tmp/phases/phase-x/bash-exit-1.jsonl`
- `tmp/phases/phase-x/clarification.md`
- in dev mode: `tmp/phases/phase-x/dev-mode-context.json`
- in dev mode: `tmp/phases/phase-x/dev-mode-review.md` as optional analytical notes when they help shape the retrospective
- in dev mode: `tmp/phases/phase-x/dev-mode-retrospective.md`
- in dev mode: `tmp/phases/phase-x/dev-mode-skill-changes.md`

Use the templates in `templates/` relative to the skill directory.

Use deterministic helper scripts from `scripts/` for repeatable support tasks such as phase initialization, phase-file updates, template materialization, bash-exit logging, and dev-mode context collection. Paths referenced from this skill are relative to the skill directory so the workflow works from project-local `.pi/skills/`, packaged Pi installs, or other supported Pi skill locations.

## Bootstrap missing support files

If these files are missing, create them from `templates/` before continuing:

- missing `AGENTS.md` -> create from `templates/bootstrap-agents.md`
- missing `docs/IMPLEMENTATION_STATE.md` -> create from `templates/bootstrap-implementation-state.md`
- missing `docs/IMPLEMENTATION_WORKFLOW.md` -> create from `templates/bootstrap-implementation-workflow.md`
- missing `docs/phases/phase-x.md` for the active phase -> create from `templates/phase-doc.md`
- missing `tmp/phases/index.json` -> create or reinitialize it

The bootstrap files are support infrastructure. In full local mode, `PLAN.md` remains the product source of truth, and `docs/phases/phase-x.md` is the durable source of truth for the current phase's plan and acceptance boundary. In tracker-backed mode, the tracker issue body is the canonical spec and `docs/phases/phase-x.md` is a thin pointer; do not create a full phase doc from templates when a tracker spec is already resolved.

For bootstrap/setup phases, do not mark the phase `completed` or `awaiting-finalization` until the expected durable support files for the chosen workflow contract actually exist in the repository. Temporary `tmp/` execution artifacts do not need to be committed.
## Plan sufficiency check

Before phase planning, check whether the canonical spec contains enough information to proceed safely.

**Full local mode:** check `PLAN.md` and `docs/phases/phase-x.md`.

**Tracker-backed mode:** check the resolved tracker issue body. If `specBearing` is `false` from the resolver, treat the body as insufficient.

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
- update `docs/phases/phase-x.md` with clarified durable phase intent, scope, or acceptance criteria
- update `PLAN.md` only if the clarified information is durable product/project truth beyond the current phase
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

**Full local mode:** Read `docs/IMPLEMENTATION_STATE.md` and identify the next unfinished phase. Read `docs/phases/phase-x.md` for that phase if it exists.

**Tracker-backed mode:** The active phase is determined by the tracker issue reference. If no phase doc exists yet, assign the next available phase number and create a thin pointer via `scripts/loop/resolve-tracker-spec.mjs` or the `generateThinPhaseDoc()` helper.

If `tmp/phases/index.json` exists locally, use it as a fast index for prior artifacts.
If the durable phase doc, the state file, and the tmp index disagree, trust docs first and note the mismatch in the phase review log.

If the state file is ambiguous, resolve ambiguity conservatively:
- prefer the earliest clearly unfinished phase
- do not skip ahead
- note the ambiguity in the phase review log under `tmp/`
- if this is a first-run bootstrap, start from the earliest phase implied by `PLAN.md`

## Phase planning loop

For the **current phase only**, run this loop before implementation.

### 1. Create or update the durable phase doc and tmp scaffold

Use paths like:
- `docs/phases/phase-0.md`
- `tmp/phases/phase-0/`
- `docs/phases/phase-1.md`
- `tmp/phases/phase-1/`

Create or update:
- `docs/phases/phase-x.md`
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

When subagents are available, the default refinement path should use the `refiner` role and **parallel fresh-context subagents** so the variants are independently generated rather than serially contaminated by one another. Pass each refiner a concise written briefing summary instead of relying on forked parent-session context.

For future refinement hardening, treat the `variant-a` / `variant-b` pattern as the stable inner fan-out shape for a given persona or review angle. Do not switch personas halfway through one `a/b` pair. Instead, when more hardening is needed, run multiple fresh-context fan-out passes with different personas or angles, each with its own consistent `a/b` pair, and then merge across those persona-specific passes.

Each refiner variant should make room for:
- explicit non-goals
- complete acceptance criteria
- a complete definition of done
- risks and unresolved questions
- RFC escalation notes when technical decisions should go through the coordinator
- for watcher/predicate-heavy phases: explicit negative-case tests and timeout semantics, including any zero-timeout or single-check contract

Use the template in `templates/phase-variant.md`.

Each variant should cover only:
- scope for this phase
- files/modules touched
- tests to add first
- implementation order
- acceptance criteria
- risks/non-goals

When a phase includes a bounded audit, inventory, or scan:
- treat the scan as a first-class deliverable rather than an implicit side note
- require prioritized findings, not an unbounded dump
- state explicitly what the scan does **not** authorize or rewrite in the current phase

If subagents generate the variants:
- run them in parallel with clean context when practical
- give each variant generator a concise briefing summary that includes phase objective, in-scope work, constraints, known risks, and required outputs
- keep each `variant-a` / `variant-b` pair anchored to one persona or refinement angle so the alternatives are directly comparable
- when you want broader hardening, add another fan-out pass with a different persona or angle and its own `variant-a` / `variant-b` pair instead of blending multiple personas into one pair
- do not fork the parent session just to share planning context; summarize it instead
- save raw subagent outputs under `tmp/phases/phase-x/subagents/raw/` only when keeping the raw capture is actually useful
- then write the human-oriented `variant-a.md` / `variant-b.md` / `variant-c.md` files from those raw outputs when applicable

Update `manifest.json` with the planned artifact list and current status.

### 4. Fan in to a merged phase plan

Write:
- `tmp/phases/phase-x/merged-plan.md`
- update `docs/phases/phase-x.md` with the selected durable phase plan

Use the templates in `templates/merged-phase-plan.md` and `templates/phase-doc.md`.

The merged plan must include:
- exact scope for this phase
- explicit non-goals
- tests to write first
- implementation order
- validation steps
- acceptance criteria
- definition of done
- RFC escalation notes for any RFC-worthy technical decisions that must go through the coordinator instead of being silently resolved during refinement
- for any new CLI surface: explicit success-output and malformed-argument/error-contract expectations
- for any watcher/predicate-driven behavior: explicit timeout semantics plus negative-case detection rules for non-target identities or events
- for package-first phases in a source-loaded workspace: explicit expectations about whether callers consume shared logic through workspace/source adapters or published package import paths during local development

The durable phase doc should capture the subset that a fresh human or agent should read first: objective, why now, scope, non-goals, acceptance criteria, definition of done, validation approach, durable decisions, and open questions.

### 5. Review the merged phase plan adversarially

Write:
- `tmp/phases/phase-x/review.md`

Use the template in `templates/review.md`.
Ensure the durable phase doc still matches the reviewed plan; update `docs/phases/phase-x.md` if the review changes accepted scope or criteria.

The review must check for:
- overreach beyond phase scope
- KISS/SRP/YAGNI violations
- missing tests
- weak validation
- unclear module boundaries
- hidden coupling to Pi runtime internals
- ambiguous acceptance criteria
- unclear or incomplete definition-of-done output
- missing review-surface completeness
- weak RFC-escalation sanity when the plan surfaces an unresolved technical decision
- for bounded audits/scans: missing prioritization or quiet expansion into a broad rewrite
- for new CLI surfaces: weak malformed-argument or error-contract coverage
- for watcher/predicate-heavy behavior: weak timeout semantics or missing negative-case tests for non-target activity
- for package-first phases: ambiguous source-loaded workspace integration boundaries that leave local scripts/tests guessing how shared helpers are consumed

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
   - `npm run verify`
   - when a narrower local check is more honest for the touched slice, say so explicitly and run the narrowest justified subset instead of pretending the full verify path was unnecessary
   - for user-facing HTML/UI/component slices when the user opts in, add a bounded deterministic browser smoke harness (prefer fixture-backed Playwright WebKit plus screenshot capture); use `npm run test:playwright:viewer` when that viewer/browser surface is part of the slice, and wire it into CI once it becomes required validation for that slice
4. Review the implementation against the merged phase plan.
5. Run the default pre-approval gate as a full review / fix loop on the branch before calling it review-complete, approval-ready, merge-ready, or ready for final handoff:
   - use DRY, KISS, and YAGNI as the default three focused review lenses
   - run those three lens-focused passes in parallel with fresh context when practical
   - if parallel execution is impractical (for example due to tooling or resource constraints), run all three lenses sequentially and explicitly record why parallel execution was impractical in `tmp/phases/phase-x/review.md` (or the equivalent merged review artifact)
   - start each reviewer in fresh context with a concise reviewer-specific briefing summary covering the branch/phase, intended behavior, acceptance criteria, relevant files or artifacts, current validation status, and that reviewer's exact angle
   - do not fork the parent session for parallel reviewers; if more context is needed, write a compact handoff artifact under `tmp/` and point the reviewer at it
   - when reviewer subagents stumble on raw source-tree reads (for example unresolved build artifacts or import assumptions), generate a deterministic diff/review artifact under `tmp/` and have reviewers inspect that artifact instead of the raw file set
   - synthesize actionable findings
   - apply accepted fixes on the same branch
   - rerun validation after fixes
   - log review artifacts and subagent summaries under `tmp/`
6. Update `docs/phases/phase-x.md` so it reflects the phase as actually implemented, including any accepted scope or validation changes.
7. Update `PLAN.md` when the phase changed durable product truth, resolved an open question, or made the shipped command/behavior surface more concrete.
8. Write `tmp/phases/phase-x/summary.md` using `templates/phase-summary.md`.
9. Write `tmp/phases/phase-x/retrospective.md` using `templates/retrospective.md`.
10. Update `tmp/phases/phase-x/manifest.json` and `tmp/phases/index.json`.
11. Update `docs/IMPLEMENTATION_STATE.md`.
12. Make sure the phase branch history is captured with atomic commits once the phase is review-ready and authorized for commit.
13. If authorized, merge the fully reviewed, locally validated phase branch back into local `main`.
14. If authorization for commit or merge is still pending, mark the phase as `awaiting-finalization` rather than `completed`, and record exactly which finalization step is pending.

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
2. review the phase artifacts and logs with emphasis on the workflow itself:
   - planning quality
   - review quality
   - validation friction
   - bash exit-code-1 patterns
   - places where skill or agent prompts should be tightened
   - places where deterministic tooling should replace ad hoc work
3. write `tmp/phases/phase-x/dev-mode-retrospective.md`
   - this is the required dev-mode retrospective artifact
   - it should name the highest-value prompt/workflow follow-ups revealed by the phase
4. optionally write `tmp/phases/phase-x/dev-mode-review.md` when separate analytical notes help support the retrospective
5. apply at least one bounded follow-up update to a relevant skill and/or agent prompt
   - deterministic tooling, docs, templates, or tests may accompany that change
   - but they do not replace the required prompt update
   - keep the change phase-bounded and tied directly to the retrospective findings
6. write `tmp/phases/phase-x/dev-mode-skill-changes.md`
   - record which skill and/or agent prompts changed
   - record any supporting tooling/docs/template changes that accompanied them
   - if no prompt update can be justified safely, stop and report that dev-mode exit criteria were not met
7. if skill scripts or deterministic tooling changed, rerun the skill-local tests
8. stop after this bounded self-improvement pass; do not recurse into endless self-editing loops

Dev mode is still phase-bounded. It improves the loop around the completed phase; it does not authorize work on the next product phase.

## tmp/ logging requirements

At minimum, each phase should leave behind:
- a durable phase doc at `docs/phases/phase-x.md`
- local `tmp/` execution artifacts needed to resume and audit the phase, including:
  - `manifest.json`
  - `variant-a.md`
  - `variant-b.md`
  - `merged-plan.md`
  - `review.md`
  - `summary.md`
  - `retrospective.md`
  - optional `variant-c.md` when a third variant was actually useful
  - `bash-exit-1.jsonl` when any bash call during the phase exited with code `1`
  - `clarification.md` when a plan-sufficiency interview or auto-clarification step was needed
  - subagent summaries when subagents were used
  - raw subagent outputs only when they were saved separately on purpose
  - in dev mode: `dev-mode-context.json`, `dev-mode-retrospective.md`, and `dev-mode-skill-changes.md`
  - optional in dev mode: `dev-mode-review.md` when separate analytical notes were useful

These `tmp/` artifacts are normally temporary and do not need to be checked into git.

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
- the current phase is implemented, validated, and fully finalized, or is explicitly marked `awaiting-finalization`
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
- A phase is not operationally closed until its branch state is captured in commit history and the reviewed branch has been merged back into local `main`, unless authorization for that finalization is still pending.
- When authorization is pending, record the phase as `awaiting-finalization` and describe the exact missing step.
- Merge the fully reviewed, locally validated branch back into local `main` when authorized.

## Commit policy

- Do not commit speculative work.
- Do not commit before the relevant validation for that slice passes.
- Immediately before every `git add && git commit` sequence, assert branch identity with `git branch --show-current` and stop if it does not match the intended local working branch.
- Keep commits small and phase-bounded.
- Do not leave completed phase work stranded off `main`; once the reviewed branch is ready and authorized, merge it locally.
- Commit only when the coordination/main agent has decided the slice or phase is ready.
- If commit/merge authorization has not yet been given, do not call the phase `completed`; call it `awaiting-finalization` instead.

## Anti-patterns

Do not:
- assume a project must already have `AGENTS.md`, `docs/IMPLEMENTATION_STATE.md`, `docs/IMPLEMENTATION_WORKFLOW.md`, or `docs/phases/phase-x.md`
- guess through missing plan details when a short clarification step would resolve them
- implement multiple future phases in one pass
- skip the fan-out/fan-in/review loop
- treat rough notes as implementation authorization
- expand scope because a helper may be useful later
- rely on Pi private internals when public hooks exist
- skip updating `docs/phases/phase-x.md` when the accepted phase plan changes
- skip updating `docs/IMPLEMENTATION_STATE.md`
- skip writing `tmp/` artifacts
- use subagents without leaving readable summaries of what they did

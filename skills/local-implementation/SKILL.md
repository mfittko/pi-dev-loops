---
name: local-implementation
description: >-
  Internal routed strategy behind `dev-loop` for local phase-bounded
  implementation. Use it when authoritative startup/resume routing selects the
  `local_implementation` strategy so the child agent can own phase planning,
  artifact discipline, test-first implementation, and local validation in fresh
  context.
compatibility: Pi skill for git-based repositories with Node.js/npm and optional subagent support.
allowed-tools: read bash edit write subagent review_loop
user-invocable: false
---

# Local Implementation

This skill is the canonical internal `local_implementation` route behind the public `dev-loop` façade.

Use it only after the public dispatcher has already resolved `selectedStrategy: local_implementation`. This skill owns the local phase procedure and artifact discipline for that route; it does not redefine the shipped runtime semantics of helper CLIs, shared loop logic, or extension commands.

Read the authoritative public routing contract at [Public Dev Loop Contract](../docs/public-dev-loop-contract.md) and keep any repository-specific decisions grounded in [Project Plan](../../PLAN.md), durable phase docs, source, tests, config, and actual validation commands.
For UI validation under `dev-loop`, see [UI Validation Contract](../../docs/ui-validation-contract.md), [UI Smoke Harness](../../docs/ui-smoke-harness.md), [UI Artifact Contract](../../docs/ui-artifact-contract.md), and [UI Designer Review Loop](../../docs/ui-designer-review-loop.md) (these are repo-level docs present in the source checkout; they are not part of the bundled `../docs/` runtime contract surface for installed skill copies).

## Minimal required project inputs

For a new project, the only required inputs are:

1. [Project Plan](../../PLAN.md)
2. [this skill file](./SKILL.md)

Everything else is optional and may be bootstrapped by this skill.

## Required startup reads

Read only what the current routed step actually needs.

### GitHub-first routed requests (`issue_intake`, `copilot_pr_followup`, `reviewer_fixer`, `wait_watch`, `final_approval`)

Before acting on a GitHub-first issue/PR request:

1. read this skill
2. if [Agent Instructions](../../AGENTS.md) exists, read it first as the repo constitution / working agreement
3. read [Public Dev Loop Contract](../docs/public-dev-loop-contract.md)
4. if the current step depends on async start/resume/status or retrospective enforcement, read [Retrospective Checkpoint Contract](../docs/retrospective-checkpoint-contract.md)
5. read the relevant GitHub issue or PR
6. inspect the actual validation/runtime surface needed for the current step (`package.json`, CI/workflows, touched files, helper contracts)
7. when GitHub-first refinement produces multiple bounded child slices, prefer real GitHub sub-issue trees as the durable execution structure; keep parent issue bodies lean once the tree exists and use plain related-issue references when no tree is warranted

### Local implementation routed requests (`local_implementation`)

Before local phase planning or coding:

1. read this skill
2. if [Agent Instructions](../../AGENTS.md) exists, read it
3. read [Project Plan](../../PLAN.md)
4. if [Implementation Workflow](../../docs/IMPLEMENTATION_WORKFLOW.md) exists, read it
5. if [Implementation State](../../docs/IMPLEMENTATION_STATE.md) exists, read it
6. if the active local session is phase-doc-backed and [Phase Plan](../../docs/phases/phase-x.md) exists for the active phase, read it
7. if the active local session is tracker-backed, deterministically resolve the tracker issue spec first via `scripts/github/resolve-tracker-local-spec.mjs` (or the equivalent `gh issue view <number> --repo <owner/name> --json number,title,body,url,state` call), then treat that tracker issue as canonical for the rest of the local session

Treat missing optional files as normal bootstrap conditions, not as errors.

### Tracker-backed local implementation

Local implementation supports two durable spec inputs:

- phase-doc-backed local sessions ([Phase Plan](../../docs/phases/phase-x.md) is canonical)
- tracker-backed local sessions (the tracker issue is canonical)

Tracker-backed local implementation stays inside the existing `local_implementation` path. It does not introduce a new routing mode.

When the local spec already lives in a tracker issue:

- resolve the tracker reference deterministically from a GitHub issue URL or explicit `<owner/name>` + issue number
- use the bounded GitHub helper `scripts/github/resolve-tracker-local-spec.mjs` when you need a machine-readable spec bundle
- treat the tracker issue title/body/url/state as the durable local spec bundle
- do not create or read [Phase Plan](../../docs/phases/phase-x.md) for that same tracker-backed session
- sync durable scope / acceptance / status changes back to the tracker issue rather than maintaining a duplicate local phase doc
- keep `tmp/` as temporary local execution state only; it does not become a second durable spec surface
- for tracker-backed sessions, the handoff path is always: push the working branch → open a PR → merge via GitHub
- for tracker-backed sessions, PR creation must always include `--assignee @me` so the new PR is self-assigned. When `.pi/dev-loop/settings.yaml` `workflow.requireDraftFirst` opts in, use `gh pr create --draft --assignee @me`. Do not create a fresh PR directly in ready-for-review state unless the user explicitly overrides that policy for the current PR scope. The draft gate review is a real workflow boundary.
- do not suggest a direct local-main merge for tracker-backed sessions; do not merge the working branch into local `main` at phase completion

## Primary execution rules

- Implement **one phase at a time**.
- Do not refine later phases in detail before the current phase is complete.
- Use the `refiner` agent for phase-refinement work when subagents are available; keep the coordinator as the escalation and decision owner when RFC-worthy technical decisions appear.
- Work **test-first** for all non-trivial logic.
- Maintain **90% coverage** thresholds.
- Log detailed iteration artifacts under `tmp/` using the required structure below.
- For phase-doc-backed local sessions, keep durable phase intent and acceptance criteria in [Phase Plan](../../docs/phases/phase-x.md); for tracker-backed local sessions, keep that durable intent in the tracker issue and do not duplicate it into [Phase Plan](../../docs/phases/phase-x.md). Keep detailed execution artifacts in `tmp/`.
- Treat `tmp/` as temporary local execution state. Do not rely on it as durable repo history and do not force-add it to git unless the user explicitly wants checked-in examples or fixtures.
- When a phase changes durable product truth in ways `PLAN.md` should express (for example command surface, accepted product decisions, resolved open questions, or scope changes), update [Project Plan](../../PLAN.md) before closing the phase.
- Do implementation work on a dedicated local branch, not directly on `main`.
- If the repo has no commits yet, still create the working branch first so the first commits land off `main`; only move `main` forward after review and validation.
- Use small atomic local commits as progress checkpoints whenever a coherent slice is green and reviewable.
- Before a branch is considered review-complete, approval-ready, merge-ready, or ready for final handoff, run the default pre-approval gate as a full review / fix loop with the review angles resolved from config (`resolveGateAngles(config, "preApproval")`), then apply accepted fixes and rerun validation.
- A phase is only fully complete when its scoped work, required support files, artifacts, validation, review/fix pass, commit(s), and finalization (merge into local `main` for phase-doc-backed sessions; PR merge for tracker-backed sessions) are done, or when the only remaining step is an explicitly noted authorization-gated finalization action.
- When subagents are used, log what each subagent was asked to do and what it concluded.
- If [Project Plan](../../PLAN.md) is too rough or ambiguous to safely start the current phase, do not guess: run a clarification/interview step with the user first.

## Deterministic logging structure

Treat the workflow as three layers:
- [Project Plan](../../PLAN.md) = strategic product and architecture truth
- [Phase Plan](../../docs/phases/phase-x.md) or the canonical tracker issue = durable per-phase plan and acceptance criteria for the active local session
- `tmp/` = temporary local execution audit trail and machine-friendly continuation state

Maintain the core paths below while the phase is active locally, and create optional artifacts only when they are actually used:

Core paths:
- for phase-doc-backed local sessions: [Phase Plan](../../docs/phases/phase-x.md)
- `tmp/phases/index.json`
- `tmp/phases/phase-x/manifest.json`
- `Variant A` (`tmp/phases/phase-x/variant-a.md`)
- `Variant B` (`tmp/phases/phase-x/variant-b.md`)
- `Merged Plan` (`tmp/phases/phase-x/merged-plan.md`)
- `Phase Review` (`tmp/phases/phase-x/review.md`)
- `Phase Summary` (`tmp/phases/phase-x/summary.md`)
- `Retrospective` (`tmp/phases/phase-x/retrospective.md`)

Optional when used:
- `Variant C` (`tmp/phases/phase-x/variant-c.md`)
- `tmp/phases/phase-x/subagents/`
- `tmp/phases/phase-x/subagents/raw/`
- `tmp/phases/phase-x/bash-exit-1.jsonl`
- `Clarification Log` (`tmp/phases/phase-x/clarification.md`)
- in dev mode: `tmp/phases/phase-x/dev-mode-context.json`
- in dev mode: `Dev Mode Review` (`tmp/phases/phase-x/dev-mode-review.md`) as optional analytical notes when they help shape the retrospective
- in dev mode: `Dev Mode Retrospective` (`tmp/phases/phase-x/dev-mode-retrospective.md`)
- in dev mode: `Dev Mode Skill Changes` (`tmp/phases/phase-x/dev-mode-skill-changes.md`)

Use the templates in `../dev-loop/templates/` (the sibling `skills/dev-loop/templates/` directory in this repo).

Use deterministic helper scripts from `../dev-loop/scripts/` (the sibling `skills/dev-loop/scripts/` directory in this repo; in installed-skill layouts these live at `../dev-loop/scripts/` relative to this skill file, not inside this skill's own directory) for repeatable support tasks such as phase initialization, phase-file updates, template materialization, bash-exit logging, and dev-mode context collection.

## Bootstrap missing support files

If these files are missing, create them from the `../dev-loop/templates/` directory before continuing:

- missing [Agent Instructions](../../AGENTS.md) -> create from [Bootstrap Agents Template](../dev-loop/templates/bootstrap-agents.md)
- missing [Implementation State](../../docs/IMPLEMENTATION_STATE.md) -> create from [Bootstrap Implementation State Template](../dev-loop/templates/bootstrap-implementation-state.md)
- missing [Implementation Workflow](../../docs/IMPLEMENTATION_WORKFLOW.md) -> create from [Bootstrap Implementation Workflow Template](../dev-loop/templates/bootstrap-implementation-workflow.md)
- missing [Phase Plan](../../docs/phases/phase-x.md) for the active phase -> create from [Phase Doc Template](../dev-loop/templates/phase-doc.md)
- missing `tmp/phases/index.json` -> create or reinitialize it

The bootstrap files are support infrastructure. [Project Plan](../../PLAN.md) remains the product source of truth. For phase-doc-backed local sessions, [Phase Plan](../../docs/phases/phase-x.md) is the durable source of truth for the current phase's plan and acceptance boundary. For tracker-backed local sessions, the tracker issue is that durable source of truth, and no duplicate local phase doc should be bootstrapped.

For bootstrap/setup phases, do not mark the phase `completed` or `awaiting-finalization` until the expected durable support files for the chosen workflow contract actually exist in the repository. Temporary `tmp/` execution artifacts do not need to be committed.
## Plan sufficiency check

Before phase planning, check whether [Project Plan](../../PLAN.md) contains enough information to proceed safely.

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
- record the answers in `Clarification Log` (`tmp/phases/phase-x/clarification.md`)
- update [Phase Plan](../../docs/phases/phase-x.md) with clarified durable phase intent, scope, or acceptance criteria
- update [Project Plan](../../PLAN.md) only if the clarified information is durable product/project truth beyond the current phase
- update [Implementation State](../../docs/IMPLEMENTATION_STATE.md) if the clarification changes the next phase boundary

### Mode B — auto clarification
Use this when the user explicitly asks for an auto option, says to just proceed, or is clearly optimizing for speed over discussion.

In auto mode:
- infer the smallest safe defaults for the current phase only
- prefer conservative assumptions over ambitious ones
- never auto-resolve product, security, or architecture decisions that could materially change scope
- write all assumptions to `Clarification Log` (`tmp/phases/phase-x/clarification.md`)
- mark them clearly as `auto-assumptions`
- surface the assumptions in the phase review so they can be challenged later
- if an assumption is too risky to make safely, stop and ask the user anyway

Do not begin fan-out planning until the current phase is sufficiently specified, either by user clarification or safe auto-assumptions.

## Determine where to resume

Read [Implementation State](../../docs/IMPLEMENTATION_STATE.md) and identify the next unfinished phase.
Read [Phase Plan](../../docs/phases/phase-x.md) for that phase if it exists.

If `tmp/phases/index.json` exists locally, use it as a fast index for prior artifacts.
If the durable phase doc, the state file, and the tmp index disagree, trust docs first and note the mismatch in the phase review log.

If the state file is ambiguous, resolve ambiguity conservatively:
- prefer the earliest clearly unfinished phase
- do not skip ahead
- note the ambiguity in the phase review log under `tmp/`
- if this is a first-run bootstrap, start from the earliest phase implied by [Project Plan](../../PLAN.md)

## Phase planning loop

For the **current phase only**, run this loop before implementation.

### 1. Create or update the durable phase doc and tmp scaffold

Use paths like:
- `docs/phases/phase-0.md`
- `tmp/phases/phase-0/`
- `docs/phases/phase-1.md`
- `tmp/phases/phase-1/`

Create or update:
- [Phase Plan](../../docs/phases/phase-x.md)
- `tmp/phases/phase-x/manifest.json`
- `tmp/phases/index.json`

Prefer the deterministic helper:
- `../dev-loop/scripts/init-phase.mjs`

Use `../dev-loop/scripts/phase-files.mjs` only when you need a narrower manifest/index update without regenerating the standard phase-planning scaffold.

### 2. Read the previous phase's learning before planning the next one

If a previous phase exists, read:
- its `summary.md`
- its `retrospective.md`
- any relevant subagent summaries

Use those lessons to improve the current phase plan.

### 3. Fan out short plan variants

Write 2-3 short variants:
- `Variant A` (`tmp/phases/phase-x/variant-a.md`) = smallest safe implementation
- `Variant B` (`tmp/phases/phase-x/variant-b.md`) = best practical UX/developer-experience option within phase scope
- `Variant C` (`tmp/phases/phase-x/variant-c.md`) = safest boundary/risk-reduction option when useful

When subagents are available, the default refinement path should use the `refiner` role and **parallel fresh-context subagents** so the variants are independently generated rather than serially contaminated by one another. Pass each refiner a concise written briefing summary instead of relying on forked parent-session context.

For future refinement hardening, treat the `variant-a` / `variant-b` pattern as the stable inner fan-out shape for a given persona or review angle. Do not switch personas halfway through one `a/b` pair. Instead, when more hardening is needed, run multiple fresh-context fan-out passes with different personas or angles, each with its own consistent `a/b` pair, and then merge across those persona-specific passes.

Each refiner variant should make room for:
- explicit non-goals
- complete acceptance criteria
- a complete definition of done
- risks and unresolved questions
- RFC escalation notes when technical decisions should go through the coordinator
- for watcher/predicate-heavy phases: explicit negative-case tests and timeout semantics, including any zero-timeout or single-check contract

Use the template in [Phase Variant Template](../dev-loop/templates/phase-variant.md).

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
- then write the human-oriented `Variant A` (`tmp/phases/phase-x/variant-a.md`) / `Variant B` (`tmp/phases/phase-x/variant-b.md`) / `Variant C` (`tmp/phases/phase-x/variant-c.md`) files from those raw outputs when applicable

Update `manifest.json` with the planned artifact list and current status.

### 4. Fan in to a merged phase plan

Write:
- `Merged Plan` (`tmp/phases/phase-x/merged-plan.md`)
- update [Phase Plan](../../docs/phases/phase-x.md) with the selected durable phase plan

Use the templates in [Merged Phase Plan Template](../dev-loop/templates/merged-phase-plan.md) and [Phase Doc Template](../dev-loop/templates/phase-doc.md).

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
- `Phase Review` (`tmp/phases/phase-x/review.md`)

Use the template in [Review Template](../dev-loop/templates/review.md).
Ensure the durable phase doc still matches the reviewed plan; update [Phase Plan](../../docs/phases/phase-x.md) if the review changes accepted scope or criteria.

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

## Workflow-run subagent hand-off contract

When handing off a full workflow run to a subagent (draft PR → gates → Copilot → merge),
use the canonical hand-off template. Do not rely on abbreviated task summaries or operator
memory.

The canonical template is [Workflow Handoff Template](../docs/workflow-handoff-template.md) (source-tree path: `skills/docs/workflow-handoff-template.md`). It includes:
- direct contract-doc references the subagent must read before executing
- a mandatory 8-step checklist (draft PR → draft_gate → ready → Copilot → resolve → pre_approval_gate → merge)
- non-negotiable invariants (Copilot review loop between gates, `unresolvedThreadCount === 0`, visible gate comments)

For all GitHub-first routed follow-up (`copilot_pr_followup`, `issue_intake`), the
coordinator must use this template when delegating the full run to a subagent.
Reference it by path, not by memory.

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
   - resolve review angles from config: `resolveGateAngles(config, "preApproval")` from `@pi-dev-loops/core/config`
   - run the resolved angle-focused passes in parallel with fresh context when practical
   - if parallel execution is impractical (for example due to tooling or resource constraints), run all angles sequentially and explicitly record why parallel execution was impractical in `Phase Review` (`tmp/phases/phase-x/review.md`) (or the equivalent merged review artifact)
   - for each angle, resolve its persona and prompt via `resolveReviewerRole(config, angle)` — start each reviewer in fresh context with a concise briefing including the angle-specific prompt, the branch/phase, intended behavior, acceptance criteria, relevant files or artifacts, and current validation status
   - use a context→fork→consolidate chain: context-builder produces shared briefing, parallel reviewers fork from context, consolidation merges findings into a fix plan
   - in retry cycles, only re-run reviewers that had findings in the previous pass
   - do not fork the parent session for parallel reviewers; if more context is needed, write a compact handoff artifact under `tmp/` and point the reviewer at it
   - when reviewer subagents stumble on raw source-tree reads (for example unresolved build artifacts or import assumptions), generate a deterministic diff/review artifact under `tmp/` and have reviewers inspect that artifact instead of the raw file set
   - synthesize actionable findings
   - apply accepted fixes on the same branch
   - rerun validation after fixes
   - log review artifacts and subagent summaries under `tmp/`
6. Update [Phase Plan](../../docs/phases/phase-x.md) so it reflects the phase as actually implemented, including any accepted scope or validation changes.
7. Update [Project Plan](../../PLAN.md) when the phase changed durable product truth, resolved an open question, or made the shipped command/behavior surface more concrete.
8. Write `Phase Summary` (`tmp/phases/phase-x/summary.md`) using [Phase Summary Template](../dev-loop/templates/phase-summary.md).
9. Write `Retrospective` (`tmp/phases/phase-x/retrospective.md`) using [Retrospective Template](../dev-loop/templates/retrospective.md).
10. Update `tmp/phases/phase-x/manifest.json` and `tmp/phases/index.json`.
11. Update [Implementation State](../../docs/IMPLEMENTATION_STATE.md).
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

A repository may also declare a formal-dev-mode default through `.pi/dev-loop/settings.yaml` `workflow.devModeDefault`. Treat that config as the policy source of truth when present, but explicit user opt-in or opt-out for the current run still wins. Runtime consumption of that config may be staged separately from this documentation update.

Trigger it when the user explicitly asks for dev mode, self-improvement mode, or says they want the skill to refine itself as it goes.

In dev mode, after the normal phase summary and retrospective are written, run one extra bounded self-improvement pass before moving on:

1. collect a deterministic context bundle for the phase using:
   - `../dev-loop/scripts/dev-mode-context.mjs`
   - output to `tmp/phases/phase-x/dev-mode-context.json`
2. review the phase artifacts and logs with emphasis on the workflow itself:
   - planning quality
   - review quality
   - validation friction
   - bash exit-code-1 patterns
   - places where skill or agent prompts should be tightened
   - places where deterministic tooling should replace ad hoc work
3. write `Dev Mode Retrospective` (`tmp/phases/phase-x/dev-mode-retrospective.md`)
   - this is the required dev-mode retrospective artifact
   - it should name the highest-value prompt/workflow follow-ups revealed by the phase
4. optionally write `Dev Mode Review` (`tmp/phases/phase-x/dev-mode-review.md`) when separate analytical notes help support the retrospective
5. apply at least one bounded follow-up update to a relevant skill and/or agent prompt
   - deterministic tooling, docs, templates, or tests may accompany that change
   - but they do not replace the required prompt update
   - keep the change phase-bounded and tied directly to the retrospective findings
6. write `Dev Mode Skill Changes` (`tmp/phases/phase-x/dev-mode-skill-changes.md`)
   - record which skill and/or agent prompts changed
   - record any supporting tooling/docs/template changes that accompanied them
   - if no prompt update can be justified safely, stop and report that dev-mode exit criteria were not met
7. if skill scripts or deterministic tooling changed, rerun the skill-local tests
8. stop after this bounded self-improvement pass; do not recurse into endless self-editing loops

Dev mode is still phase-bounded. It improves the loop around the completed phase; it does not authorize work on the next product phase.

## tmp/ logging requirements

At minimum, each phase should leave behind:
- a durable phase doc at [Phase Plan](../../docs/phases/phase-x.md)
- local `tmp/` execution artifacts needed to resume and audit the phase, including:
  - `manifest.json`
  - `Variant A` (`tmp/phases/phase-x/variant-a.md`)
  - `Variant B` (`tmp/phases/phase-x/variant-b.md`)
  - `merged-plan.md`
  - `review.md`
  - `summary.md`
  - `retrospective.md`
  - optional `Variant C` (`tmp/phases/phase-x/variant-c.md`) when a third variant was actually useful
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
- `../dev-loop/scripts/log-bash-exit-1.mjs`

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
- A phase is not operationally closed until its branch state is captured in commit history and the reviewed branch has been finalized according to session type (merged into local `main` for phase-doc-backed sessions; merged via GitHub PR for tracker-backed sessions), unless authorization for that finalization is still pending.
- For tracker-backed sessions, the handoff path is always: push the working branch → open a PR → merge via GitHub; never merge the working branch into local `main`.
- PR creation must always include `--assignee @me` so the new PR is self-assigned. When `.pi/dev-loop/settings.yaml` `workflow.requireDraftFirst` opts in, use `gh pr create --draft --assignee @me`. Do not create a fresh PR directly in ready-for-review state unless the user explicitly overrides that policy for the current PR scope. The draft gate review is a real workflow boundary, so a new PR must exist in draft before `gh pr ready` is eligible.
- When authorization is pending, record the phase as `awaiting-finalization` and describe the exact missing step.
- For phase-doc-backed sessions, merge the fully reviewed, locally validated branch back into local `main` when authorized.

## Commit policy

- Do not commit speculative work.
- Do not commit before the relevant validation for that slice passes.
- Immediately before every `git add && git commit` sequence, assert branch identity with `git branch --show-current` and stop if it does not match the intended local working branch.
- Keep commits small and phase-bounded.
- Do not leave completed phase work stranded off `main`; once the reviewed branch is ready and authorized, finalize it according to session type (merge into local `main` for phase-doc-backed sessions; complete via PR merge for tracker-backed sessions).
- Commit only when the coordination/main agent has decided the slice or phase is ready.
- If commit/merge authorization has not yet been given, do not call the phase `completed`; call it `awaiting-finalization` instead.

## Anti-patterns

Do not:
- assume a project must already have [Agent Instructions](../../AGENTS.md), [Implementation State](../../docs/IMPLEMENTATION_STATE.md), [Implementation Workflow](../../docs/IMPLEMENTATION_WORKFLOW.md), or [Phase Plan](../../docs/phases/phase-x.md)
- guess through missing plan details when a short clarification step would resolve them
- implement multiple future phases in one pass
- skip the fan-out/fan-in/review loop
- treat rough notes as implementation authorization
- expand scope because a helper may be useful later
- rely on Pi private internals when public hooks exist
- skip updating [Phase Plan](../../docs/phases/phase-x.md) when the accepted phase plan changes
- skip updating [Implementation State](../../docs/IMPLEMENTATION_STATE.md)
- skip writing `tmp/` artifacts
- use subagents without leaving readable summaries of what they did

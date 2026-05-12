# Template inventory

These templates support the repo-local phased implementation skill.

## Bootstrap templates

Used when a project starts with only `PLAN.md` plus the skill.

- `bootstrap-agents.md`
  - minimal repo contract / guard rails
- `bootstrap-implementation-state.md`
  - initial implementation progress tracker
- `bootstrap-implementation-workflow.md`
  - optional repo-specific workflow explainer

## Phase artifact templates

Used during the per-phase loop.

- `phase-variant.md`
  - fan-out phase variants
- `merged-phase-plan.md`
  - fan-in merged plan
- `review.md`
  - adversarial review of merged plan
- `phase-summary.md`
  - what happened in the phase
- `retrospective.md`
  - process-improvement notes for later phases and future projects
- `subagent-summary.md`
  - readable summary of each subagent run, including async runs once results arrive
- `clarification.md`
  - records either interactive clarification answers or auto-mode assumptions when the plan is too rough

## Structured log templates

- `manifest.json`
  - per-phase machine-friendly status and artifact index

## Usage note

When `PLAN.md` is too rough to support phase planning safely, do not guess blindly.
Either:
- run a clarification/interview step with the user, or
- if the user explicitly wants the lazy/auto path, use conservative low-risk auto-assumptions and log them in `clarification.md`.

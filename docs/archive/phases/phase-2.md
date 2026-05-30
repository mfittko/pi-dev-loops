# phase-2 durable plan

## Status

Completed

## Objective

Introduce a dedicated refiner agent for the local phase-based dev loop so phase refinement produces full-fledged acceptance-criteria and definition-of-done lists before implementation begins.

## Why this phase exists now

The next most immediate workflow gap is not extension/setup UX but refinement quality. A dedicated refiner agent is needed now to strengthen phase plans, keep refinement separate from coordination, and escalate RFC-worthy technical decisions instead of guessing through them.

## In scope

- add a dedicated `agents/refiner.agent.md` for local phase refinement
- require the refiner to produce:
  - complete acceptance-criteria lists
  - complete definition-of-done lists
  - explicit non-goals, risks, and unresolved questions
- require the refiner to escalate technical decisions that need an RFC through the coordinator
- define the RFC escalation team as:
  - lead dev
  - specialized dev
  - systems architect
- update `skills/dev-loop/SKILL.md` so the planning loop uses the refiner and prefers parallel fan-out/fan-in where applicable
- add stable definition-of-done sections/checks to the relevant planning templates and review surfaces
- update roadmap/state docs so Phase 2 is refiner-first and extension/setup UX is deferred

## Explicit non-goals

- no implementation of the RFC team itself in this phase
- no generic RFC workflow engine
- no extension/setup/doctor/dashboard implementation work
- no broad Copilot/remote-loop redesign
- no collapsing the refiner and coordinator into one role

## Acceptance criteria

- a new `agents/refiner.agent.md` exists and is clearly scoped to phase refinement
- the refiner requires complete, testable acceptance criteria for the active phase
- the refiner requires a complete definition-of-done list for the active phase
- the refiner surfaces non-goals, risks, and unresolved questions instead of guessing through them
- the refiner explicitly escalates RFC-worthy technical decisions through the coordinator
- the coordinator-side contract names the RFC team as lead dev, specialized dev, and systems architect
- `skills/dev-loop/SKILL.md` uses the refiner during phase planning and preserves parallel fan-out/fan-in where applicable
- the relevant planning templates and review surfaces contain stable definition-of-done sections/checks
- `PLAN.md` and `docs/IMPLEMENTATION_STATE.md` agree that the refiner-agent slice comes before extension/setup UX

## Definition of done

- the refiner agent prompt is present under `agents/` and is phase-bounded
- the local `dev-loop` planning contract is updated to use the refiner without replacing the coordinator
- the RFC escalation boundary between refiner and coordinator is explicit in the prompts/docs
- the phase-doc, merged-plan, and planning-review scaffolds can carry durable definition-of-done output
- targeted automated tests cover the refiner/dev-loop/RFC-escalation contract, including coordinator-side decision ownership
- validation results and any remaining limitations are recorded honestly

## Validation approach

- write the refiner/dev-loop contract tests first
- run `node --test test/refiner-agent-phase-planning.test.mjs`
- run existing root prompt-asset tests to avoid Phase 1 regressions
- run the relevant `skills/dev-loop` validation that remains available in this checkout
- run `git diff --check`
- do a targeted read-through of the refiner/coordinator boundary and the DoD-enabled planning templates

## Durable decisions

- Phase 2 is re-sequenced to prioritize the dedicated refiner agent ahead of extension/setup UX
- the refiner owns refinement quality, not coordination ownership or RFC execution
- RFC-worthy technical decisions are escalated through the coordinator rather than auto-resolved during refinement
- the current RFC process shape is intentionally exception-based, phase-local, and artifact-light
- the coordinator is the RFC receiving boundary and decision owner; the named RFC team boundary is lead dev, specialized dev, and systems architect
- parallel fan-out/fan-in remains the preferred planning pattern when it adds value

## Open questions

- should the RFC team roles be introduced as explicit agent definitions in a later phase, or remain a coordination contract only?
- should DoD sections become mandatory in every durable phase doc template, or only in the local dev-loop planning surfaces first?
- should lightweight working RFC packets remain phase-local under `tmp/phases/phase-x/`, or eventually graduate into a durable `docs/rfcs/` surface?
- when an RFC changes durable repo truth beyond the active phase, should operator approval be documented as an explicit workflow rule rather than an implied coordination norm?
- what is the smallest reusable test surface for prompt-driven planning contracts in this repo?

## RFC process shape folded into this phase

For this phase, the RFC process shape is intentionally minimal:
- the refiner identifies and packages RFC-worthy boundary questions
- the coordinator triages whether RFC treatment is actually needed
- when needed, the coordinator routes the discussion to the named RFC team of lead dev, specialized dev, and systems architect
- working RFC notes should stay phase-local and lightweight unless a later phase proves that a durable RFC archive is needed
- approved, rejected, or deferred outcomes must be folded back into the active phase doc and merged plan rather than left only in ad hoc notes

## Operational closure status

Phase 2 implementation, validation, review/fix, and RFC-shape folding are complete.

The reviewed phase branch has been captured in local commit history and merged back to local `main`.

## Links to execution artifacts

- local execution artifacts may exist under `tmp/phases/phase-2/`

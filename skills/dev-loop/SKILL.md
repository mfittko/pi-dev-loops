---
name: dev-loop
description: >-
  Use as the single public dev-loop entrypoint. Resolve the authoritative
  current state first, then load only the route-specific internal skill needed
  for the selected strategy: local implementation, issue intake, PR follow-up,
  wait/watch, reviewer/fixer work, or final approval.
compatibility: Pi skill for git-based repositories with Node.js/npm and optional subagent support.
allowed-tools: read bash edit write subagent review_loop
user-invocable: true
---

# Unified Dev Loop

This skill is the public `dev-loop` façade for this repository. It should resolve the canonical current state first and route user intent without making the user choose internal strategy names up front.

## Authoritative routing contract

- The authoritative contract is [Public Dev Loop Contract](../docs/public-dev-loop-contract.md) in the source repository.
- The executable evaluator is exported as `@pi-dev-loops/core/loop/public-dev-loop-routing`.
- Required installed runtime contract docs for this skill are the shared bundled copies under `../docs/` from this skill directory (that is, [Public Dev Loop Contract](../docs/public-dev-loop-contract.md) and [Retrospective Checkpoint Contract](../docs/retrospective-checkpoint-contract.md)).
  - In the source repository these live under `skills/docs/`; in installed skill copies they live next to the installed skill directories under `../docs/`.
- For installed packaged copies of this skill, read those bundled `../docs/` files from the installed skill layout instead of assuming a source checkout is present. If any required bundled contract doc is missing from the installed skill layout, treat that as a packaging/installer bug.

Operational summary:
- route from authoritative current state instead of guessing from chat context
- for status/progress/readiness/merge-state/next-step questions, resolve authoritative artifact identity + artifact state + loop state first
- for issue targets, authoritative identity resolution must include explicit issue↔PR linkage resolution (for example via `detect-linked-issue-pr.mjs`) before saying there is no open linked PR
- when authoritative linkage resolves an open linked PR, treat it as the single canonical artifact for the issue and reuse it instead of opening another PR
- when authoritative identity remains unresolved, fail closed to reconcile/unknown

## Resolver-first startup

Run the deterministic startup resolver first and only load the files it names for the selected route.

Source-repo CLI:
```sh
node scripts/loop/resolve-dev-loop-startup.mjs --input <path-to-authoritative-state.json>
```

The resolver wraps `resolveAuthoritativeStartupResumeBundle` and returns:
- `selectedStrategy`
- `requiredReads[]`
- `nextAction`
- `canonicalStateSummary`

If the resolver reports `selectedStrategy: none` / reconcile, stop and reconcile the authoritative startup state before loading any route pack.

## Route table

Load only the route-specific internal skill required by `selectedStrategy`:

| Strategy | Route pack to load |
| --- | --- |
| `local_implementation` | [Local Implementation Skill](../local-implementation/SKILL.md) |
| `issue_intake` | [Issue Intake Skill](../issue-intake/SKILL.md) |
| `copilot_pr_followup` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) |
| `external_pr_followup` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) |
| `reviewer_fixer` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) |
| `wait_watch` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) |
| `final_approval` | [Final Approval Skill](../final-approval/SKILL.md) |

Do not preload local implementation, issue intake, PR follow-up, or final approval procedure before the resolver selects that route.

## After routing: execution directive

After the resolver selects a strategy and the route pack is loaded, the routed strategy's procedure is the execution plan — not reference material. Follow it.

**Async dispatch rule:** For any routed strategy where the resolver's `canonicalStateSummary.requiresAsyncDispatch` is `true`, dispatch the strategy as a single async coordinator subagent (the `dev-loop` agent) rather than executing steps inline in the parent session. The dispatched agent owns parallel review fan-out, fixer passes, gate comments, state transitions, and sub-delegation internally.

Strategies where `requiresAsyncDispatch` is `false` (`local_implementation`, `final_approval`, `none`) may run inline — local phases are often interactive, and final approval requires explicit human confirmation before GitHub mutations.

## Shorthand issue-based auto trigger contract

- treat `auto dev loop on issue 112` as the public `dev-loop` intent `auto_continue_current` after authoritative current-state resolution
- continue through the normal GitHub/Copilot loop until the next genuine stop condition or the final human approval gate
- stop at the final human approval gate by default unless merge was explicitly authorized

## Authority boundary and stop rules

- Source code, tests, config, CI, and shared contract docs are authoritative.
- This dispatcher summarizes the public routing contract; it does not redefine the shipped runtime semantics of helper CLIs, shared loop logic, or extension commands.
- Keep specialized Copilot behavior internal behind `dev-loop`; do not expose internal route packs as peer public workflow entrypoints.
- Before any state-changing action, get explicit confirmation unless the latest user message already clearly authorizes that exact action.
- Questions, preferences, future-tense statements, and implied approval are not confirmation.
- The bare response `ok` is not confirmation.
- Stop and ask for human direction rather than guessing when local facts, GitHub facts, and helper/state-machine output do not agree.

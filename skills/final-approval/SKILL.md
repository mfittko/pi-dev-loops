---
name: final-approval
description: >-
  Internal routed strategy behind `dev-loop` for the final human approval and
  merge gate. Use it after authoritative routing selects `final_approval` so
  the child agent can verify current-head gate evidence, clean thread state,
  green CI, and explicit merge authorization before any GitHub mutation.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth.
allowed-tools: read bash edit write subagent review_loop
user-invocable: false
---

# Final Approval

This skill is the canonical internal `final_approval` route behind the public `dev-loop` façade.

Use it only after the public dispatcher has already resolved `selectedStrategy: final_approval`. Treat [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) as the canonical owner of the full PR follow-up procedure; this skill narrows the fresh-context read set to the final approval and merge gate.

## Required reads

Read only what the final approval decision needs:

1. [Public Dev Loop Contract](../docs/public-dev-loop-contract.md)
2. [Retrospective Checkpoint Contract](../docs/retrospective-checkpoint-contract.md) when the current step depends on async start/resume/status or retrospective enforcement
4. [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md)
5. the active GitHub issue / PR, current review comments, and current-head CI/check status
6. task-relevant source files, tests, and config

## Final approval contract

- Before reporting merge-ready or approval-ready, verify the current-head PR state authoritatively.
- `unresolvedThreadCount === 0` must be verified via `capture-review-threads.mjs` rather than by prose assertion alone.
- A visible `pre_approval_gate` comment with verdict `clean` must exist on the current head SHA.
- CI must be green, or credibly green with an explicit repository-grounded explanation.
- If any of those checks fail, do not declare merge-ready.
- Stop at the final human approval gate by default.
- After approval, report `waiting_for_merge_authorization` and stop again unless merge has been explicitly authorized.
- Do not merge, push, rebase, resolve threads, or change GitHub state without explicit confirmation unless the latest user message already authorizes that exact action.

## Stop-and-ask rules

Stop and ask for human direction rather than guessing when local facts, GitHub facts, and helper/state-machine output do not agree, when the current head lacks visible clean gate evidence, or when merge authorization is absent.

---
name: dev-loop-unified
description: >-
  Unified dev-loop façade. Single public entrypoint that deterministically
  routes to the correct internal strategy (local implementation, Copilot PR
  follow-up, issue intake, reviewer loop, etc.) based on user intent and
  current state. Users never need to choose among internal loop names up front.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth for GitHub-first paths; local paths work offline.
allowed-tools: read bash edit write subagent review_loop
user-invocable: true
---

# Unified Dev-Loop

This skill is the **single public dev-loop entrypoint** for this repository's workflow system.

It replaces the need for users to choose among `dev-loop`, `copilot-dev-loop`, or `copilot-autopilot` up front. Instead, it accepts user-intent commands and deterministically routes to the correct internal execution strategy.

## User-intent commands

Say any of these:

| Command | What happens |
|---|---|
| `start dev loop on issue <n>` | Routes to issue intake or Copilot PR follow-up |
| `continue dev loop on PR <n>` | Continues the appropriate sub-loop for that PR |
| `start issue <n> locally` | Routes to local phased implementation |
| `start issue <n> locally, then continue the loop` | Starts local, then enters the full loop |
| `continue the current dev loop` | Auto-detects and continues what's active |
| `status` / `what state is the dev loop in?` | Reports current loop state |

You do **not** need to know or specify which internal loop to use. The routing is deterministic based on:
- what artifact is active (issue, PR, local branch)
- who owns the next move (local, Copilot, external human, reviewer)
- what phase the work is in (intake, implementation, review, waiting, merge)

## How routing works

1. **Parse intent**: Your command is parsed into a structured intent
2. **Resolve state**: Current state is gathered from available signals (GitHub API, local branch, existing loop state)
3. **Route**: The intent + state are matched to exactly one internal strategy
4. **Execute**: The selected strategy runs (local implementation, Copilot follow-up, etc.)

## Internal strategies

The unified façade dispatches to these strategies (you don't need to invoke them directly):

- **Local implementation** — phased local dev work (formerly `dev-loop`)
- **Issue intake** — issue normalization and Copilot assignment (formerly `copilot-autopilot`)
- **Copilot PR follow-up** — PR watch/review/fix loop (formerly `copilot-dev-loop`)
- **External PR follow-up** — PR from external human contributor
- **Reviewer/fixer** — reviewer-side inner loop
- **Wait/watch** — polling for CI, reviews, external events
- **Approval/merge** — final merge gate

## Compatibility

The old entrypoints (`dev-loop`, `copilot-dev-loop`, `copilot-autopilot`) continue to work as compatibility shims. They route through the same unified system internally.

## Contract

See `docs/unified-dev-loop-contract.md` for the full routing contract, state model, and migration plan.

## Implementation

The routing logic lives in `packages/core/src/loop/unified-dev-loop.mjs` and is:
- purely functional (no I/O or side effects)
- deterministic (same inputs always produce same output)
- tested (see `packages/core/test/unified-dev-loop.test.mjs`)

## Authority and safety rules

Core safety rules (same as other skills in this repo):

- Source code, tests, CI, and config are authoritative.
- GitHub Issues are the backlog. Do not invent a parallel backlog file.
- Before any state-changing action, get explicit confirmation unless the user's latest message already clearly authorizes that action.
- State-changing actions include: local edits, commits, pushes, merges, rebases, branch deletion, issue assignment, label or milestone changes, PR reviews, thread resolution, workflow triggers, and publication.
- Keep scope tight to the issue/PR at hand.

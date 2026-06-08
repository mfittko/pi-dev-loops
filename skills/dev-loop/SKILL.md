---
name: dev-loop
description: >-
  Single public dev-loop entrypoint. Resolve canonical current state first,
  then load only route-specific internal skills.
user-invocable: true
compatibility: Pi skill for git+GitHub repositories. Requires gh auth; async follow-up works best in Pi/TelePi sessions.
allowed-tools: read bash edit write subagent review_loop
---

**No-implicit-start rule:** Never start implementation without explicit instruction.

**Work-origin rule:** All work must originate from a tracked artifact: a GitHub issue or a persisted markdown plan file.

# Unified Dev Loop

This is the public `dev-loop` façade — a summary of the authoritative routing contract. The authoritative contract is [Public Dev Loop Contract](../docs/public-dev-loop-contract.md). Runtime evaluator: `@pi-dev-loops/core/loop/public-dev-loop-routing`. For status/progress/readiness/merge-state/next-step queries, resolve authoritative artifact identity first; for issue targets, identity resolution is handled by the startup resolver. Fail closed to reconcile/unknown when unresolved. When an open linked PR exists, treat it as the single canonical artifact for the issue and reuse it instead of opening another PR.

## Installed skill layout

Required installed runtime contract docs are shared bundled copies under `../docs/` from this skill directory. Read those bundled `../docs/` files from the installed skill layout — do not assume a source checkout. If a required bundled contract doc is missing, treat it as a packaging/installer bug.

## Startup procedure

### Main agent (read-only)

The main agent must **always** dispatch the `dev-loop` async subagent for any dev-loop work.
Do not run `dev-loops loop startup` or any startup resolver in the main agent.
The resolver requires `PI_SUBAGENT_RUN_ID` and only runs inside the async subagent context.

### Dev-loop subagent (post-dispatch)

The subagent builds the handoff envelope via `buildDevLoopHandoffEnvelope()` from `@pi-dev-loops/core` as its first action. The envelope determines `requiredReads`, `nextAction`, `stopRules`, and `acceptance` — load only those files, execute only that bounded task. See [Workflow Handoff Contract](../docs/workflow-handoff-contract.md) for the derivation contract.

**Retrospective checkpoint gate:** the resolver reads `.pi/dev-loop-retrospective-checkpoint.json` and injects the state. When the checkpoint is `missing` and the repo setting `.pi/dev-loop/settings.yaml` `workflow.requireRetrospective` is `true`, the resolver returns `needs_reconcile`. Complete or explicitly skip the retrospective before starting.

**Pre-delegation gate (mandatory — subagent only):** Before delegating async work targeting an existing PR, the dev-loop subagent must run `node scripts/loop/copilot-pr-handoff.mjs` and abort if `action: "stop"`. When `terminal: true`, proceed inline. When `terminal: false`, resolve the blocking condition first.

**Worktree cwd (mandatory — subagent only):** Always use a worktree checkout for git operations, file reads/writes, and validation commands — never use the `main` checkout.

**Worktree fetch (mandatory — subagent only):** Always run `git fetch origin` before creating or reusing any worktree.

## Route table

Load only the route-specific internal skill required by `selectedStrategy`:

| Strategy | Route pack to load |
| --- | --- |
| `local_implementation` | [Local Implementation Skill](../local-implementation/SKILL.md) |
| `issue_intake` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) + [Issue Intake Procedure](../docs/issue-intake-procedure.md) |
| `copilot_pr_followup` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) |
| `external_pr_followup` | same as `copilot_pr_followup` |
| `reviewer_fixer` | same as `copilot_pr_followup` |
| `wait_watch` | same as `copilot_pr_followup` |
| `final_approval` | same as `copilot_pr_followup` + [Final Approval Skill](../final-approval/SKILL.md) |

Do not preload route packs before the resolver selects the strategy.

## Async dispatch

**Async dispatch rule (enforced):** the resolver enforces fail-closed for GitHub-first strategies. Inline invocation without `PI_SUBAGENT_RUN_ID` is rejected. See [Startup procedure](#startup-procedure) steps 3-4.

## Guard rules (subagent reference)

**Handoff envelope precedence:** The subagent builds the envelope as its first action. Read it first, load only `requiredReads`, execute `nextAction`. See [Dev-loop subagent](#dev-loop-subagent-post-dispatch). Derivation contract: [Workflow Handoff Contract](../docs/workflow-handoff-contract.md).

**Handoff contract rule:** When no envelope is present, use the `workflow-handoff-contract.md` contract. Never delegate with abbreviated task summaries. Include deterministic routing inputs, explicit `cwd`, bounded task scope, exit conditions.

**Inline-first rule:** Prefer inline commands over nested async delegation when managing a single PR. Use nested delegation only for parallel fan-out or when the parent needs to continue other work.

**Bounded async task contract:** Break work into discrete tasks with clear inputs, explicit outputs, bounded scope. No shell polling — use `run-watch-cycle.mjs` or `gh run watch`.

**Round-cap budget check (enforced):** After every watch cycle, fix pass, or reply-resolve, check whether completed Copilot review rounds have reached the maximum (default: 5). Stop re-requesting Copilot review when the limit is reached — never re-request after the cap.

## Shorthand issue-based auto trigger contract

- `auto dev loop on issue <n>` → public `dev-loop` intent `auto_continue_current` after authoritative current-state resolution
- Continue through GitHub/Copilot loop until stop condition or human approval checkpoint
- Stop at the human approval checkpoint by default unless merge explicitly authorized

## No gate exemptions

All PRs must pass the full gate pipeline before merge. No scope is exempt: docs-only, tooling, meta, configuration, internal-process — all require `draft_gate`, Copilot review, and current-head `pre_approval_gate` evidence.

## Authority boundary

- Source code, tests, config, CI, and shared contract docs are authoritative.
- Main-agent delegation contract: [Main Agent Contract](../docs/main-agent-contract.md) — absolute read-only boundary; all mutations flow through `dev-loop` async subagent.
- Before any state-changing action, get explicit confirmation unless already authorized.
- A question requires an answer, not an action.
- Stop and ask rather than guessing when facts don't agree.

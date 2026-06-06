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

**Retrospective checkpoint gate (#462):** the resolver reads `.pi/dev-loop-retrospective-checkpoint.json` and injects the state. When the checkpoint is `missing` and the repo setting `.pi/dev-loop/settings.yaml` `workflow.requireRetrospective` is `true`, the resolver returns `needs_reconcile`. Complete or explicitly skip the retrospective before starting.

## Route table

Load only the route-specific internal skill required by `selectedStrategy`:

| Strategy | Route pack to load |
| --- | --- |
| `local_implementation` | [Local Implementation Skill](../local-implementation/SKILL.md) |
| `issue_intake` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) + [Issue Intake Procedure](../docs/issue-intake-procedure.md) |
| `copilot_pr_followup` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) |
| `external_pr_followup` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) |
| `reviewer_fixer` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) |
| `wait_watch` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) |
| `final_approval` | [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) + [Copilot Loop Operations](../docs/copilot-loop-operations.md) + [Final Approval Skill](../final-approval/SKILL.md) |

Do not preload local implementation, issue intake, PR follow-up, or final approval procedure before the resolver selects that route.

## After routing: execution directive

After the resolver selects a strategy and the route pack is loaded, the routed strategy's procedure is the execution plan — not reference material. Follow it.

**Async dispatch rule (#465, enforced):** the resolver enforces this fail-closed for GitHub-first strategies (`issue_intake`, `copilot_pr_followup`, `external_pr_followup`, `reviewer_fixer`, `wait_watch`). Inline invocation without `PI_SUBAGENT_RUN_ID` is rejected with exit code 1 (stderr JSON: `{"ok":false,"error":"...","asyncStartContract":"rejected"}`) unless maintainer-controlled repository policy explicitly relaxes startup. Default posture remains `required`. For any routed strategy where the resolver's `canonicalStateSummary.requiresAsyncDispatch` is `true`, dispatch the strategy as a single async dev-loop subagent (the `dev-loop` agent) rather than executing steps inline in the parent session. The dispatched agent owns parallel review fan-out, fixer passes, gate comments, state transitions, and sub-delegation internally.

Strategies where `requiresAsyncDispatch` is `false` (`local_implementation`, `final_approval`, `none`) may run inline — local phases are often interactive, and final approval requires explicit human confirmation before GitHub mutations.

## Async delegation guard rules (#524)

**Pre-delegation gate (#524, mandatory):** Before delegating async subagent work that targets an existing PR (watch/follow-up strategies), run `node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --repo <owner/name> --pr <number>` and abort if `action: "stop"`. This prevents delegating work that has no automatic next step — the handoff tool is the authority, not the parent session's judgment. When `action: "stop"` and `terminal: true`, the loop phase is complete — proceed inline to the next gate rather than delegating a polling task.

> **Path resolution:** In the source repo, `<resolved-skill-scripts>` = `scripts/` (repo-root-relative) or equivalently `../../scripts/` (relative to this skill file). In installed skills, resolve from the skill's installation layout per the [skill asset path resolution rule in copilot-pr-followup/SKILL.md](../copilot-pr-followup/SKILL.md#skill-asset-path-resolution).

**Worktree cwd rule (#524, mandatory):** Always set `cwd` to the worktree when delegating dev-loop work to subagents. Never delegate with the parent's `main` branch checkout as the working directory. The worktree path is authoritative for all git operations, file reads/writes, and validation commands in delegated runs.

**Worktree fetch rule (#567, mandatory):** Always run `git fetch origin` before creating or reusing any worktree. Never create a worktree from a stale local `origin/main` reference.

**Handoff envelope precedence (#536):** When a handoff envelope (generated by `buildDevLoopHandoffEnvelope()` from `@pi-dev-loops/core`) is present, it is the primary handoff artifact. The agent reads the envelope first, then loads only the listed `requiredReads` before executing `nextAction`. Prose task composition is a fallback when no envelope is available. The derivation contract is documented in [Workflow Handoff Template](../docs/workflow-handoff-template.md).

**Handoff template rule (#524):** All subagent delegation must use the `workflow-handoff-template.md` contract (resolved path: `../docs/workflow-handoff-template.md` relative to the skill directory) when no envelope is present. Never delegate with abbreviated task summaries. The handoff template must include:
- Deterministic routing inputs (current state, gate boundary, next action)
- Explicit `cwd` path to the worktree
- Clear bounded task scope (single responsibility per delegation)
- Exit conditions and where to write output artifacts
- Intercom coordination instructions if cross-run signaling is needed

**Inline-first rule for single-PR workflows (#524):** When the dev-loop agent is managing a single PR through its lifecycle, prefer inline commands over nested async subagent delegation. This does not override the enforced `requiresAsyncDispatch` routing rule — the outer dev-loop session still dispatches asynchronously when the resolver requires it. Use nested subagent delegation only when:
- Parallel fan-out review is explicitly needed
- The task is bounded with clear inputs/outputs and a deterministic exit condition
- The parent session needs to continue other work while waiting

**Bounded async task contract (#524):** When async delegation is needed, break work into discrete tasks with:
- Clear input artifacts (file paths, PR numbers, state snapshots)
- Explicit output expectations (file paths, JSON payloads, exit codes)
- No shell polling loops — use `run-watch-cycle.mjs` or `gh run watch` for waiting
- Intercom coordination for cross-run state updates
- Parent session retains loop ownership; subagents handle bounded slices only

**Round-cap budget check (#524, enforced):** After every watch cycle, fix pass, or reply-resolve — and **before** any `request-copilot-review.mjs` re-request — check `detect-copilot-loop-state.mjs` output for `snapshot.copilotReviewRoundCount >= maxCopilotRounds` (default: 5). The detector (`interpretLoopState` in `packages/core/src/loop/copilot-loop-state.mjs`) only emits a `round_cap_*` state when ALL of these are true:
- the round cap is reached (`copilotReviewRoundCount >= maxCopilotRounds`)
- no Copilot review request is in flight (`copilotReviewRequestStatus` is not `"requested"` or `"already-requested"`)
- the detector has not already selected a higher-priority terminal/draft state (`no_pr`, `done`, `pr_draft`, `review_request_unavailable`, `blocked_needs_user_decision`) — those take precedence and round-cap routing is skipped in those cases
- Given all that, the detector selects one of two explicit `state` values:
- `state: "round_cap_clean_fallback"` — when `unresolvedThreadCount === 0` AND `ciStatus` is `"success"` or `"crediblyGreen"`. Treat this as the `pre_approval_gate` entry signal (do not re-request Copilot review).
- `state: "round_cap_reached"` — when `unresolvedThreadCount > 0` OR `ciStatus` is not `"success"`/`"crediblyGreen"`. Reply-resolve any remaining intentionally deferred threads with a short `deferred to follow-up` note and stop; do **not** re-request Copilot review.
- The round-cap check is a per-iteration gate, not an end-of-loop assertion

**Deterministic routing step (#524):** The pre-delegation gate above determines whether delegation is appropriate. When it returns `action: "stop"` with `terminal: true`, the loop phase is complete — proceed inline to the next gate rather than delegating a polling task.

## Shorthand issue-based auto trigger contract

- treat `auto dev loop on issue 112` as the public `dev-loop` intent `auto_continue_current` after authoritative current-state resolution
- continue through the normal GitHub/Copilot loop until the next genuine stop condition or the human approval checkpoint
- stop at the human approval checkpoint by default unless merge was explicitly authorized

## Authority boundary and stop rules

- Source code, tests, config, CI, and shared contract docs are authoritative.
- This dispatcher summarizes the public routing contract; it does not redefine the shipped runtime semantics of helper CLIs, shared loop logic, or extension commands.
- Keep specialized Copilot behavior internal behind `dev-loop`; do not expose internal route packs as peer public workflow entrypoints.
- Before any state-changing action, get explicit confirmation unless the latest user message already clearly authorizes that exact action.
- Questions, preferences, future-tense statements, and implied approval are not confirmation.
- The bare response `ok` is not confirmation.
- Stop and ask for human direction rather than guessing when local facts, GitHub facts, and helper/state-machine output do not agree.

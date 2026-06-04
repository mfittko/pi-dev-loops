---
name: copilot-pr-followup
description: >-
  Internal routed strategy behind `dev-loop` for GitHub-first Copilot-owned PR
  follow-up: inspect the canonical PR state, request or re-request Copilot when
  appropriate, wait deterministically for new review activity, run narrow Pi
  fix/reply/resolve passes, verify gate evidence, and stop for explicit human
  approval before merge.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth; async follow-up works best in Pi/TelePi sessions.
allowed-tools: read bash edit write subagent review_loop
user-invocable: false
---

# Copilot PR Follow-up

This skill is the canonical internal `copilot_pr_followup` route behind the public `dev-loop` façade.

It is also the canonical internal owner of the shared post-PR mechanics used by this repo:
PR discovery and interpretation, async watch behavior, fix / reply-resolve / re-request flow,
gate sequencing, final approval, and merge-ready preconditions.

## Route ownership

Use this skill whenever the public router lands on any PR-follow-up path that shares the same
post-PR mechanics:
- `copilot_pr_followup`
- `external_pr_followup`
- `reviewer_fixer`
- `wait_watch`

Route-specific companion docs:
- routed `issue_intake` work is implemented through this skill plus [Copilot Loop Operations](../docs/copilot-loop-operations.md) and [Issue Intake Procedure](../docs/issue-intake-procedure.md)
- routed `final_approval` work is implemented through this skill's **Final approval gate** section; [Final Approval](../final-approval/SKILL.md) is now a thin redirect to that canonical section
- the deterministic state-machine/operator guide lives in [Copilot Loop Operations](../docs/copilot-loop-operations.md)

## Operational cookbook

All commands use the resolved skill scripts directory (see [Skill asset path resolution](#skill-asset-path-resolution) below).

**1. Detect current loop state**
```sh
node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>
```
Emits JSON including `{ ok: true, state, allowedTransitions, nextAction, snapshot }`. Follow `nextAction`.

**2. One-step detect → request → emit watch params (preferred handoff contract)**
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --repo <owner/name> --pr <number>
```
Use this helper output as source of truth for the normal routing seam. Interpret:
- `requestWatchContract.routingState` for request-vs-watch posture
- `requestWatchContract.requestStatus` and top-level `action` / `nextAction`
- `watchArgs` only when `action: "watch"` and `requestWatchContract.watchEntryConfirmed=true`
- `requestWatchContract.stopState` for explicit blocked/stop handling

**3. Preferred async wait-boundary helper**
```sh
node <resolved-skill-scripts>/loop/run-copilot-watch-cycle.mjs --repo <owner/name> --pr <number>
```
For explicit async loop entry or continuation, this is a persistent async watch/fix loop, not handoff-only behavior:
- treat the normal PR follow-up path as one loop: `watch → detect → if threads found, fix + reply + resolve → re-request → watch again → … → pre_approval_gate → merge`
- **PERSISTENCE RULE: Do not exit your session until the PR is merged or you hit a hard stop that requires conductor authorization.**
- a single returned watch cycle (`changed`, `timeout`, or `idle`) is never completion by itself
- if `cycleDisposition` is `pending` and `terminal` is `false`, stay attached to the same PR and resume another watch boundary instead of reporting completion
- after Step 7 finishes a fix / reply-resolve / re-request cycle and the deterministic state returns to `waiting_for_copilot_review`, resume this watcher again in the same async session
- default max watch timeout for one Copilot watch boundary is **30 minutes** (`--timeout-ms 1800000`); if that watch budget expires and a refreshed authoritative check still resolves `waiting_for_copilot_review`, stop with `watch timeout — PR #<number> needs manual attention.`
- if the user explicitly asks for async handoff-only behavior, say that out loud and stop after the handoff boundary; otherwise do not silently reinterpret async loop entry as handoff-only

**4. Low-level helpers**
```sh
node <resolved-skill-scripts>/github/request-copilot-review.mjs --help
node <resolved-skill-scripts>/github/watch-copilot-review.mjs --help
node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --help
```

For detailed machine guarantees, judgment calls, pre-follow-up planning rules, PR description rules, and timeout defaults, use [Copilot Loop Operations](../docs/copilot-loop-operations.md).

## Required startup reads

Read the canonical entrypoint briefing first: [Entrypoint Briefing (Copilot PR Follow-up)](../docs/entrypoint-briefing-copilot-pr-followup.md). Then read only the contract docs needed for the current step:

- [Agent Instructions](../../AGENTS.md) (repo constitution)
- [Public Dev Loop Contract](../docs/public-dev-loop-contract.md) (always)
- [Retrospective Checkpoint Contract](../docs/retrospective-checkpoint-contract.md) (when async state/resume applies)
- Active GitHub issue/PR
- Task-relevant source, tests, config, and CI

Route-dependent: see [Copilot Loop Operations](../docs/copilot-loop-operations.md) and [Issue Intake Procedure](../docs/issue-intake-procedure.md) when relevant.
Verify all material claims against source, tests, configuration, and CI.

## Skill asset path resolution

When this skill refers to helper paths such as `scripts/...` or `docs/...`, resolve them from the actual skill installation layout you are running, not from the active target repository checkout.

Use this rule:
- if the skill is installed as a normalized standalone copy, the required bundled contract docs live under the shared `../docs/` directory next to the installed skill directories; do not assume helper scripts are bundled unless that installed layout actually contains them
- if you are working in the `pi-dev-loops` source repository, this skill file lives under `skills/copilot-pr-followup/`, so source-repo helper scripts live two levels up at `../../scripts/`, while required bundled contract docs live one level up at `../docs/`
- when in doubt, resolve helper paths relative to this [skill file](./SKILL.md) first, then verify the target file exists before running it

Required bundled runtime contract docs for installed copies of this skill:
- [Public Dev Loop Contract](../docs/public-dev-loop-contract.md)
- [Retrospective Checkpoint Contract](../docs/retrospective-checkpoint-contract.md)
- [Issue Intake Procedure](../docs/issue-intake-procedure.md)
- [Copilot Loop Operations](../docs/copilot-loop-operations.md)

Read those bundled `../docs/` files from the installed skill layout instead of assuming the source repository checkout is present. If any required bundled contract doc is missing from the installed skill layout, treat that as a packaging/installer bug.
Do not assume `scripts/...` is repo-local to the target codebase you are operating on.

## Authority and safety rules

Source code, tests, CI, and config are authoritative. Generated wiki is navigation aid only. See [Confirmation Rules](../docs/confirmation-rules.md), [Stop Conditions](../docs/stop-conditions.md), and [Merge Preconditions](../docs/merge-preconditions.md) for authorization boundaries.

## Structural quality

Apply [Structural Quality](../docs/structural-quality.md) standards from the `deep` review angle during implementation and follow-up fixes.

## Step 5: PR discovery and interpretation

Treat the PR as the main working artifact once it exists.

Inspect:
- PR body and title
- whether the PR body actually satisfies the PR description contract from [Copilot Loop Operations](../docs/copilot-loop-operations.md)
- that the PR body contains `Closes #N` (or `Fixes #N`) for the linked issue; if missing, stop and require it before continuing
- PR author, because verdict handling differs for PRs not opened by the active GitHub user
- review summaries
- unresolved inline comments and issue comments
- latest commits
- CI results

At the issue-assignment seam, do not treat every linked draft PR as ready follow-up work. Use `detect-initial-copilot-pr-state.mjs` (which delegates linked-PR selection to `detect-linked-issue-pr.mjs`) and keep waiting when the state is `waiting_for_initial_copilot_implementation`.

When confirming whether Copilot is requested as a reviewer, do not rely solely on `gh pr view --json reviewRequests`.

Prefer the deterministic helper `request-copilot-review.mjs` from the resolved skill scripts directory when it exists. That helper verifies reviewer state through `gh api repos/<owner>/<repo>/pulls/<number>/requested_reviewers`, which is more reliable here than `gh pr view --json reviewRequests`.

Use it directly for both the initial ready-for-review request and later validated re-requests:
```sh
node <resolved-skill-scripts>/github/request-copilot-review.mjs \
  --repo <owner/name> \
  --pr <number>
```
If a same-head clean-converged re-request is intentionally authorized, use:
```sh
node <resolved-skill-scripts>/github/request-copilot-review.mjs \
  --repo <owner/name> \
  --pr <number> \
  --force-rerequest-review
```
Do **not** request Copilot by posting literal `/copilot` or `/copilot re-review` PR comments.
`request-copilot-review.mjs` now detects bypass `@copilot`/`/copilot` PR comments from non-Copilot authors and returns `blocked_by_copilot_comment` status; delete the violating comment(s) and retry through the helper.

When a PR is moved from draft to ready, explicitly attempt to request Copilot review rather than assuming repository automation will do it.

After any follow-up fix commit is pushed to an open PR, explicitly decide whether another Copilot pass is desired.
If yes, first return the updated head to a green or credibly green validation posture (smallest honest local validation is green and there is no known fixable CI-red state). Then request Copilot review again rather than assuming GitHub will automatically re-request it for the new head.

If the explicit request fails because Copilot review is not enabled for the repository, the reviewer identity is not requestable, or GitHub rejects the request because the reviewer is not a collaborator/requestable actor, record that exact limitation explicitly.

Do not treat an attempted request as equivalent to a confirmed request.

For the resolved `request-copilot-review.mjs` helper, branch on the machine-readable result:
- `requested`: if another Copilot pass is actually desired, immediately re-baseline with `node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>` and branch on returned `state`, `snapshot.copilotReviewOnCurrentHead`, `snapshot.ciStatus`, and `nextAction`; only enter persistent waiting through `run-copilot-watch-cycle.mjs` or `gh run watch`, otherwise report the wait state and resume later without bash polling
- `already-requested`: apply the same detector-first rebasing and wait branching as `requested`; do not keep the session alive with ad hoc bash polling
- `suppressed_same_head_clean`: report the clean-converged state and stop unless an explicit `--force-rerequest-review` bypass is intentionally authorized
- `unavailable`: report the limitation and stop unless the user explicitly wants passive waiting without a fresh request
- non-zero / unexpected failure: stop and report the error rather than entering a sleep/watch loop

## Step 6: Async watch behavior

When the user wants Pi to wait for fresh Copilot review activity, start every PR-follow-up wait seam with one detector refresh:
```sh
node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>
```

Allowed wait tools for this PR follow-up loop:
- one-shot PR wait-state classification: `detect-copilot-loop-state.mjs`
- persistent Copilot review wait: `run-copilot-watch-cycle.mjs`
- watch refresh after `timeout`/`idle`: `copilot-pr-handoff.mjs --watch-status <changed|timeout|idle>`
- CI wait when a current-head workflow run id is known: `gh run watch <run-id> --repo <owner/name>`
- otherwise: exit cleanly and resume later from a fresh detector call

Practical rule for this repo:
- `state=waiting_for_copilot_review` with `snapshot.copilotReviewOnCurrentHead=false`: do **not** poll manually; either run `node <resolved-skill-scripts>/loop/run-copilot-watch-cycle.mjs --repo <owner/name> --pr <number>` for persistent async waiting or report the wait state and resume later after the single detector call
- `state=waiting_for_ci` with `snapshot.ciStatus` in `{ "pending", "none" }`: do **not** poll manually by default; use `gh run watch <run-id> --repo <owner/name>` when the current-head run id is already known, otherwise report pending CI and resume later after the single detector refresh. Bounded exception: if GitHub created zero current-head check suites/statuses, the previous head rollup was green, and local `npm run verify` already passed for the same current head, rerun `detect-copilot-loop-state.mjs` with `--local-validation-head-sha <current-head-sha>` so the detector can promote that exact zero-suite case to `snapshot.ciStatus="crediblyGreen"` instead of waiting forever on raw `none`.
- `snapshot.ciStatus="failure"` remains a stop/fix state, never a wait loop

Preferred approach for Copilot review follow-up:
- route request/re-request/watch decisions through `copilot-pr-handoff.mjs` output instead of re-implementing branch logic in markdown
- enter watcher mode only when handoff returns `action: "watch"` with `requestWatchContract.watchEntryConfirmed=true`
- for explicit async loop entry or continuation, prefer `run-copilot-watch-cycle.mjs` so the handoff → watch boundary stays deterministic and uses the emitted non-zero watch timeout
- if watcher status is `changed`, immediately re-enter the Step 7 fix / reply-resolve / validate path; do not stop at `review requested` or after one watch cycle
- if watcher status is `timeout`/`idle`, re-run `copilot-pr-handoff.mjs --watch-status <status>` exactly once to refresh authoritative state
- if that refreshed state is still `waiting_for_copilot_review` after the default 30-minute watch budget was exhausted, treat it as a hard stop and report `watch timeout — PR #<number> needs manual attention.` rather than pretending the loop completed cleanly
- otherwise continue from the refreshed deterministic state instead of guessing
- zero-timeout `idle` probes are for explicit one-shot status/reattach checks only; they are not the normal async wait mechanism
- after a successful fix / reply-resolve / re-request cycle, returning to `waiting_for_copilot_review` is a persistence boundary: resume the watcher instead of reporting completion
- if a child async run exits and the refreshed state remains non-terminal (for example `waiting_for_copilot_review`) before merge and without a hard stop, treat that as early exit and automatically restart/resume the same-PR follow-up path when feasible
- delegate fix findings to the `fixer` subagent: dev-loop dispatches fixer per review round, receives results, and decides next action; do not run inline fix/reply/resolve passes in-watcher
- do not report completion while unresolved Copilot feedback remains

### Canonical async dispatch wording

Every async dev-loop dispatch task body must include this clause verbatim so fresh-context subagents inherit the gate requirement:

> Before reporting merge-ready or stopping at the human approval gate, you must complete the pre_approval_gate procedure and verify that a visible clean gate-review comment exists on the PR for the current head SHA. Do not stop or report completion without this evidence.

Key rules:
- expected polling idle time is normal
- do not restart watchers just because there has been a short quiet period
- helper-owned sleep inside `run-copilot-watch-cycle.mjs`, `watch-copilot-review.mjs`, or `watch-initial-copilot-pr.mjs` is allowed
- agent-authored shell polling is forbidden
- do not use `nohup`, detached shell jobs, `tmux`, `screen`, or ad hoc `for i in $(seq ...)`, `while true`, `until ...; do sleep ...; done`, or `sleep`-retry bash loops for this workflow
- do not wrap repeated `gh pr view`, `gh pr checks`, `gh api`, or `detect-copilot-loop-state.mjs` calls inside shell polling loops
- do not bypass session-based async notifications with detached shell automation unless explicitly asked
- if a watcher is sleeping between polls, prefer raising the orchestration inactivity threshold over interrupting the child
- when dispatching a dev-loop subagent that will enter a Copilot watch cycle, set `control.needsAttentionAfterMs` to at least 300000 (5 minutes) — Copilot review arrival is inherently slow and 60s is too aggressive for watch subagents
- if Pi async subagents or the designated async follow-up skill are not appropriate or available, stop and report rather than improvising a shell watcher
- the async-start contract is also enforced in code: `outer-loop.mjs` fails closed unless it detects a visible Pi-managed async run id (`PI_SUBAGENT_RUN_ID`). Session-only markers (`PI_SESSION_ID`, `PI_ASYNC_CONTEXT`) and detached/local background fallback are diagnostic-only and do not satisfy startup. Snapshot/test input mode (both `--copilot-input` and `--reviewer-input`) is exempt. Use `PI_ASYNC_START_BYPASS=1` only for explicitly authorized standalone runs, never to route around the in-session async requirement.

## Step 7: Pi review/fix follow-up loop

This step covers four responsibilities: the draft gate right before `gh pr ready`, the narrower post-review follow-up loop once actionable feedback exists, the pre-approval gate before calling the PR merge-ready, and the final approval / merge boundary.

### Follow-up loop when actionable review feedback exists

When actionable review feedback exists, use a narrow follow-up loop:

1. inspect unresolved comments/threads and failing checks
2. before the first local file write in each fixer pass on a Copilot-assigned PR, run `node <resolved-skill-scripts>/loop/pre-write-remote-freshness-guard.mjs --branch <headRefName>` as a required fail-closed guard
   - source `<headRefName>` from authoritative PR state (`headRefName`), not from a local branch guess
   - if the guard exits non-zero (`remote_ahead`), stop writing locally, reconcile to the refreshed remote head, then restart the fixer pass
3. classify findings:
   - must-fix: blocks gate; always fixed
   - worth-fixing-now: blocks gate when `blockCleanOnFindingSeverities` includes it; fixed when blocking
   - defer / non-blocking / disagree
4. apply only the accepted narrow fixes
5. run the smallest validation that honestly proves the fix
6. if files changed, run `node <resolved-skill-scripts>/loop/pre-commit-branch-guard.mjs --expected-branch <headRefName>` immediately before every `git add && git commit` sequence as a required fail-closed guard
   - source `<headRefName>` from authoritative PR state (`headRefName`), not from a local branch guess
   - if the guard exits non-zero (`branch_mismatch`), stop and realign to the expected branch before staging or committing
7. if files changed, push the resolving commit before any thread reply claims the fix is present
8. when a comment or thread is actually addressed, reply on GitHub with a short resolution note that references the resolving commit SHA or commit URL when applicable
   - for one thread, must use the deterministic helper `reply-resolve-review-thread.mjs` from the resolved skill scripts directory
   - when the same bounded resolution note applies to multiple matching unresolved threads, use `reply-resolve-review-threads.mjs` instead of ad hoc inline `gh api` / `gh api graphql` mutations
   - when using the single-thread helper, pair `--comment-id` and `--thread-id` from the same fresh PR thread snapshot rather than mixing ids across review rounds
   - use a body file under `tmp/` rather than inline shell text for the single-thread reply body; for the batch helper, prefer stdin from that same `tmp/` body file rather than inline shell text
   - when the intent is GitHub linkability, keep commit SHAs and issue/PR refs as plain text (for example 3ee82fc and owner/repo#70) and do not wrap them in backticks
   - keep backticks for actual code/path/CLI literals only
   - if either helper was newly added or recently changed, smoke-check it against one real thread before assuming the rest of the loop can rely on it
9. before resolving an addressed review thread, run a post-fix verification checkpoint
   - confirm the GitHub reply actually exists on the intended thread/comment, not only in local notes or helper stdout
   - confirm the pushed current-head diff genuinely addresses the reviewer concern on the flagged lines or pattern; if the concern is only partially addressed, leave the thread open and explain what remains
   - refresh the API-backed thread snapshot via `capture-review-threads.mjs` and use that refreshed data — including `unresolvedThreadCount` — for follow-up decisions rather than prose assumptions
   - if any verification check fails, do **not** resolve the thread; leave it open, add a short explanation when needed, and re-enter the fix/reply loop
10. resolve the addressed review thread only after the reply is attached successfully, the verification checkpoint passes, and the concern is genuinely addressed
    - do not stop at a local fix if GitHub-side reply/resolve is authorized
11. after completing reply/resolve for a pass, verify `unresolvedThreadCount === 0` via `capture-review-threads.mjs` before proceeding
    - if the refreshed snapshot reports a non-zero unresolved thread count, re-enter the reply/resolve loop for the missed threads
12. only after GitHub-side reply/resolve work is done for the addressed threads and the refreshed thread snapshot proves `unresolvedThreadCount === 0`, decide whether another Copilot pass is desired
    - resolve the review-round cap from config via `resolveRefinementConfig(config, "maxCopilotRounds")` from `@pi-dev-loops/core/config`; default config ships `maxCopilotRounds: 5`
    - use `snapshot.copilotReviewRoundCount` from `detect-copilot-loop-state.mjs` / `copilot-pr-handoff.mjs` as the completed Copilot review-round count for the current PR
    - if `snapshot.copilotReviewRoundCount >= maxCopilotRounds`, do **not** re-request Copilot review
    - when the round cap is reached **and** the refreshed thread snapshot proves `unresolvedThreadCount === 0` **and** current-head CI is `success` or `crediblyGreen`, treat that clean state as eligible for `pre_approval_gate` fallback instead of deadlocking on another Copilot rerequest
    - when using that fallback, add a short round-exhaustion note to the visible `pre_approval_gate` gate evidence so the PR records why no further Copilot rerequest occurred
    - if the round cap is reached before the PR is thread-clean or before CI is green/credibly green, reply-resolve any remaining intentionally deferred threads with a short `deferred to follow-up` note, then stop and report that the Copilot round limit was reached
    - **Signal-gated re-request suppression (diminishing-returns policy):** resolve low-signal config from `resolveRefinementConfig(config, "stopOnLowSignal")` / `resolveRefinementConfig(config, "lowSignalRoundThreshold")` / `resolveRefinementConfig(config, "lowSignalMaxComments")` from `@pi-dev-loops/core/config`; defaults: `stopOnLowSignal: true`, `lowSignalRoundThreshold: 3`, `lowSignalMaxComments: 2`
    - the detector classifies Copilot review-thread comments by signal level using heuristic keyword matching (no API confidence data required):
      - **High** — blocking bugs, security issues, contract violations, crashes, data loss, regressions → always re-request
      - **Mid** — meaningful improvements, design questions, refactoring suggestions → fix once; suppress re-request when round threshold met
      - **Low** — cosmetic nits, phrasing preferences, trivial cleanup → fix once; do NOT re-request
    - when `stopOnLowSignal` is enabled and `copilotReviewRoundCount > lowSignalRoundThreshold` and `actionableThreadCount <= lowSignalMaxComments` and the last Copilot round's maximum signal level is `mid` or `low` (not `high`), the state machine returns `LOW_SIGNAL_CONVERGED` (terminal) instead of `READY_TO_REREQUEST_REVIEW`, routing to `pre_approval_gate` without further re-requests
    - when signal classification data is unavailable (null), the heuristic falls back to the `actionableThreadCount <= lowSignalMaxComments` check
    - the low-signal heuristic is applied by `detect-copilot-loop-state.mjs` through the shared `interpretLoopState` / `summarizeLoopInterpretation` contract
    - if yes and the round cap has not been reached, run the smallest honest local validation for the accepted fix scope
    - if that local validation is still known red, continue remediation instead of re-requesting Copilot
    - after a fix push advances the PR head SHA, treat previous-head CI evidence as stale for any CI-dependent follow-up decision and immediately re-run `node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>` for the new head
    - refresh/re-read current-head CI/check data before advancing and apply the contract in [Copilot CI Status Contract](../docs/copilot-ci-status-contract.md)
    - passing local validation alone does not satisfy a step that still requires GitHub CI/check readiness for the current head
    - only results for the current head SHA may satisfy a CI-dependent follow-up step; older-head results must not unblock the new head
    - if the current-head detector output still says `state=waiting_for_ci` with `snapshot.ciStatus` in `{ "pending", "none" }`, wait only via `gh run watch <run-id> --repo <owner/name>` for a known run id or else stop/resume later after the single detector refresh
    - if GitHub CI/checks for the updated head are known red for a fixable issue, continue remediation instead of re-requesting Copilot
    - only once the updated head is green or credibly green, explicitly re-request Copilot review for the new head rather than assuming it remains requested
    - only enter a wait/watch loop if the request result is confirmed as `requested` or `already-requested`
    - for `requested` / `already-requested`, immediately re-baseline with `detect-copilot-loop-state.mjs`; if the returned state is `waiting_for_copilot_review`, use `run-copilot-watch-cycle.mjs` or stop/resume later, and if the returned state is `waiting_for_ci`, use `gh run watch` for a known run id or stop/resume later after that single detector refresh
    - if the request result is `unavailable`, report that limitation and stop unless the user explicitly wants passive waiting anyway
    - if the request command fails unexpectedly, stop and report the error rather than sleeping and hoping for a new review
13. after a confirmed re-requested Copilot pass, refresh PR thread state again before reporting completion; if fresh Copilot threads exist, return to this follow-up loop rather than stopping at `review requested`
14. after a confirmed re-request returns the PR to `waiting_for_copilot_review`, jump back to Step 6 and keep the same session alive; do not exit on `review requested` alone
15. if scope has broadened, stop and ask before continuing

Do not treat `fix applied locally` as the end of the loop when the workflow also requires GitHub-side reviewer follow-up. If comment/reply authorization is withheld, report explicitly that the code may be fixed while the PR conversation state remains unresolved.

### Mandatory gate-comment command contract

For every `draft_gate` or `pre_approval_gate` comment, you MUST run:

```sh
node <resolved-skill-scripts>/github/upsert-gate-review-comment.mjs \
  --repo <owner/name> \
  --pr <number> \
  --gate <draft_gate|pre_approval_gate> \
  --head-sha <current_head_sha> \
  --verdict <clean|findings_present|blocked> \
  --findings-summary "<summary>" \
  --next-action "<next action>" --findings-severity-counts '{"must-fix":0,"worth-fixing-now":0,"defer":0}'
```

Do NOT use `gh pr comment`, `gh api`, or `gh pr review` for gate comments.

`--force --force-reason` on `upsert-gate-review-comment.mjs` is a narrow operator-authorized CI override for the helper itself, not the default gate path. Use it only when the helper refuses gate entry solely because the current head is `blocked_needs_user_decision` with `ciStatus="failure"`, and only after the user explicitly authorizes ignoring that current-head CI failure for this one gate-comment upsert. It does **not** bypass stale-head checks, unresolved-thread / unsettled-review refusal, non-draft `draft_gate` refusal, merge conflicts, or other legality checks.

### Draft gate contract (before marking PR ready for review)

The canonical gate-review comment contract is [Gate Review Comment Contract](../../docs/gate-review-comment-contract.md). This section summarizes the procedural integration only.

- **Gate name:** Draft gate
- **Trigger / boundary:** right before running `gh pr ready` (draft → ready for review)
- **Skip rule:** before entering the draft gate, run `detect-pr-gate-coordination-state.mjs` and check `draftGateAlreadySatisfied`. If `true`, skip the draft gate entirely — the draft→ready transition was already recorded. `draft_gate` is a one-time gate; do not re-post on new heads once clean draft-gate evidence exists for the transition record. (While the PR is still draft, advancing the head SHA does require a new draft-gate comment for the new head.) This skip rule applies only to the draft boundary.
- **Execution directive:** run the gate-review sub-loop defined in [Gate Review Sub-Loop Contract](../../docs/gate-review-sub-loop-contract.md) with the draft gate review angles resolved from config. The sub-loop follows a mandatory chain:
  1. **Context-builder (mandatory):** produce a shared briefing artifact covering the git diff, adjacent code, current CI/test status, and acceptance criteria. No reviewer runs without this briefing.
  2. **Parallel reviewers (read-only):** fan out one reviewer per gate angle. Each reviewer starts in fresh context (subagent({context:"fresh"}) mandatory), inspects the diff, returns findings via output artifacts only, and never edits files. **Before starting:** run `scripts/github/verify-fresh-review-context.mjs --scope <angle>` to self-verify fresh context; refuse to proceed on contamination. Use `--scope` so parallel reviewers in the same working directory do not trigger false contamination.
  3. **Consolidation:** reconcile all review outputs into a consolidated fix plan with classified findings (must-fix, worth-fixing-now, defer). Write the disposition ledger via `write-gate-findings-log.mjs` before posting any visible comment.
  4. **Disposition ledger:** log every finding with its severity classification and disposition (accepted-for-fix, deferred, disputed, operator_acknowledged) under `tmp/gate-findings/`. The ledger is the durable record; the visible PR comment is a summary.
  5. **Post findings first:** post the findings as a visible PR comment via `upsert-gate-review-comment.mjs` **before** any fix code is applied.
  6. **Fix cycle:** apply accepted fixes for all findings at severities in the gate's `blockCleanOnFindingSeverities` (resolved from config). The fix cycle covers all blocking severities, not only `must-fix`. If `blockCleanOnFindingSeverities` includes `worth-fixing-now`, then worth-fixing-now findings must be fixed before the gate can reach `clean`.
  7. **Re-gate mandatory:** after fixes advance the head SHA, re-run the chain (context-builder → reviewers → consolidation → disposition ledger → post findings) on the new head before crossing the gate boundary. On retry, only re-run reviewers that had findings in the previous pass; context-builder and consolidation always run fresh.
- **Review angles:** resolved at runtime from config via `resolveGateAngles(config, "draft")` from `@pi-dev-loops/core/config`. Default config enables all 14 draft gate angle families; consumer repos may opt out individual angles via `excludeAngles`. Do **not** apply angles from the other gate; each gate owns its own angle list from config.
- **CI prerequisite:** resolve the draft gate config first (`resolveGateConfig(config, "draft")`). When `requireCi=true` (default), wait for green current-head CI before entering `draft_gate`. When `requireCi=false`, the draft gate may proceed without green CI. This draft-only override does **not** relax `pre_approval_gate`; final approval and merge readiness still require green current-head CI.
- **Pass criteria:** all configured draft gate angles pass; all findings at severities in `blockCleanOnFindingSeverities` are addressed; validation passes; no unrelated files are included.
- **Next step after passing:** mark the PR ready for review.
- **Non-substitution rule:** a clean `draft_gate` comment only authorizes the draft → ready-for-review transition for that head SHA. It does **not** satisfy `pre_approval_gate`, final-approval readiness, or merge-ready requirements.
- **Required PR comment:** after the `draft_gate` review runs, post a visible gate-review comment on the PR using the mandatory upsert helper. Keep validation reporting concise: include command names with pass/fail status. Do **not** paste raw passing test output into the visible gate comment. If you include a failing validation excerpt, keep it focused and truncate it to a deterministic retained-prefix length before posting the comment. See [Gate Review Comment Contract](../../docs/gate-review-comment-contract.md) for required fields, verdict definitions, and fail-closed behavior.
- A gate-review comment for an older head SHA does not satisfy this requirement for the current head.
- If the `draft_gate` finds issues, the comment must say that the PR stays draft and needs fixes before retrying.
- Do not run `gh pr ready` unless a visible `clean` `draft_gate` gate-review comment exists for the current head SHA.
- If fixes advance the head SHA **while the PR is still draft**, post a new gate-review comment for the new head.

### Pre-approval gate contract

This is the default pre-approval gate for this workflow boundary. The canonical gate-review comment contract is [Gate Review Comment Contract](../../docs/gate-review-comment-contract.md). This section summarizes the procedural integration only.

- **Gate name:** Pre-approval gate
- **Trigger / boundary:** right before calling a PR/branch review-complete, approval-ready, merge-ready, or ready for final handoff
- **Execution directive:** run the gate-review sub-loop defined in [Gate Review Sub-Loop Contract](../../docs/gate-review-sub-loop-contract.md) with the pre-approval gate review angles resolved from config. The sub-loop follows a mandatory chain:
  1. **Context-builder (mandatory):** produce a shared briefing artifact covering the git diff, adjacent code, current CI/test status, and acceptance criteria. No reviewer runs without this briefing.
  2. **Parallel reviewers (read-only):** fan out one reviewer per gate angle. Each reviewer starts in fresh context (subagent({context:"fresh"}) mandatory), inspects the diff, returns findings via output artifacts only, and never edits files. **Before starting:** run `scripts/github/verify-fresh-review-context.mjs --scope <angle>` to self-verify fresh context; refuse to proceed on contamination. Use `--scope` so parallel reviewers in the same working directory do not trigger false contamination.
  3. **Consolidation:** reconcile all review outputs into a consolidated fix plan with classified findings (must-fix, worth-fixing-now, defer). Write the disposition ledger via `write-gate-findings-log.mjs` before posting any visible comment.
  4. **Disposition ledger:** log every finding with its severity classification and disposition (accepted-for-fix, deferred, disputed, operator_acknowledged) under `tmp/gate-findings/`. The ledger is the durable record; the visible PR comment is a summary.
  5. **Post findings first:** post the findings as a visible PR comment via `upsert-gate-review-comment.mjs` **before** any fix code is applied.
  6. **Fix cycle:** apply accepted fixes for all findings at severities in the gate's `blockCleanOnFindingSeverities` (resolved from config). The fix cycle covers all blocking severities, not only `must-fix`. If `blockCleanOnFindingSeverities` includes `worth-fixing-now`, then worth-fixing-now findings must be fixed before the gate can reach `clean`.
  7. **Re-gate mandatory:** after fixes advance the head SHA, re-run the chain (context-builder → reviewers → consolidation → disposition ledger → post findings) on the new head before crossing the gate boundary. On retry, only re-run reviewers that had findings in the previous pass; context-builder and consolidation always run fresh.
  8. **Retry rule:** in subsequent retry cycles, only re-run reviewers that produced `findings_present` in the previous pass.
- **Review angles:** resolved at runtime from config via `resolveGateAngles(config, "preApproval")` from `@pi-dev-loops/core/config`. Default config enables all 11 pre-approval gate angle families; consumer repos may opt out individual angles via `excludeAngles`.
- **Persona mapping:** each angle resolves to a reviewer persona via `resolveReviewerRole(config, angle)` from `@pi-dev-loops/core/config`. Include this prompt in each reviewer's briefing so the reviewer knows exactly what to look for.
- **Pass criteria:** the sub-loop completes with verdict `clean`; all configured angles pass; if parallel execution is impractical, still run all configured lenses and explicitly record the limitation.
- **Acceptance criteria verification:** before posting the `pre_approval_gate` comment, verify every acceptance criteria checklist item in the issue linked to this PR:
  1. resolve the linked issue number deterministically: use `gh pr view <pr-number> --repo <owner/name> --json closingIssuesReferences,body` and apply this decision tree: if there is exactly one closing issue reference, use it; else if there is exactly one PR-body "Closes #N" / "Fixes #N" pattern, use it; otherwise (zero or multiple candidates), post the gate comment with verdict `blocked` (gate cannot complete deterministically) rather than guessing
  2. read the issue body via `gh issue view <issue-number> --repo <owner/name> --json body`
  3. extract checklist items from the **Acceptance criteria** section of the issue body (both `- [ ]` unchecked and `- [x]` already-checked items); ignore checklist items from other sections (DoD, tasks, non-goals) that are not acceptance criteria
  4. for each AC item, verify whether the proposed changes on the current PR head satisfy it
  5. compute the fully-updated issue body once by replacing each verified item's `- [ ]` with `- [x]`, write it to a temporary file, and perform a single `gh issue edit <issue-number> --body-file <tmp-file> --repo <owner/name>` (do not issue one edit per item; prefer `--body-file` over inline `--body` to avoid shell quoting/escaping hazards)
  6. always post a `pre_approval_gate` comment (the gate-review comment contract requires a visible comment even for non-`clean` verdicts); use verdict `clean` only when all AC items are verified; use verdict `findings_present` when any AC item is not satisfied and requires follow-up fixes; use verdict `blocked` when the gate cannot complete deterministically (for example no linked issue, ambiguous issue linkage, or the issue body is unavailable) — in all cases include a note on AC verification status
  When the issue body has no AC checklist items, post the gate comment with verdict `findings_present` and note that fact explicitly rather than assuming satisfaction.
- **Next step after passing:** continue the Step 7 flow and then proceed to the final approval gate below.
- **Non-substitution rule:** a clean `pre_approval_gate` comment is separate from `draft_gate` evidence. It governs final-approval readiness for that head SHA; it does **not** replace the required `draft_gate` evidence for leaving draft.
- **Required PR comment:** after the `pre_approval_gate` review runs, post a visible gate-review comment on the PR using the mandatory upsert helper. Keep validation reporting concise: include command names with pass/fail status. Do **not** paste raw passing test output into the visible gate comment. If you include a failing validation excerpt, keep it focused and truncate it to a deterministic retained-prefix length before posting the comment. If the `pre_approval_gate` finds issues, the comment must say that follow-up fixes are required before final approval. Do not declare final-approval readiness unless a visible `clean` `pre_approval_gate` gate-review comment exists for the current head SHA. Final-approval readiness must not rely only on local or hidden artifacts; the visible PR comment is the required auditable evidence. If the gate-review comment cannot be posted, fail closed and do not declare final-approval readiness.
- The `pre_approval_gate` procedure must be entered and completed (visible comment posted) before any merge-ready or approval-ready declaration. Skipping the gate is not recoverable by asserting convergence.
- A gate-review comment for an older head SHA does not satisfy this requirement for the current head.
- If fixes advance the head SHA, post a new gate-review comment for the new head.

### Conflict-resolution gate

Before any merge-ready or final-approval claim, run `detect-pr-gate-coordination-state.mjs` for the current PR. If it reports `gateBoundary=conflict_resolution` or `mergeStateStatus` is conflicted, stop the normal gate path immediately and use this recovery flow:

1. fetch fresh `origin/main`, confirm the current PR head SHA, and summarize the conflict scope from `mergeStateStatus` plus any reported `conflictFiles`
2. ask for explicit authorization before any rebase or other branch-state-changing reconciliation command
3. after authorization, reconcile locally on the PR branch; default to rebase onto latest `origin/main`, unless the operator explicitly chooses another conflict-resolution command
4. auto-resolve simple conflicts when the correct fix is mechanical and clearly in scope; report complex conflicts explicitly and fix them manually only for in-scope files
5. rerun the smallest honest local validation for the touched conflict slice
6. rerun `detect-pr-gate-coordination-state.mjs` for the new head
7. because the head changed, rerun `pre_approval_gate` for the new head before any approval-ready or merge-ready claim
8. wait for current-head CI again before retrying merge evaluation
9. if the chosen reconciliation rewrote branch history (for example rebase), ask for explicit authorization before `git push --force-with-lease`, then continue the loop on the updated head

`mergeStateStatus: CLEAN` alone is not enough to resume approval or merge claims. The existing merge-ready preconditions still apply: `unresolvedThreadCount === 0`, a clean current-head `pre_approval_gate`, and green current-head CI.

### Merge-ready preconditions

See [Merge Preconditions](../docs/merge-preconditions.md). Verify: `unresolvedThreadCount === 0` (via `capture-review-threads.mjs`), visible clean `draft_gate` + current-head `pre_approval_gate`, green CI. For parallel review passes: start each reviewer in fresh context with a concise focus-specific briefing summary; do not fork the parent session just to preserve chat state (write a compact handoff artifact under `tmp/copilot-loop/` instead). **Mandatory fresh-context verification:** run `scripts/github/verify-fresh-review-context.mjs --scope <angle>` at reviewer startup; block on contamination. Use `--scope` for parallel reviewers.

### Final approval gate

After merge-ready preconditions pass, verify [Merge Preconditions](../docs/merge-preconditions.md) authoritatively before reporting merge-ready. Stop at the final human approval gate by default. Cross-check via `capture-review-threads.mjs` (not prose assertion).
Follow [Merge Preconditions](../docs/merge-preconditions.md): stop at `waiting_for_merge_authorization` after approval unless merge explicitly authorized. Run pre-merge gate evidence check before any `gh pr merge`.

### Mechanical pre-merge gate evidence check

Immediately before any `gh pr merge`, run:

```sh
node <resolved-skill-scripts>/github/detect-gate-review-evidence.mjs \
  --repo <owner/name> \
  --pr <number>
```

This helper is always-on: it uses `gh api` to fetch visible PR issue comments and fails closed unless both required gate comments exist: a clean `draft_gate` comment for the one-time draft boundary and a clean current-head `pre_approval_gate` comment. Do not run `gh pr merge` if this command exits non-zero. There is no opt-out flag. Resolved threads, green CI, clean Copilot rereview, or local notes do not substitute for this successful helper output. If a final approval or merge boundary sees `gh pr merge` without a same-boundary successful check, treat that as a workflow violation and stop.

## Validation policy

Follow [Validation Policy](../docs/validation-policy.md). Default: `npm run verify` before PR creation, gate entry, and merge. For repo-local examples: `npm run test:dev-loop` for skill scripts, contract tests for templates, `git diff --check` for docs. When CI runs exist, use `gh run watch` or `detect-copilot-loop-state.mjs` instead of `sleep`-based polling. Distinguish: locally validated, full PR-equivalent checks, awaiting CI.

## Confirmation checkpoints

See [Confirmation Rules](../docs/confirmation-rules.md). Stop and ask before GitHub mutations (edits, assignments, labels, comments, reviews, thread resolution, commits, pushes, merges, workflows) unless explicitly authorized.

## Stop conditions

Follow [Stop Conditions](../docs/stop-conditions.md). Genuine stops: `blocked` state, `done`/terminal, `approval_ready` without merge auth, ambiguous state, scope drift. Non-stops: `waiting` watcher states, quiet observations.

## Anti-patterns

See [Anti-patterns](../docs/anti-patterns.md). Key repo-specific additions:
- Use `reply-resolve-review-thread.mjs` / `reply-resolve-review-threads.mjs` helpers instead of ad hoc `gh api`/`gh api graphql` thread-mutation commands
- Do NOT use `gh pr comment` or `gh pr review` for gate comments (use `upsert-gate-review-comment.mjs`)
- Do not declare merge-ready without visible `pre_approval_gate` comment on current head SHA
- Do not declare merge-ready based solely on `mergeable_state: clean` + CI green without gate evidence
- Do not blind-run `gh pr merge`, `gh pr update-branch`, or an unapproved rebase when conflicted
- Do not suggest approval/approve-and-merge without explicit current-head `pre_approval_gate` evidence
- Do not treat CI green + resolved threads + clean Copilot rereview as sufficient without gate evidence
- Do not dispatch async dev-loop tasks that omit the pre-approval gate requirement
- Do not assume generated wiki is authoritative over code or CI

## Output expectations

When using this skill, keep user-facing summaries concise and operational.

A good status update should say:
- what issue or PR you inspected
- current state
- what the next recommended action is
- whether authorization is needed before taking it

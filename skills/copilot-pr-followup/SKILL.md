---
name: copilot-pr-followup
description: >-
  Internal routed strategy behind `dev-loop` for GitHub-first Copilot-owned PR
  follow-up: confirm a ready issue, align on scope and acceptance criteria,
  watch the resulting PR for new Copilot review activity, run async Pi
  review/fix passes in-session, validate with repository-appropriate checks,
  and stop for confirmation before any GitHub or branch state changes.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth; async follow-up works best in Pi/TelePi sessions.
allowed-tools: read bash edit write subagent review_loop
user-invocable: false
---

# Copilot PR Follow-up

This skill is the canonical internal `copilot_pr_followup` route behind the public `dev-loop` façade.

Use it only when the public `dev-loop` router lands on a Copilot-owned or equivalent PR follow-up path. Keep repository specifics grounded in the active repo's actual files, scripts, CI, and GitHub state rather than assuming a hard-coded project layout.

This skill is the canonical internal owner of the shared post-PR mechanics used by this repo: PR discovery and interpretation, async watch behavior, fix / reply-resolve / re-request flow, gate sequencing, and merge-ready preconditions.

## Operational cookbook

Quick reference for the common PR follow-up path. All commands use the resolved skill scripts directory (see [Skill asset path resolution](#skill-asset-path-resolution) below).

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
- `requestWatchContract.routingState` for request-vs-watch posture (`ready_state_needs_copilot_request`, `copilot_request_confirmed_waiting`, `draft_reset_requires_ready_state_reentry`, `non_ready_state`)
- `requestWatchContract.requestStatus` and top-level `action`/`nextAction`
- `watchArgs` only when `action: "watch"` and `requestWatchContract.watchEntryConfirmed=true`
- `requestWatchContract.stopState` for explicit blocked/stop handling (`unavailable`, `blocked`, `draft_requires_ready_state_reentry`, `no_automatic_next_step`)

**3. Preferred async wait-boundary helper**
```sh
node <resolved-skill-scripts>/loop/run-copilot-watch-cycle.mjs --repo <owner/name> --pr <number>
```
Runs the handoff first, then checks branch-scoped workflow activity via `detect-copilot-session-activity.mjs`. When Copilot is actively coding, it blocks on `gh run watch` for that run and then performs a zero-timeout `idle` probe; otherwise it keeps the emitted non-zero watch timeout. The result preserves the shared `loopDisposition` contract from the Copilot state machine and adds a separate coarse `cycleDisposition` field for the helper's wait-boundary summary: `{ ok: true, handoffAction, state, watchStatus?, loopDisposition, cycleDisposition, terminal, sessionActivity? }`.
Use `--probe-only` only for an explicit one-shot status/reattach probe; it is not the normal async wait path.

For explicit async loop entry or continuation, this is a persistent async watch/fix loop, not handoff-only behavior:
- if `cycleDisposition` is `pending` and `terminal` is `false`, stay attached to the same PR and resume another watch boundary instead of reporting completion
- after Step 7 finishes a fix / reply-resolve / re-request cycle and the deterministic state returns to `waiting_for_copilot_review`, resume this watcher again in the same async session
- if the user explicitly asks for async handoff-only behavior, say that out loud and stop after the handoff boundary; otherwise do not silently reinterpret async loop entry as handoff-only
- follow Step 6 and Step 7 below for the fuller wait/watch and fixer-loop policy details

For direct low-level diagnostics only:
- `<resolved-skill-scripts>/github/request-copilot-review.mjs`
- `<resolved-skill-scripts>/github/watch-copilot-review.mjs`

**Pass `--help` to any helper for full usage:**
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --help
node <resolved-skill-scripts>/loop/run-copilot-watch-cycle.mjs --help
node <resolved-skill-scripts>/github/request-copilot-review.mjs --help
node <resolved-skill-scripts>/github/watch-copilot-review.mjs --help
node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --help
```

## What this skill assumes about this repo

This repository is **GitHub-first**, not local-phase-first.

Treat these as the primary workflow surfaces:
1. GitHub Issues are the execution backlog.
2. Milestones, labels, and issue templates define scope and readiness.
3. Copilot may implement work on a branch and open or update a PR.
4. PR review comments, Copilot review comments, and CI are the main iteration loop.
5. Pi follow-up work happens as targeted async review/fix passes around that PR.

Do **not** default to a local `tmp/phases/phase-x` implementation workflow here.

## Required startup reads

Read only the constitution / contract docs and runtime surface needed for the current step.

Before planning, review, or automation:

1. `AGENTS.md` if present
2. `../docs/public-dev-loop-contract.md`
3. if the current step depends on async start/resume/status or retrospective enforcement, `../docs/retrospective-checkpoint-contract.md`
4. the relevant GitHub issue or PR
5. the repository's actual validation/runtime surface:
   - root `package.json`
   - relevant package-level `package.json` files
   - CI/workflow configuration if present
   - touched helper contract docs when the PR changes a documented contract
6. task-relevant source files, tests, and configuration

If the repo includes generated wiki or LLM context files, treat them as orientation aids only.

Verify all material claims against source, tests, configuration, and CI.

## Skill asset path resolution

When this skill refers to helper paths such as `scripts/...` or `docs/...`, resolve them from the actual skill installation layout you are running, not from the active target repository checkout.

Use this rule:
- if the skill is installed as a normalized standalone copy, the required bundled contract docs live under the shared `../docs/` directory next to the installed skill directories; do not assume helper scripts are bundled unless that installed layout actually contains them
- if you are working in the `pi-dev-loops` source repository, this skill file lives under `skills/copilot-pr-followup/`, so source-repo helper scripts live two levels up at `../../scripts/`, while required bundled contract docs live one level up at `../docs/`
- when in doubt, resolve helper paths relative to this `SKILL.md` file first, then verify the target file exists before running it

Required bundled runtime contract docs for installed copies of this skill:
- `../docs/public-dev-loop-contract.md`
- `../docs/retrospective-checkpoint-contract.md`


Read those bundled `../docs/` files from the installed skill layout instead of assuming the source repository checkout is present. If any required bundled contract doc is missing from the installed skill layout, treat that as a packaging/installer bug.
Do not assume `scripts/...` is repo-local to the target codebase you are operating on.

The conductor-ownership and conductor-pr-projection modules have been retired. Their designs are archived in git history (see audit at issue #319).

## Authority and safety rules

- Source code, tests, CI, and config are authoritative.
- The generated wiki is a navigation aid, not the source of truth.
- GitHub Issues are the backlog. Do not invent a parallel backlog file.
- Before any state-changing action, get explicit confirmation unless the user's latest message already clearly authorizes that action.
- Questions, preferences, future-tense statements, and implied approval are not confirmation.
- The bare response `ok` is not confirmation.
- State-changing actions include local edits, commits, pushes, merges, rebases, branch deletion, issue assignment, label or milestone changes, PR reviews, thread resolution, workflow triggers, and publication.
- When handing work to Copilot, assign `copilot-swe-agent` directly, not `copilot`.
- Prefer single commands where practical. If the logic is too involved for one command, write a temporary `.mjs` script under `tmp/` instead of building up fragile shell sequences.
- For GitHub issue or PR comments, prefer `--body-file` / `-F` or stdin via `-F -` over inline shell strings.
- Keep scope tight to the issue/PR at hand.

## Primary execution modes

This skill supports four common modes.

### 1. Issue handoff mode
Use when the user wants to start new work from the backlog.

Goal:
- identify a ready GitHub issue
- confirm scope and acceptance criteria
- prepare or initiate Copilot execution when authorized

### 2. PR follow-up mode
Use when a Copilot PR already exists.

**Dispatch rule:** When entering this mode, dispatch the entire dev loop as a single async coordinator subagent (the `dev-loop` agent) rather than running steps inline in the parent session. The coordinator owns parallel review fan-out, fixer passes, gate comments, and state transitions internally.

Goal:
- inspect current PR state
- check CI, unresolved comments, and review status
- decide whether the next step is waiting, reviewing, fixing, or merging

### 3. Async watch mode
Use when the user wants Pi to wait for fresh Copilot review activity and then react.

Goal:
- baseline current Copilot activity
- poll deterministically for new Copilot comments/reviews
- launch an in-session Pi fixer only after fresh review activity appears

### 4. Fixer mode
Use when actionable PR feedback already exists.

Goal:
- inspect unresolved review comments and failing checks
- apply only narrow fixes related to the current PR
- validate and report readiness for the next GitHub action

## Issue-first intake and durable-auto overlays

This skill is the canonical internal owner of the routed `issue_intake` behavior in addition to `copilot_pr_followup`.

When routed work is issue-first rather than already in active PR follow-up, the sections below act as issue-refinement specialist procedures before the shared post-PR loop.

### New-idea safety layer (default contract in this repo)

For **all new ideas** that are not already anchored to an existing issue (including abstract ideas such as plain-language requests without an issue number or plan-doc path), apply this coordinator-owned intake contract before any GitHub mutation:

- coordinator owns classification and mutation gating decisions
- run classification in fresh context by default
- run classification asynchronously when practical
- run async fan-out / fan-in proposal generation by default when practical
- emit a proposal artifact before any GitHub state-changing mutation, including create/edit/retitle/collapse/link operations
- default to create-new over overwrite/update when a new tracked artifact is justified
- do not repurpose/retitle/collapse/overwrite an existing issue unless that exact mutation is explicitly proposed and explicitly approved
- after approval, run a second async coordinator mutation pass instead of mutating directly from inherited context
- verify post-mutation artifact state and record what actually changed

Deterministic intake + mutation-gate state machine:

```text
idea_received
  -> fresh_context_started
  -> fanout_started
  -> fanin_complete
  -> artifact_scan_complete
  -> classified
  -> proposal_emitted
  -> awaiting_user_approval
  -> ready_for_mutation
  -> mutation_executed
  -> mutation_verified
  -> done

stop states:
- stopped_overlap_needs_decision
- stopped_low_confidence
- stopped_explicit_reject
```

Proposal artifact contract:
- human-readable Markdown proposal
- machine-readable JSON snapshot
- write temporary artifacts under `tmp/new-idea-intake/<run-id>/proposal.md` and `tmp/new-idea-intake/<run-id>/proposal.json`

If the Phase 1 preflight verdict is `pause_for_clarification`, stop and ask.
If the intake state machine stops at `stopped_overlap_needs_decision` or `stopped_low_confidence`, stop and ask.
If the intake state machine stops at `stopped_explicit_reject`, stop and record that the proposal was rejected; do not mutate GitHub.
After approval, start a separate async coordinator mutation pass that consumes the approved proposal and emits a post-mutation verification artifact. Emit a concise post-mutation verification artifact and record what the mutation pass actually changed and verify the resulting issue/artifact state.

### Unattended issue-first execution and automatic re-entry

When the user explicitly authorizes unattended execution for a specific issue/PR scope, continue through the normal loop mutations for that scope without stopping at every intermediate phase boundary.

Under that unattended execution contract:
- automatically detect the current lifecycle entrypoint from existing GitHub state
- use the deterministic helper/state-machine surface as the authority for current-state routing and next-step selection
- if local facts, GitHub facts, and helper/state-machine output do not agree, or the state is materially unclear, contradictory, off-trail, or not cleanly covered, stop and ask for human direction rather than guessing
- a pre-existing PR is not a stop-by-default condition
- If a PR already exists, classify the post-assignment seam before follow-up
- `waiting_for_initial_copilot_implementation`: keep waiting
- `linked_pr_ready_for_followup`: route to the existing PR follow-up path immediately; resume from that PR
- when routing leaves bootstrap wait for `linked_pr_ready_for_followup`, do not stop only because local isolation is required; re-enter the same PR follow-up from a safe isolated checkout/worktree
- When the draft PR appears, classify whether it is still the bootstrap-only Copilot draft before entering normal follow-up
- if a child async run exits while the deterministic state is still non-terminal (for example `waiting_for_copilot_review`), automatically resume/restart follow-up when continuation is feasible instead of requiring manual operator restart
- continue unattended until the final approval gate unless a genuine stop condition is reached
- stop for a human approval decision by default
- after approval, report `waiting_for_merge_authorization` and stop again unless merge has been explicitly authorized
- this does **not** imply unattended merge by default

Issue-first shorthand such as `auto dev loop on issue <n>` should preserve this same stop boundary and final human approval gate default.

### Phase 1 — Preflight intake

Before any automation, answer these questions:
1. smallest executable work item
2. existing issue check
3. scope clarity
4. acceptance criteria
5. verification path
6. active PR check

Accepted input types:
- GitHub issue number or URL
- plan-doc path
- abstract roadmap idea

Preflight verdicts:
- `proceed`
- `proceed_with_assumptions`
- `pause_for_clarification`

### Phase 2 — Input normalization

#### From a GitHub issue number or URL

- if the input is a full GitHub issue URL, parse `<owner/name>` and `<number>`
- fetch with `gh issue view <number> --repo <owner/name> --json number,title,body,state,labels,assignees,milestone`
- If the issue is closed, stop for a user decision before proceeding
- detect an existing linked PR with the deterministic linked-PR helper:
  `node <resolved-skill-scripts>/github/detect-linked-issue-pr.mjs --repo <resolved-repo> --issue <number>`
- treat the helper output as authoritative for linked-PR detection/selection
- do not re-implement linked-event query behavior, pagination, repo filtering, or tie-break logic
- do not rely only on PR title/body containing a literal issue number
- treat an open linked PR as the active implementation for this issue
- once an open linked PR exists, that PR is the only canonical follow-up artifact for the issue; attach follow-up work to it and do not open another PR unless the prior PR was explicitly superseded and reconciled first
- if a PR already exists, classify bootstrap-wait versus follow-up:
  `node <resolved-skill-scripts>/loop/detect-initial-copilot-pr-state.mjs --repo <resolved-repo> --issue <number>`
- `waiting_for_initial_copilot_implementation`: keep waiting; in durable-auto mode use:
  ```sh
  node <resolved-skill-scripts>/loop/watch-initial-copilot-pr.mjs --repo <resolved-repo> --issue <number>
  ```
  - must use the dedicated `watch-initial-copilot-pr.mjs` watcher and its default 1-hour watch budget
  - quiet/no-activity watch observations alone are non-terminal
  - `ready_for_followup`: linked PR has become substantive; resume from that PR
  - `timed_out`: observational first; refresh authoritative state
  - if refreshed state is still `waiting_for_initial_copilot_implementation`, remain attached to the same durable wait seam and continue waiting
  - if the refreshed state exits this seam, route based on that refreshed state instead of surfacing timeout attention
  - when the refreshed state is `linked_pr_ready_for_followup`, re-enter normal PR follow-up; if the follow-up handoff carries `conductorRouting.handoffEnvelope.requiresLocalIsolation=true`, perform the expected isolated-checkout/worktree handoff and continue
  - only surface timeout attention when the seam's durable watch budget is actually exhausted
  - for explicit inspect/status requests, report the still-waiting state and exit normally
- carry that resolved repo slug through every later GitHub issue/PR command

#### From a plan-doc path

- Resolve the target repository slug for this work item before any GitHub search or mutation
- default to the current repository slug
- if the plan-doc reference explicitly points at another GitHub repository, resolve `<resolved-repo>` first
- search existing issues with:
  ```sh
  gh issue list --repo <resolved-repo> --state all --search "<title keywords>"
  ```
- If a matching issue exists:
  - if the matching issue is closed, stop for a user decision before proceeding
  - if that matching issue turns out to be closed, stop for a user decision
  - if a PR already exists, classify bootstrap-wait versus follow-up
- if a governing plan doc or roadmap section actually applies, follow the plan-doc normalization path above

#### From an abstract idea

- otherwise search existing issues directly
- if a matching issue exists, follow the issue-number/URL normalization path
- resolve `<resolved-repo>` for this work item using the same rule as the plan-doc path

### Phase 3 — Async issue refinement

Before updating or assigning the issue, refine it asynchronously when practical. Keep issue refinement separate from the phase-scoped refiner used by the local implementation workflow.

### Phase 3b — Epic decomposition with GitHub sub-issue trees

When the work item is an umbrella/epic issue that must be decomposed into bounded child slices,
use **real GitHub sub-issue trees** as the default durable output — not body checklists, not
a manual follow-up linking step.

Prefer real sub-issue linkage over parent-body checklists when a work tree is intended.
A parent issue body should stay lean once the tree exists: keep scope, acceptance criteria, and
non-goals there, but do **not** duplicate the ordered child list in the body.

Full decomposition flow:

1. refine umbrella issue framing (scope, acceptance criteria, non-goals)
2. define bounded child slices — each slice must be independently closable
3. create child issues with `gh issue create --repo <resolved-repo>`
4. attach each child as a real sub-issue:
   ```sh
   node <resolved-skill-scripts>/github/manage-sub-issues.mjs add \
     --repo <resolved-repo> --issue <parent-number> --child <child-number>
   ```
5. set execution order (highest priority first):
   ```sh
   node <resolved-skill-scripts>/github/manage-sub-issues.mjs reorder \
     --repo <resolved-repo> --issue <parent-number> --order <n1,n2,...>
   ```
6. verify the resulting tree:
   ```sh
   node <resolved-skill-scripts>/github/manage-sub-issues.mjs verify \
     --repo <resolved-repo> --issue <parent-number> --expected <n1,n2,...> [--ordered]
   ```
7. keep the parent issue body lean — sequencing and progress now live in the sub-issue tree

To inspect the current tree at any time:
```sh
node <resolved-skill-scripts>/github/manage-sub-issues.mjs list \
  --repo <resolved-repo> --issue <parent-number>
```

Do **not** re-implement sub-issue management ad hoc or bypass `manage-sub-issues.mjs`.
Do **not** maintain a body checklist that duplicates the sub-issue tree.

For the full `manage-sub-issues.mjs` contract, use `../../docs/sub-issue-tree-contract.md` when working in the `pi-dev-loops` source repository.
For installed or normalized skill copies, read the same contract from the resolved skill docs directory instead of assuming the source checkout is present.

### Phase 4 — Copilot handoff and bootstrap wait

Before updating the GitHub issue body, show the diff and get explicit confirmation. Then use:
```sh
gh issue edit <number> --repo <resolved-repo> --body-file <updated-body-file>
gh issue edit <number> --repo <resolved-repo> --add-assignee copilot-swe-agent
```
Verify assignment with:
```sh
gh issue view <number> --repo <resolved-repo> --json assignees
```

When the linked PR becomes substantive, keep the shared loop scoped to the resolved repo, for example:
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --repo <resolved-repo> --pr <number>
gh pr edit <pr-number> --repo <resolved-repo> --title "..." --body-file <body-file>
gh pr ready <pr-number> --repo <resolved-repo>
gh pr review <pr-number> --repo <resolved-repo> --approve --body "..."
gh pr merge <pr-number> --repo <resolved-repo> --squash --delete-branch
```

Bootstrap-wait interpretation remains fail-closed and observational-first:
- `ready_for_followup`: linked PR has become substantive; resume from that PR
- `timed_out`: observational first; refresh authoritative state
- if refreshed state is still `waiting_for_initial_copilot_implementation`, remain attached to the same durable wait seam and continue waiting

## Deterministic orchestration authority

When operating in PR follow-up or async watch mode, use the deterministic state machines
as the authoritative source for:

- Copilot follow-up loop: `detect-copilot-loop-state.mjs` from the resolved skill scripts directory
- reviewer-side PR review loop: `detect-reviewer-loop-state.mjs` from the resolved skill scripts directory

Resolve those helper paths from the skill asset layout described above. In the `pi-dev-loops`
source repository the skill scripts directory is `../../scripts/` relative to this file; in normalized
installed copies it may instead be `scripts/` inside the installed skill directory when that layout bundles the helper scripts.

- what state the PR/loop is in right now
- what transitions are currently allowed
- what the next required action is
- when to stop instead of guessing

Each machine captures an observable snapshot from GitHub facts (plus explicit bounded local loop
metadata when required) and interprets it into exactly one current state plus allowed next
transitions. See `copilot-loop-state-graph.md` and `reviewer-loop-state-graph.md` in the resolved
skill docs directory; in the `pi-dev-loops` source repository those source-authority docs live under
`../../docs/` relative to this file.

For tracker-first MVP `story -> PR -> tracker sync` work, also use
`tracker-first-mvp-state-graph.md` in that same docs directory as the bounded workflow-family
contract (under `#17`, complementary to `#21`, narrower than `#19`). That document inherits
source-of-truth ownership, the required work item <-> PR link, and reverse-sync semantics from
`#21`; it only adds the mutually exclusive workflow-family states and post-merge sync-verification
states for this narrower MVP slice.

**Key guarantees from the state machine:**

- `unresolvedThreadCount > 0` always routes to fix/reply-resolve — never to a wait/watch state
- `snapshot.copilotReviewRequestStatus === "unavailable"` or `snapshot.copilotReviewRequestStatus === "failed"` routes to a terminal stop state — never to sleep or watch
- `agentFixStatus === "applied"` with unresolved threads routes to `already_fixed_needs_reply_resolve` — reply/resolve on GitHub is required before re-requesting review
- Copilot being in `requested_reviewers` (`"requested"` or `"already-requested"`) routes to `waiting_for_copilot_review`

**How to use the state machine in practice:**

1. Run `node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>`
   to get the current Copilot-loop state and recommended next action.

2. If you already ran `<resolved-skill-scripts>/github/request-copilot-review.mjs` and got a known status,
   inject it without re-probing: add `--review-request-status <status>`.

3. When the agent has applied a fix and wants to signal reply/resolve is next, build a snapshot
   with `agentFixStatus: "applied"` and use `--input <snapshot.json>` for interpretation.

4. For reviewer-side draft-review work, run `node <resolved-skill-scripts>/loop/detect-reviewer-loop-state.mjs --repo <owner/name> --pr <number> [--reviewer-login <login>] [--local-state <path>]`.
   If the state reaches `draft_review_ready`, stage the pending review with
   `node <resolved-skill-scripts>/github/stage-reviewer-draft.mjs --repo <owner/name> --pr <number> --review-file <merged-review.json> --local-state-output <state.json>`,
   then re-run the detector with `--local-state <state.json>`.

   In the `pi-dev-loops` source repository, `<resolved-skill-scripts>` is `../../scripts` relative to this file.
   In normalized installed skill copies, it may instead be `scripts` inside the installed skill directory.

5. Follow the `nextAction` from the machine output. For stop states (`review_request_unavailable`,
   `blocked_needs_user_decision`), report to the user and do not proceed.

**Judgment calls that remain in the agent layer (not encoded in the machine):**

- Whether a comment should be accepted, deferred, or disagreed with
- Whether the code change is already sufficient (→ sets `agentFixStatus: "applied"`)
- What the narrowest valid fix is
- Whether another Copilot pass is desired (→ triggers re-request or selects `done`)

## Workflow overview

```text
ready issue -> confirm scope -> Copilot branch/PR -> async review/watch -> Pi follow-up fixes -> validation -> confirm verdict/action -> merge when authorized
```

Use the resolved `detect-copilot-loop-state.mjs` helper from the skill scripts directory at each
decision point in this flow to determine the current state and route to the correct next step
deterministically.

## Step 1: Choose the work item

Prefer a GitHub issue over an ad hoc local TODO.

When selecting the next item:
- prefer `type:task` issues under the relevant epic
- prefer `status:ready`
- inspect milestone, labels, and acceptance criteria
- confirm whether a PR already exists for the issue before proposing new execution

Useful checks:
- `gh issue list --state open`
- `gh issue view <number>`
- `gh pr list --state open`

If the user asks for status/progress/readiness/merge-state/next-step (including “what is next”):
- resolve authoritative active artifact identity first (issue/PR, plus branch/head SHA when useful)
- for issue targets, do not assert "no open PR" until authoritative issue↔PR linkage is resolved (for example via `detect-linked-issue-pr.mjs` timeline-linkage checks)
- resolve artifact state (`open`/`closed`/`merged`/`not_applicable`)
- resolve current loop state and next action from deterministic helper/state output
- include explicit resolved artifact identity in the answer
- if identity/state cannot be resolved confidently, stop with reconcile/unknown instead of guessing from chat context

## Step 2: Confirm issue scope before execution

Before handing work to Copilot or doing follow-up fixes, summarize:
- issue number and title
- parent epic if present
- milestone
- labels
- exact acceptance criteria
- intended narrow scope
- non-goals inferred from the issue and plan

If the work item is phase-like, ambiguous, or likely to shape more than one downstream step, default to a short fan-out / fan-in refinement pass before implementation:
- generate 2-3 plan variants in parallel when practical
- compare the variants explicitly
- merge them into one bounded execution plan
- only then proceed with GitHub execution

If the issue text is too vague, stop and ask a short clarification question rather than guessing.

## Step 3: Decide whether Copilot or Pi should act next

Use this heuristic:

### Prefer Copilot when
- there is a ready implementation issue with clear acceptance criteria
- no PR exists yet for that issue
- the user wants the repository's normal GitHub/Copilot path
- the next step is “start work” rather than “finish this already-open PR right now”

### Prefer Pi follow-up when
- a PR already exists
- Copilot has already pushed work and now needs review/fix follow-up
- there are unresolved comments or failing checks
- the user wants async in-session watching and response

### Prefer plain analysis only when
- the user is asking what should happen next
- authorization for GitHub state changes has not been given yet
- the issue/PR state is unclear and needs inspection first

## Step 4: Copilot handoff rules

When preparing work for Copilot:
- use the GitHub issue as the source of truth
- preserve the issue's acceptance criteria
- keep the requested scope narrow
- do not broaden into adjacent backlog items
- prefer one issue per PR unless the user explicitly wants bundling

Before any GitHub mutation such as assigning the issue, posting instructions, or changing labels, confirm first unless explicitly authorized.

When you do hand work to Copilot:
- assign `copilot-swe-agent`
- reference the issue number and acceptance criteria clearly
- keep instructions implementation-focused and test-aware

## PR description contract

Follow the PR description contract (see `AGENTS.md` if present; otherwise use the structure below): detailed structured descriptions, not thin placeholders. At minimum include change summary, scope/context, explicit acceptance criteria, explicit definition of done, and explicit non-goals.

New PRs in this workflow must be opened as **draft** PRs first. Do not create a fresh PR directly in ready-for-review state unless the user explicitly overrides that policy for the current PR scope. The draft gate review is a real workflow boundary, so a new PR must exist in draft before `gh pr ready` is even eligible.

Only use `gh pr create` when authoritative issue↔PR resolution says there is no already-open linked PR. If a PR already exists, reuse/update that canonical PR instead of opening another one.

Prefer `gh pr create --draft --repo <owner/name> --base <base> --head <head> --title "..." --body-file <body-file>`.

## Timeout and watch policy

This workflow is intentionally long-lived.

Do not rely on short default timeouts for unattended Copilot loops.

Preferred defaults for this repo:
- poll interval for review/activity watchers: **1 minute** (`--poll-interval-ms 60000`)
- unattended watch timeout: **24 hours** (`--timeout-ms 86400000`)
- if the user says to stay on it until done or avoid near-term timeout, prefer **72 hours** (`--timeout-ms 259200000`)
- parent/subagent no-activity threshold for watcher-style runs: at least **15 minutes**
- active-long-running notice threshold for watcher-style runs: about **30 minutes**

These are the defaults built into `watch-copilot-review.mjs` and the `watchArgs` emitted by `copilot-pr-handoff.mjs`. Pass them explicitly when overriding.

A watcher sleeping between polls is expected behavior, not a blocker.

If the polling interval is 1 minute, do not treat silence shorter than one full poll interval as suspicious, and do not configure needs-attention thresholds close to a few seconds for this loop.

## Step 5: PR discovery and interpretation

For a relevant issue, look for:
- open PRs from `app/copilot-swe-agent`
- branch names that start with `copilot/`
- draft status
- merge state
- requested reviewers
- unresolved review comments
- current check status

Treat the PR as the main working artifact once it exists.

Inspect:
- PR body and title
- whether the PR body actually satisfies the PR description contract above
- PR author, because verdict handling differs for PRs not opened by the active GitHub user
- review summaries
- unresolved inline comments and issue comments
- latest commits
- CI results

At the issue-assignment seam, do not treat every linked draft PR as ready follow-up work. Use `detect-initial-copilot-pr-state.mjs` (which delegates linked-PR selection to `detect-linked-issue-pr.mjs`) and keep waiting when the state is `waiting_for_initial_copilot_implementation`.

When confirming whether Copilot is requested as a reviewer, do not rely solely on `gh pr view --json reviewRequests`.

Prefer the deterministic helper `request-copilot-review.mjs` from the resolved skill scripts directory when it exists. That helper verifies reviewer state through `gh api repos/<owner>/<repo>/pulls/<number>/requested_reviewers`, which is more reliable here than `gh pr view --json reviewRequests`.

When a PR is moved from draft to ready, explicitly attempt to request Copilot review rather than assuming repository automation will do it.

After any follow-up fix commit is pushed to an open PR, explicitly decide whether another Copilot pass is desired.
If yes, first return the updated head to a green or credibly green validation posture (smallest honest local validation is green and there is no known fixable CI-red state). Then request Copilot review again rather than assuming GitHub will automatically re-request it for the new head.

Do not web-search or rediscover this behavior during normal operation. Treat the deterministic helper and the repository docs as the source of truth unless you are explicitly debugging the tooling itself.

When introducing or changing deterministic GitHub write helpers (for example review-request or reply/resolve helpers), do not rely on fixture tests alone if a real authorized PR is available. Run one bounded real-PR smoke check before entrusting a long-lived async loop to that helper.

If the explicit request fails because Copilot review is not enabled for the repository, the reviewer identity is not requestable, or GitHub rejects the request because the reviewer is not a collaborator/requestable actor, record that exact limitation explicitly.

Do not treat an attempted request as equivalent to a confirmed request.

For the resolved `request-copilot-review.mjs` helper, branch on the machine-readable result:
- `requested`: if another Copilot pass is actually desired, baseline fresh state and then wait/watch; otherwise report current state without waiting
- `already-requested`: if another Copilot pass is actually desired, baseline fresh state and then wait/watch; otherwise report current state without waiting
- `suppressed_same_head_clean`: report the clean-converged state and stop unless an explicit `--force-rerequest-review` bypass is intentionally authorized
- `unavailable`: report the limitation and stop unless the user explicitly wants passive waiting without a fresh request
- non-zero / unexpected failure: stop and report the error rather than entering a sleep/watch loop

## Step 6: Async watch behavior

When the user wants Pi to wait for fresh Copilot review activity, prefer native GitHub watch behavior when `gh` supports the exact wait condition, and otherwise use a deterministic watcher rather than ad hoc polling.

Preferred order:
1. use `gh ... --watch` / `gh ... watch` when GitHub CLI has a native watch mode for the exact thing you need
2. otherwise use the existing deterministic watcher pattern
3. only fall back to custom ad hoc polling when neither of the above can express the required condition safely

Practical rule for this repo:
- prefer `gh run watch` for GitHub Actions / check-run waiting when you already know the run ID
- prefer ordinary `gh pr view`, `gh issue view`, `gh api`, and `gh pr checks` snapshots for one-time inspection
- use deterministic custom watchers for conditions that `gh` does not natively watch well, such as:
  - waiting for a Copilot-authored PR to appear
  - waiting for new Copilot review activity after a baseline, including review-thread comments, review summaries, or PR issue comments
  - waiting for unresolved thread state to change in a review-aware way

Preferred approach for Copilot review follow-up:
- route request/re-request/watch decisions through `copilot-pr-handoff.mjs` output instead of re-implementing branch logic in markdown
- enter watcher mode only when handoff returns `action: "watch"` with `requestWatchContract.watchEntryConfirmed=true`
- for explicit async loop entry or continuation, prefer `run-copilot-watch-cycle.mjs` so the handoff → watch boundary stays deterministic and uses the emitted non-zero watch timeout
- if watcher status is `timeout`/`idle`, re-run `copilot-pr-handoff.mjs --watch-status <status>` and continue unless refreshed output is terminal
- zero-timeout `idle` probes are for explicit one-shot status/reattach checks only; they are not the normal async wait mechanism
- after a successful fix / reply-resolve / re-request cycle, returning to `waiting_for_copilot_review` is a persistence boundary: resume the watcher instead of reporting completion
- if a child async run exits and the refreshed state remains non-terminal (for example `waiting_for_copilot_review`), treat that as early exit and automatically restart/resume the same-PR follow-up path when feasible
- keep watcher and fixer flow in-session; do not replace with ad hoc detached polling
- do not report completion while unresolved Copilot feedback remains

Use an existing repo-local async review-follow-up skill or deterministic watcher when available.

### Canonical async dispatch wording

Every async dev-loop dispatch task body must include this clause verbatim so fresh-context subagents inherit the gate requirement:

> Before reporting merge-ready or stopping at the human approval gate, you must complete the pre_approval_gate procedure and verify that a visible clean gate-review comment exists on the PR for the current head SHA. Do not stop or report completion without this evidence.

Key rules:
- expected polling idle time is normal
- do not restart watchers just because there has been a short quiet period
- do not use `nohup`, detached shell jobs, tmux/screen sessions, or ad hoc `while`/`sleep` bash loops for this workflow
- do not bypass session-based async notifications with detached shell automation unless explicitly asked
- if a watcher is sleeping between polls, prefer raising the orchestration inactivity threshold over interrupting the child
- if Pi async subagents or the designated async follow-up skill are not appropriate or available, stop and report rather than improvising a shell watcher
- the async-start contract is also enforced in code: `outer-loop.mjs` fails closed unless it detects a visible Pi-managed async run id (`PI_SUBAGENT_RUN_ID`). Session-only markers (`PI_SESSION_ID`, `PI_ASYNC_CONTEXT`) and detached/local background fallback are diagnostic-only and do not satisfy startup. Snapshot/test input mode (both `--copilot-input` and `--reviewer-input`) is exempt. Use `PI_ASYNC_START_BYPASS=1` only for explicitly authorized standalone runs, never to route around the in-session async requirement.

## Step 7: Pi review/fix follow-up loop

This step covers three responsibilities: the draft gate right before `gh pr ready`, the narrower post-review follow-up loop once actionable feedback exists, and the pre-approval gate before calling the PR merge-ready.

### Follow-up loop when actionable review feedback exists

When actionable review feedback exists, use a narrow follow-up loop:

1. inspect unresolved comments/threads and failing checks
2. before the first local file write in each fixer pass on a Copilot-assigned PR, run `node <resolved-skill-scripts>/loop/pre-write-remote-freshness-guard.mjs --branch <headRefName>` as a required fail-closed guard
   - source `<headRefName>` from authoritative PR state (`headRefName`), not from a local branch guess
   - if the guard exits non-zero (`remote_ahead`), stop writing locally, reconcile to the refreshed remote head, then restart the fixer pass
3. classify findings:
   - must fix now
   - worth fixing now
   - defer / non-blocking / disagree
4. apply only the accepted narrow fixes
5. run the smallest validation that honestly proves the fix
6. if files changed, run `node <resolved-skill-scripts>/loop/pre-commit-branch-guard.mjs --expected-branch <headRefName>` immediately before every `git add && git commit` sequence as a required fail-closed guard
   - source `<headRefName>` from authoritative PR state (`headRefName`), not from a local branch guess
   - if the guard exits non-zero (`branch_mismatch`), stop and realign to the expected branch before staging or committing
7. if files changed, push the resolving commit before any thread reply claims the fix is present
8. when a comment or thread is actually addressed, reply on GitHub with a short resolution note that references the resolving commit SHA or commit URL when applicable
   - must use the deterministic helper `reply-resolve-review-thread.mjs` from the resolved skill scripts directory for thread reply/resolve work
   - when using that helper, pair `--comment-id` and `--thread-id` from the same fresh PR thread snapshot rather than mixing ids across review rounds
   - use a body file under `tmp/` rather than inline shell text for the reply body
   - when the intent is GitHub linkability, keep commit SHAs and issue/PR refs as plain text (for example 3ee82fc and owner/repo#70) and do not wrap them in backticks
   - keep backticks for actual code/path/CLI literals only
   - if that helper was newly added or recently changed, smoke-check it against one real thread before assuming the rest of the loop can rely on it
9. resolve the addressed review thread only after the reply is attached successfully and the concern is genuinely addressed
   - do not stop at a local fix if GitHub-side reply/resolve is authorized
10. after completing reply/resolve for a pass, verify `unresolvedThreadCount === 0` via `capture-review-threads.mjs` before proceeding
   - if the refreshed snapshot reports a non-zero unresolved thread count, re-enter the reply/resolve loop for the missed threads
11. only after GitHub-side reply/resolve work is done for the addressed threads and the refreshed thread snapshot proves `unresolvedThreadCount === 0`, decide whether another Copilot pass is desired
   - if yes, run the smallest honest local validation for the accepted fix scope
   - if that local validation is still known red, continue remediation instead of re-requesting Copilot
   - after a fix push advances the PR head SHA, treat previous-head CI evidence as stale for any CI-dependent follow-up decision
   - refresh/re-read current-head CI/check data before advancing and apply the contract in `../docs/copilot-ci-status-contract.md` (wait for `pending`/`none`, stop for `failure`, proceed only on `success`)
   - passing local validation alone does not satisfy a step that still requires GitHub CI/check readiness for the current head
   - only results for the current head SHA may satisfy a CI-dependent follow-up step; older-head results must not unblock the new head
   - if GitHub CI/checks for the updated head are known red for a fixable issue, continue remediation instead of re-requesting Copilot
   - only once the updated head is green or credibly green, explicitly re-request Copilot review for the new head rather than assuming it remains requested
   - only enter a wait/watch loop if the request result is confirmed as `requested` or `already-requested`
   - if the request result is `unavailable`, report that limitation and stop unless the user explicitly wants passive waiting anyway
   - if the request command fails unexpectedly, stop and report the error rather than sleeping and hoping for a new review
12. after a confirmed re-requested Copilot pass, refresh PR thread state again before reporting completion; if fresh Copilot threads exist, return to this follow-up loop rather than stopping at "review requested"
13. if scope has broadened, stop and ask before continuing

Do not treat "fix applied locally" as the end of the loop when the workflow also requires GitHub-side reviewer follow-up. If comment/reply authorization is withheld, report explicitly that the code may be fixed while the PR conversation state remains unresolved.

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
  --next-action "<next action>"
```

Do NOT use `gh pr comment`, `gh api`, or `gh pr review` for gate comments.

### Draft gate contract (before marking PR ready for review)

The canonical gate-review comment contract is `docs/gate-review-comment-contract.md`. This section summarizes the procedural integration only.

- **Gate name:** Draft gate
- **Trigger / boundary:** right before running `gh pr ready` (draft → ready for review)
- **Execution directive:** run the gate-review sub-loop defined in `docs/gate-review-sub-loop-contract.md` with the draft gate review angles resolved from config.
- **Review angles:** resolved at runtime from config via `resolveGateAngles(config, "draft")` from `@pi-dev-loops/core/config`. Default config ships `scope`, `coverage`, `correctness`; consumer repos may override.
- **Pass criteria:** all configured draft gate angles pass; all must-fix findings are addressed; validation passes; no unrelated files are included.
- **Next step after passing:** mark the PR ready for review.
- **Non-substitution rule:** a clean `draft_gate` comment only authorizes the draft → ready-for-review transition for that head SHA. It does **not** satisfy `pre_approval_gate`, final-approval readiness, or merge-ready requirements.
- **Required PR comment:** after the `draft_gate` review runs, post a visible gate-review comment on the PR using the mandatory upsert helper (see Mandatory gate-comment command contract above). Keep validation reporting concise: include command names with pass/fail status. Do **not** paste raw passing test output into the visible gate comment. If you include a failing validation excerpt, keep it focused and truncate it to a deterministic retained-prefix length before posting the comment. See `docs/gate-review-comment-contract.md` for required fields, verdict definitions, and fail-closed behavior.
- A gate-review comment for an older head SHA does not satisfy this requirement for the current head.
- If the `draft_gate` finds issues, the comment must say that the PR stays draft and needs fixes before retrying.
- Do not run `gh pr ready` unless a visible `clean` `draft_gate` gate-review comment exists for the current head SHA.
- If fixes advance the head SHA **while the PR is still draft**, post a new gate-review comment for the new head.
- Do **not** apply angles from the other gate; each gate owns its own angle list from config.

### Pre-approval gate contract

This is the default pre-approval gate for this workflow boundary. The canonical gate-review comment contract is `docs/gate-review-comment-contract.md`. This section summarizes the procedural integration only.

- **Gate name:** Pre-approval gate
- **Trigger / boundary:** right before calling a PR/branch review-complete, approval-ready, merge-ready, or ready for final handoff
- **Execution directive:** run the gate-review sub-loop defined in `docs/gate-review-sub-loop-contract.md` with the pre-approval gate review angles resolved from config.
- **Review angles:** resolved at runtime from config via `resolveGateAngles(config, "preApproval")` from `@pi-dev-loops/core/config`. Default config ships `dry`, `kiss`, `yagni`; consumer repos may override.
- **Persona mapping:** each angle resolves to a reviewer persona via `resolveReviewerRole(config, angle)` from `@pi-dev-loops/core/config`. Default personas map all six angles to `review`; consumers may add custom persona agents and mappings.
- **Pass criteria:** the sub-loop completes with verdict `clean`; all configured angles pass; if parallel execution is impractical, still run all configured lenses and explicitly record the limitation.
- **Next step after passing:** continue the Step 7 flow and then proceed to Step 8.
- **Non-substitution rule:** a clean `pre_approval_gate` comment is separate from `draft_gate` evidence. It governs final-approval readiness for that head SHA; it does **not** replace the required `draft_gate` evidence for leaving draft.
- **Required PR comment:** after the `pre_approval_gate` review runs, post a visible gate-review comment on the PR using the mandatory upsert helper (see Mandatory gate-comment command contract above). Keep validation reporting concise: include command names with pass/fail status. Do **not** paste raw passing test output into the visible gate comment. If you include a failing validation excerpt, keep it focused and truncate it to a deterministic retained-prefix length before posting the comment. If the `pre_approval_gate` finds issues, the comment must say that follow-up fixes are required before final approval. Do not declare final-approval readiness unless a visible `clean` `pre_approval_gate` gate-review comment exists for the current head SHA. Final-approval readiness must not rely only on local or hidden artifacts; the visible PR comment is the required auditable evidence. See `docs/gate-review-comment-contract.md` for required fields, verdict definitions, and fail-closed behavior.
- The `pre_approval_gate` procedure must be entered and completed (visible comment posted) before any merge-ready or approval-ready declaration. Skipping the gate is not recoverable by asserting convergence.
- A gate-review comment for an older head SHA does not satisfy this requirement for the current head.
- If fixes advance the head SHA, post a new gate-review comment for the new head.

### Merge-ready preconditions

Do not declare merge-ready unless all of these checks pass in order:

1. `unresolvedThreadCount === 0`, verified via `capture-review-threads.mjs` rather than by prose assertion alone
2. a visible `pre_approval_gate` comment exists on the PR for the current head SHA with verdict `clean`
3. CI is green on the current head SHA

If any check fails, do not declare merge-ready.

For any parallel review pass:
- start each reviewer in fresh context
- give each reviewer a concise focus-specific briefing summary instead of relying on inherited conversation state
- include the PR/branch, intended scope, relevant issue or plan link, current validation/check status, key files or artifacts, and the exact review angle
- do not fork the parent session just to preserve prior chat state; write a compact handoff artifact under `tmp/copilot-loop/` when a reviewer needs more shared context

Do not make unrelated cleanup changes just because the branch is already open.

## Validation policy for this repo

Default validation should match or approximate the active repository's PR CI.

Strong defaults:
- prefer the repo's declared root scripts when they exist
- prefer package-local test/check scripts when the change is isolated to one Pi package surface
- if the repo does not yet define CI-equivalent scripts, say so explicitly and run the narrowest honest validation available

Useful examples in this repository:
- changes under `skills/dev-loop/scripts/`: `npm run test:dev-loop`
- changes under `skills/dev-loop/templates/`: run the relevant root smoke/contract tests (for example `npm run test:assets`) because `test:dev-loop` currently covers the surviving script-level tests only
- docs-only changes: `git diff --check` and targeted markdown review
- frontmatter or skill-only changes: parse/inspect the updated `SKILL.md` files and note any remaining gaps

When GitHub Actions runs already exist and the next step is to wait for them rather than rerun them locally, prefer native GitHub CLI watch support where available:
- use `gh run watch` for a known workflow run ID
- fall back to snapshot inspection when no watchable run ID is known yet

When reporting status, distinguish between:
- locally validated narrowly
- locally validated with full PR-equivalent checks
- still awaiting GitHub CI confirmation

## Artifact and note layout

Do not use the phase-artifact structure from the local dev-loop.

For this repo-specific async Copilot loop, prefer lightweight PR/issue artifacts under `tmp/copilot-loop/` such as:

- `tmp/copilot-loop/issue-<n>/summary.md`
- `tmp/copilot-loop/pr-<n>/status.md`
- `tmp/copilot-loop/pr-<n>/copilot-baseline-<timestamp>.json`
- `tmp/copilot-loop/pr-<n>/copilot-review-<timestamp>.json`
- `tmp/copilot-loop/pr-<n>/copilot-review-<timestamp>.md`
- `tmp/copilot-loop/pr-<n>/pi-findings-<timestamp>.md`
- `tmp/copilot-loop/pr-<n>/fix-summary-<timestamp>.md`

Use these artifacts only when they genuinely help async continuation or handoff. Do not create noise files by default.

## Confirmation checkpoints

Always stop and ask before these actions unless explicitly authorized already:
- editing repository files
- assigning or reassigning an issue
- changing labels or milestones
- posting GitHub comments or review replies
- submitting a PR review
- resolving review threads
- committing local changes
- pushing a branch
- merging a PR
- triggering workflows

When a PR verdict is requested:
- first summarize pending comments/threads
- summarize proposed resolution status
- draft the verdict text
- if the PR was not opened by the active GitHub user, use a formal GitHub review after confirmation: Approve for merge-ready, Request Changes for must-fix findings; treat merge authorization as a separate explicit decision
- do not leave only a plain PR comment for those verdicts
- ask for confirmation before submitting the review

## Merge-readiness checklist

Before recommending merge, confirm:
- issue scope is satisfied
- acceptance criteria appear met
- unresolved blocking comments are addressed or intentionally deferred with rationale
- validation is appropriate for the change
- CI is green or the remaining risk is clearly disclosed
- no unrelated files are included

Then ask for confirmation before any merge or formal GitHub review action.

## Stop conditions

Stop and report instead of acting when:
- the next step requires a GitHub mutation that is not yet authorized
- issue scope is ambiguous
- the PR has no actionable unresolved feedback
- CI failures are unrelated and require maintainer judgment
- the branch contains unrelated local changes
- a proposed fix would broaden scope beyond the issue/PR

## Anti-patterns

Do not:
- treat this repo like a local phase-by-phase prototype workflow
- create a separate local backlog
- broaden a Copilot PR into multiple issue scopes
- resolve threads without checking whether the current branch actually fixes them
- use inline `gh api` to post thread replies without the resolve mutation
- submit a merge-ready verdict without first summarizing the pending thread state
- declare merge-ready without a visible `pre_approval_gate` comment on the current head SHA
- declare merge-ready based solely on `mergeable_state: clean` + CI green without gate evidence
- suggest approval, approve and merge, or any approval-ready statement without explicit current-head `pre_approval_gate` gate-review evidence
- treat CI green + resolved review threads + clean Copilot rereview as sufficient for approval or merge without an explicit current-head `pre_approval_gate` gate-review comment
- dispatch an async dev-loop task that omits the pre-approval gate requirement
- post gate review comments with gh pr comment or gh pr review instead of upsert-gate-review-comment.mjs
- bypass Pi async notifications with detached automation when the user wants in-session async behavior
- assume the generated wiki is authoritative over code or CI

## Recommended companion skills

Use these alongside this skill when appropriate:
- `dev-loop` when the user explicitly wants a local phase-based implementation path instead of the GitHub/Copilot path
- any repo-local async review-follow-up skill when deterministic waiting on new Copilot review activity is available
- any repo-local async review/fix skill when in-session follow-up execution is available

## Output expectations

When using this skill, keep user-facing summaries concise and operational.

A good status update should say:
- what issue or PR you inspected
- current state
- what the next recommended action is
- whether authorization is needed before taking it

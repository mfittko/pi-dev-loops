---
name: copilot-dev-loop
description: >-
  Use for GitHub-first Pi development workflows when the user wants to choose or
  confirm a ready GitHub issue, align on scope and acceptance criteria, hand
  work to Copilot when appropriate, watch the resulting PR for new Copilot
  review activity, run async Pi follow-up review/fix passes in-session,
  validate with repository-appropriate checks, and stop for confirmation before
  any GitHub or branch state changes.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth; async follow-up works best in Pi/TelePi sessions.
allowed-tools: read bash edit write subagent review_loop
user-invocable: true
---

# Copilot Dev Loop

This skill is the Pi-first GitHub/Copilot alternative to a local phase-based dev loop.

Use it when the user wants to work through the normal GitHub/Copilot flow rather than a purely local implementation loop. Keep repository specifics grounded in the active repo's actual files, scripts, CI, and GitHub state rather than assuming a hard-coded project layout.

Typical triggers:
- start the copilot dev loop
- continue the copilot loop
- hand the next ready issue to Copilot
- watch the Copilot PR and follow up
- continue PR review/fix work for the current Copilot branch

## Operational cookbook

Quick reference for the common PR follow-up path. All commands use the resolved skill scripts directory (see [Skill asset path resolution](#skill-asset-path-resolution) below).

**1. Detect current loop state**
```sh
node <resolved-skill-scripts>/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <number>
```
Emits JSON including `{ ok: true, state, allowedTransitions, nextAction, snapshot }`. Follow `nextAction`.

**2. Request Copilot review (if needed)**
```sh
node <resolved-skill-scripts>/github/request-copilot-review.mjs --repo <owner/name> --pr <number>
```
Emits JSON including `{ ok: true, status, repo, pr, reviewer, detail? }`.

**3. Watch for fresh Copilot review activity**
```sh
node <resolved-skill-scripts>/github/watch-copilot-review.mjs \
  --repo <owner/name> --pr <number> \
  --poll-interval-ms 60000 --timeout-ms 86400000
```
Emits JSON including `{ ok: true, status, repo, pr, attempts, newComments, newReviews, newIssueComments }`.

**4. One-step detect → request → emit watch params (preferred handoff)**
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --repo <owner/name> --pr <number>
```
Detects state, requests review when appropriate, and emits JSON including `{ ok: true, action, state, allowedTransitions, nextAction, snapshot, reviewRequestStatus?, watchArgs? }`.
When `action` is `"watch"`, use the returned `watchArgs` with `watch-copilot-review.mjs` directly.

**Request status reference**
| Status | Meaning | Next step |
| --- | --- | --- |
| `requested` | Copilot added to reviewers | Baseline and watch |
| `already-requested` | Copilot was already pending | Baseline and watch |
| `unavailable` | Copilot review not enabled | Report and stop |

**Pass `--help` to any helper for full usage:**
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --help
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

## Required read order

Before planning, review, or automation:

1. `README.md`
2. `PLAN.md` if present
3. `AGENTS.md` if present
4. the relevant GitHub issue or PR
5. the repository's actual validation surface:
   - root `package.json`
   - relevant package-level `package.json` files
   - CI/workflow configuration if present
6. task-relevant source files, tests, configuration, and any repo-local documentation or generated context

If the repo includes generated wiki or LLM context files, treat them as orientation aids only.

Verify all material claims against source, tests, configuration, and CI.

## Skill asset path resolution

When this skill refers to helper paths such as `scripts/...` or `docs/...`, resolve them from the actual skill installation layout you are running, not from the active target repository checkout.

Use this rule:
- if the skill is installed as a normalized standalone copy, helper assets may live under `scripts/` and `docs/` inside the skill directory
- if you are working in the `pi-dev-loops` source repository, this skill file lives under `skills/copilot-dev-loop/`, so the same helper assets live one level up at `../scripts/` and `../docs/`
- when in doubt, resolve helper paths relative to this `SKILL.md` file first, then verify the target file exists before running it

Do not assume `scripts/...` is repo-local to the target codebase you are operating on.

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

## Deterministic orchestration authority

When operating in PR follow-up or async watch mode, use the deterministic state machines
as the authoritative source for:

- Copilot follow-up loop: `detect-copilot-loop-state.mjs` from the resolved skill scripts directory
- reviewer-side PR review loop: `detect-reviewer-loop-state.mjs` from the resolved skill scripts directory

Resolve those helper paths from the skill asset layout described above. In the `pi-dev-loops`
source repository the skill scripts directory is `../scripts/` relative to this file; in normalized
installed copies it may instead be `scripts/` inside the installed skill directory.

- what state the PR/loop is in right now
- what transitions are currently allowed
- what the next required action is
- when to stop instead of guessing

Each machine captures an observable snapshot from GitHub facts (plus explicit bounded local loop
metadata when required) and interprets it into exactly one current state plus allowed next
transitions. See `copilot-loop-state-graph.md` and `reviewer-loop-state-graph.md` in the resolved
skill docs directory; in the `pi-dev-loops` source repository that docs directory is `../docs/`
relative to this file.

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

   In the `pi-dev-loops` source repository, `<resolved-skill-scripts>` is `../scripts` relative to this file.
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

If the user says “what is next,” use GitHub issue readiness plus current PR state to answer.

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

When opening or updating a PR through this workflow, do not use a thin placeholder body.

The PR description should be detailed enough that a fresh reviewer can understand the intended change without reconstructing it from commits alone.

At minimum include clearly labeled sections for:
- summary of the shipped change
- scope/context or why this PR exists now
- explicit acceptance criteria
- explicit definition of done
- explicit non-goals
- links to the relevant issue, durable phase doc, or other planning source when applicable

Keep verdict status, pass/fail assessments, evidence tables, and changelog-style release notes out of the PR description; those belong in review output, validation logs, or release notes instead.

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

When confirming whether Copilot is requested as a reviewer, do not rely solely on `gh pr view --json reviewRequests`.

Prefer the deterministic helper `request-copilot-review.mjs` from the resolved skill scripts directory when it exists. That helper verifies reviewer state through `gh api repos/<owner>/<repo>/pulls/<number>/requested_reviewers`, which is more reliable here than `gh pr view --json reviewRequests`.

When a PR is moved from draft to ready, explicitly attempt to request Copilot review rather than assuming repository automation will do it.

After any follow-up fix commit is pushed to an open PR, explicitly decide whether another Copilot pass is desired. If yes, first return the updated head to a green or credibly green validation posture (smallest honest local validation is green and there is no known fixable CI-red state), then request Copilot review again rather than assuming GitHub will automatically re-request it for the new head.

Do not web-search or rediscover this behavior during normal operation. Treat the deterministic helper and the repository docs as the source of truth unless you are explicitly debugging the tooling itself.

When introducing or changing deterministic GitHub write helpers (for example review-request or reply/resolve helpers), do not rely on fixture tests alone if a real authorized PR is available. Run one bounded real-PR smoke check before entrusting a long-lived async loop to that helper.

If the explicit request fails because Copilot review is not enabled for the repository, the reviewer identity is not requestable, or GitHub rejects the request because the reviewer is not a collaborator/requestable actor, record that exact limitation explicitly.

Do not treat an attempted request as equivalent to a confirmed request.

For the resolved `request-copilot-review.mjs` helper, branch on the machine-readable result:
- `requested`: if another Copilot pass is actually desired, baseline fresh state and then wait/watch; otherwise report current state without waiting
- `already-requested`: if another Copilot pass is actually desired, baseline fresh state and then wait/watch; otherwise report current state without waiting
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
- after a PR leaves draft, explicitly request Copilot review first, preferably through the resolved `request-copilot-review.mjs` helper
- after any follow-up fix commit is pushed and another Copilot pass is wanted, first return the updated head to a green or credibly green validation posture, then explicitly request Copilot review again for that head before waiting
- only enter the watch loop after the request state is confirmed as `requested` or `already-requested`
- baseline current Copilot review activity only after that confirmed request state, unless the user explicitly asked for passive waiting without a fresh request
- poll for new Copilot-authored review activity across review-thread comments, review summaries, and PR issue comments
- keep the watcher in the current Pi/TelePi session
- for unattended or long-lived waiting, prefer a Pi async subagent or the designated async follow-up skill rather than inventing a new watcher mechanism
- after new review activity appears, launch an async Pi fixer in-session
- do not report the loop complete while fresh Copilot comments remain unresolved; a new Copilot pass must flow back into fixer/reply/resolve work before completion when authorization exists
- use explicit long timeouts from the timeout policy above rather than short defaults

Use an existing repo-local async review-follow-up skill or deterministic watcher when available.

Key rules:
- expected polling idle time is normal
- do not restart watchers just because there has been a short quiet period
- do not use `nohup`, detached shell jobs, tmux/screen sessions, or ad hoc `while`/`sleep` bash loops for this workflow
- do not bypass session-based async notifications with detached shell automation unless explicitly asked
- if a watcher is sleeping between polls, prefer raising the orchestration inactivity threshold over interrupting the child
- if Pi async subagents or the designated async follow-up skill are not appropriate or available, stop and report rather than improvising a shell watcher

## Step 7: Pi review/fix follow-up loop

When actionable review feedback exists, use a narrow follow-up loop:

1. inspect unresolved comments/threads and failing checks
2. classify findings:
   - must fix now
   - worth fixing now
   - defer / non-blocking / disagree
3. apply only the accepted narrow fixes
4. run the smallest validation that honestly proves the fix
5. if files changed, push the resolving commit before any thread reply claims the fix is present
6. when a comment or thread is actually addressed, reply on GitHub with a short resolution note that references the resolving commit SHA or commit URL when applicable
   - prefer the deterministic helper `reply-resolve-review-thread.mjs` from the resolved skill scripts directory when it exists
   - use a body file under `tmp/` rather than inline shell text for the reply body
   - if that helper was newly added or recently changed, smoke-check it against one real thread before assuming the rest of the loop can rely on it
7. resolve the addressed review thread only after the reply is attached successfully and the concern is genuinely addressed
   - do not stop at a local fix if GitHub-side reply/resolve is authorized
8. only after GitHub-side reply/resolve work is done for the addressed threads, decide whether another Copilot pass is desired
   - if yes, run the smallest honest local validation for the accepted fix scope
   - if that local validation is still known red, continue remediation instead of re-requesting Copilot
   - if GitHub CI/checks for the updated head are known red for a fixable issue, continue remediation instead of re-requesting Copilot
   - only once the updated head is green or credibly green, explicitly re-request Copilot review for the new head rather than assuming it remains requested
   - only enter a wait/watch loop if the request result is confirmed as `requested` or `already-requested`
   - if the request result is `unavailable`, report that limitation and stop unless the user explicitly wants passive waiting anyway
   - if the request command fails unexpectedly, stop and report the error rather than sleeping and hoping for a new review
9. after a confirmed re-requested Copilot pass, refresh PR thread state again before reporting completion; if fresh Copilot threads exist, return to this follow-up loop rather than stopping at "review requested"
10. if scope has broadened, stop and ask before continuing

Do not treat "fix applied locally" as the end of the loop when the workflow also requires GitHub-side reviewer follow-up. If comment/reply authorization is withheld, report explicitly that the code may be fixed while the PR conversation state remains unresolved.

When helpful, run parallel review angles such as:
- correctness/regressions
- tests/validation
- maintainability/scope control

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
- changes under `skills/dev-loop/scripts/` or `skills/dev-loop/templates/`: `npm --prefix skills/dev-loop test`
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
- if the PR was not opened by the active GitHub user, use a formal GitHub review after confirmation: Approve for merge-ready, Request Changes for must-fix findings
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
- submit a merge-ready verdict without first summarizing the pending thread state
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

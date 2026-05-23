# Shared script area

This directory is reserved for deterministic workflow entrypoints.

Scripts here should prefer:

1. native `gh ... watch` support when it matches the exact wait condition,
2. shared package helpers for pure parsing and state logic,
3. stable machine-readable JSON output for skills and async workflows.

In this source-loaded workspace repo, root scripts may consume shared package helpers through a thin local adapter rather than a published package import path so the checkout remains runnable without an install step.

## Authority note

For the script surfaces documented here:
- code, tests, and the helper entrypoints themselves are authoritative for shipped runtime behavior
- this README summarizes those contracts for operators and maintainers; if behavior changes, update the code/tests and then sync this document
- use the more specific state-graph and contract docs under `docs/` when a helper family has a narrower machine-readable contract that this README is summarizing

## Phase 5 scripts

### `scripts/github/capture-review-threads.mjs`

Capture and normalize PR review-thread JSON.

Supported inputs:
- `--input <path>`
- stdin JSON
- live GitHub capture with `--repo <owner/name> --pr <number>`

Optional:
- `--output <path>` writes the same success JSON emitted on stdout

Success output shape:
- `{ "ok": true, "source": { ... }, "summary": { ... }, "threads": [...], "comments": [...] }`
- when `--output` is used, success output also includes `"outputPath"`

Failure behavior:
- malformed arguments, invalid JSON, and `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero
- live capture is only allowed when both `--repo` and `--pr` are present

### `scripts/github/request-copilot-review.mjs`

Request Copilot review on a PR and verify the request deterministically.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--force-rerequest-review` — bypass same-head clean-convergence suppression and attempt another explicit request

Contract:
- checks `requested_reviewers` first so an existing Copilot request is detected without mutating PR state again
- requests Copilot via `gh pr edit <pr> --repo <owner/name> --add-reviewer @copilot`
- is suitable both for the first request after ready-for-review and for later explicit re-requests after follow-up fix commits land on the PR head
- suppresses direct same-head clean re-requests by default when the current head is deterministically clean-converged; use `--force-rerequest-review` to bypass that suppression explicitly
- should be paired with a fresh unresolved-thread check after Copilot posts again; requesting review alone does not complete the loop
- verifies the result through `gh api repos/<owner>/<name>/pulls/<pr>/requested_reviewers`
- does **not** rely on `gh pr view --json reviewRequests`, which can be incomplete for Copilot reviewer state
- normalizes known repository/tooling limitations into a machine-readable `unavailable` result instead of forcing callers to parse ad hoc stderr

Success output shape:
- `{ "ok": true, "status": "requested"|"already-requested"|"unavailable"|"suppressed_same_head_clean", "repo": "owner/name", "pr": 17, "reviewer": "Copilot", ... }`
- `unavailable` also includes a `detail` string with the normalized GitHub/CLI limitation
- `suppressed_same_head_clean` includes `sameHeadCleanConverged: true` and an override hint
- forced bypass results include `bypassedSameHeadCleanSuppression: true`

Failure behavior:
- malformed arguments and unexpected `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/github/detect-linked-issue-pr.mjs`

Detect whether an issue already has an open linked PR in the same repository.

Required:
- `--repo <owner/name>`
- `--issue <number>`

Contract:
- queries issue timeline linked-PR events (`CONNECTED_EVENT`, `CROSS_REFERENCED_EVENT`)
- pages through timeline items until `hasNextPage=false`
- keeps only open linked PRs in the same repository (`repository.nameWithOwner === <repo>`)
- chooses deterministically when multiple candidates remain:
  1. prefer `CONNECTED_EVENT` candidates over `CROSS_REFERENCED_EVENT`
  2. then choose newest linked-event `createdAt`
  3. then stable fallback by PR number/url
- returns a machine-readable selection payload for skills/workflows; callers should not re-implement query/pagination/tie-break logic in markdown policy text

Success output shape:
- `{ "ok": true, "repo": "owner/name", "issue": 85, "hasOpenLinkedPr": true|false, "prNumber": 90|null, "prUrl": "..."|null, "selection"?: { "eventType": "...", "eventCreatedAt": "..." } }`

Failure behavior:
- malformed arguments and unexpected `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/github/stage-reviewer-draft.mjs`

Stage a pending reviewer-side draft review from a merged deterministic review package.

Required:
- `--repo <owner/name>`
- `--pr <number>`
- `--review-file <path>`

Optional:
- `--local-state-output <path>` writes/merges deterministic draft-review metadata for later
  `detect-reviewer-loop-state.mjs --local-state` use

Contract:
- reads a merged reviewer result JSON file (for example output derived from `mergeReviewerResults`)
- builds a deterministic pending-review payload pinned to the review package `headSha`
- posts the pending review to `repos/<owner>/<name>/pulls/<pr>/reviews` without an `event` field so GitHub keeps it pending
- returns the draft review id/url/commit sha
- optionally writes bounded local reviewer-loop metadata including `draftReviewPosted`, `draftReviewId`, `draftReviewUrl`, `draftReviewCommitSha`, and `draftReviewNotificationStatus`

Success output shape:
- `{ "ok": true, "repo": "owner/name", "pr": 17, "reviewId": 456, "reviewUrl": "...", "reviewState": "PENDING", "commitSha": "abc123", "localStatePath": "..."|null }`

Failure behavior:
- malformed arguments, invalid review JSON, missing `headSha`, unexpected `gh` failures, and malformed review-create responses emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/github/reply-resolve-review-thread.mjs`

Reply to a PR review comment and resolve the associated review thread deterministically.

Required:
- `--repo <owner/name>`
- `--pr <number>`
- `--comment-id <number>`
- `--thread-id <node-id>`
- `--body-file <path>`

Contract:
- reads the reply body from a file so shell quoting does not become part of the workflow logic
- posts the reply to `repos/<owner>/<name>/pulls/<pr>/comments/<comment-id>/replies`
- resolves the thread with the GraphQL `resolveReviewThread` mutation
- fails if the thread does not report resolved after the mutation

Success output shape:
- `{ "ok": true, "repo": "owner/name", "pr": 17, "commentId": 123, "threadId": "...", "replyId": 456, "replyUrl": "...", "resolved": true }`

Failure behavior:
- malformed arguments, empty body files, unexpected `gh` failures, and unsuccessful resolve responses emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

For new GitHub mutation helpers in this repo, do not stop at fixture-only confidence when a real PR is available and mutation is authorized. Run a bounded real-PR smoke check before depending on the helper inside a longer async review/fix loop.

### `scripts/github/watch-copilot-review.mjs`

Watch for fresh Copilot-authored review activity on a PR.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--poll-interval-ms <positive-integer>` (default `60000`, i.e. 1 minute)
- `--timeout-ms <non-negative-integer>` (default `86400000`, i.e. 24 hours)

Contract:
- captures a baseline snapshot, then performs a bounded number of follow-up polls
- returns `changed` for any fresh Copilot-authored review-thread comments, PR review summaries, or PR issue comments that were not present in the baseline snapshot
- ignores fresh non-Copilot review activity across those same surfaces
- `--timeout-ms 0` performs a single immediate recheck and returns `idle` if unchanged

Success output shape:
- `{ "ok": true, "status": "changed"|"timeout"|"idle", "repo": "owner/name", "pr": 17, "attempts": 1, "newComments": [...], "newReviews": [...], "newIssueComments": [...] }`

Failure behavior:
- malformed arguments and `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/detect-initial-copilot-pr-state.mjs`

Detect the post-assignment issue-to-linked-PR seam for Copilot handoff.

Required:
- `--repo <owner/name>`
- `--issue <number>`

Contract:
- uses `scripts/github/detect-linked-issue-pr.mjs` as the authoritative linked-PR selector
- returns exactly one deterministic state:
  - `no_linked_pr`
  - `waiting_for_initial_copilot_implementation`
  - `linked_pr_ready_for_followup`
- classifies `waiting_for_initial_copilot_implementation` only for the bounded bootstrap-only draft shape:
  - open same-repo linked PR
  - draft
  - Copilot-authored
  - exactly 1 commit
  - sole commit headline exactly `Initial plan`
  - exactly 0 changed files
- fails closed with explicit error output when required PR facts cannot be fetched

Success output shape:
- `{ "ok": true, "repo": "owner/name", "issue": 59, "state": "...", "prNumber": 79|null, "prUrl": "..."|null, "isDraft": true|false|null, "changedFiles": 0|null, "commitCount": 1|null, "soleCommitHeadline": "Initial plan"|null, "authorLogin": "Copilot"|null }`

Failure behavior:
- malformed arguments and unexpected `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/copilot-pr-handoff.mjs`

Thin high-level helper for the common Copilot PR follow-up handoff path.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--force-rerequest-review` — explicit operator/manual override that forces another Copilot request even when automatic same-head suppression is active
- `--watch-status <changed|timeout|idle>` — refresh deterministic state after a prior watcher observation; this readback mode never requests review again

Contract:
- detects the current Copilot-loop state for the PR
- requests Copilot review automatically for `pr_ready_no_feedback`
- requests Copilot review automatically for `ready_to_rerequest_review` only when `autoRerequestEligible=true`
- does not request or re-request Copilot review when `ciStatus` is `none`; that path remains gated as `waiting_for_ci`
- suppresses automatic same-head clean re-request when `sameHeadCleanConverged=true`, unless `--force-rerequest-review` is used
- when a review request is successfully issued or confirmed (including the explicit force path), re-interprets from the shared post-request wait-cycle snapshot and emits `action: "watch"` with exact `watchArgs`
- when `--watch-status` is provided, treats the watcher result as observational only, refreshes GitHub state, and emits `loopDisposition` plus `terminal` so timeout/idle cannot be mistaken for clean completion
- emits one machine-readable action: `watch`, `fix`, or `stop` (`stop` means no automatic next step; terminal, blocked, or operator-decision-required states all use this action)
- when the action is `watch`, emits exact `watchArgs` for `watch-copilot-review.mjs`

Success output shape:
- `{ "ok": true, "action": "watch"|"fix"|"stop", "state": "...", "allowedTransitions": [...], "nextAction": "...", "snapshot": {...}, "reviewRequestStatus"?: "...", "watchStatus"?: "...", "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false, "loopDisposition": "...", "terminal": true|false, "watchArgs"?: { ... } }`

Failure behavior:
- malformed arguments and unexpected `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/detect-copilot-loop-state.mjs`

Deterministic Copilot-loop state detector. Captures current loop state from observable PR/GitHub
facts and interprets the snapshot into one explicit current state, allowed next transitions, and
a recommended next action. This script is the orchestration authority for the async Copilot
review/fix loop; see `docs/copilot-loop-state-graph.md` for the full state-graph design.

Two modes:

- **Auto-detect**: `--repo <owner/name> --pr <number>`
  Fetches PR state, Copilot review request status, review threads, and CI checks from GitHub,
  builds a snapshot, and interprets it.

- **Snapshot interpretation**: `--input <path>`
  Reads a pre-built snapshot JSON and interprets it without any `gh` calls. Use this mode when
  the caller has already gathered facts — for example, to incorporate the `status` field from a
  prior `scripts/github/request-copilot-review.mjs` run, which can report `unavailable` or
  `failed` statuses that are not observable from static GitHub state alone.

Optional (auto-detect mode only):
- `--steering-state-file <path>`
  Resolve the detected state through the active steering contract. This is
  available only in `--repo/--pr` mode; snapshot `--input` mode does not accept
  steering files because repo/pr target identity cannot be proven from the
  snapshot alone.
- `--review-request-status <requested|already-requested|unavailable|none|failed>`
  Override the Copilot review-request status with a known prior result. Skips the
  `requested_reviewers` API call and injects the provided value directly into the snapshot.
  Use when the caller already ran `request-copilot-review.mjs` and wants to inject its output
  status without re-probing the reviewers endpoint.

Snapshot schema (`--input` mode or `snapshot` field in success output):
- `prExists` {boolean} — whether a PR was found
- `prNumber` {number|null} — PR number if prExists, otherwise null
- `prDraft` {boolean} — whether the PR is in draft state
- `prMerged` {boolean} — whether the PR has been merged
- `prClosed` {boolean} — whether the PR was closed without merge; merged PRs set `prMerged=true` instead of reusing `prClosed`
- `copilotReviewRequestStatus` {"requested"|"already-requested"|"unavailable"|"none"|"failed"} — current known Copilot review-request state
- `copilotReviewPresent` {boolean} — whether at least one Copilot review exists on the PR
- `copilotReviewOnCurrentHead` {boolean} — whether a submitted (non-PENDING) Copilot review exists for the current head commit
- `unresolvedThreadCount` {number} — total unresolved review-thread count
- `actionableThreadCount` {number} — unresolved threads with non-bot actionable comments
- `ciStatus` {"success"|"failure"|"pending"|"none"} — current CI check rollup; `none` means no usable readiness signal yet and is not treated as green
- `agentFixStatus` {"applied"|null} — agent-provided: "applied" when code has been fixed

Success output shape:
- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "...", "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false, "loopDisposition": "...", "terminal": true|false }`
- `state` is one of the stable state names defined in `docs/copilot-loop-state-graph.md`
- `allowedTransitions` is the list of states reachable from `state`
- `nextAction` is a human-readable recommended next step
- `autoRerequestEligible` is `true` only when a meaningful remediation event has made automatic re-request valid again
- `sameHeadCleanConverged` is `true` when the current head already has a clean submitted Copilot review and automatic same-head re-request must be suppressed
- `loopDisposition` is the high-level refreshed classification: `pending`, `unresolved_feedback`, `clean_converged`, `blocked`, `action_required`, or `done`
- `terminal` is `true` only for clean-converged, blocked, or done states; watcher timeout/idle must be treated as non-terminal until a refreshed detector output proves `terminal=true`

Failure behavior:
- Malformed arguments, unexpected `gh` failures, and review-thread detection failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

Key behavioral guarantees:
- When `unresolvedThreadCount > 0`, the state is always in the fix/reply-resolve family — never `waiting_for_copilot_review` or any wait state
- When `copilotReviewRequestStatus` is `unavailable` or `failed`, the state is a terminal stop/report state with no allowed transitions
- When `agentFixStatus` is `"applied"` and unresolved threads exist, the state is `already_fixed_needs_reply_resolve`, and `allowedTransitions` includes only `ready_to_rerequest_review`
- When the current head already has a clean submitted Copilot review, `sameHeadCleanConverged=true` and automatic same-head re-request is suppressed until a meaningful remediation event occurs
- If review-thread state cannot be determined during auto-detect, the script fails closed instead of assuming zero unresolved threads

### `scripts/loop/detect-tracker-pr-state.mjs`

Deterministic tracker-first story-to-PR state detector. Interprets a pre-built
tracker/PR lifecycle snapshot into one explicit current state, allowed next
transitions, a recommended next action, and the canonical reverse-sync action.
This helper is intentionally snapshot-only: tracker-adapter lookups and live
GitHub discovery remain outside this CLI.

Required:
- `--input <path>`

Snapshot schema (`--input` JSON):
- `trackerItemExists` {boolean} — whether a tracker work item was found
- `trackerItemId` {string|null} — tracker item identifier if present
- `prExists` {boolean} — whether a PR exists for the tracker item
- `prNumber` {number|null} — PR number if known; `prNumber` with `prExists=false` is contradictory and blocked
- `prDraft` {boolean} — whether the PR is still draft
- `prMerged` {boolean} — whether the PR has been merged
- `prClosed` {boolean} — whether the PR is closed on GitHub (merged PRs are also closed); `pr_closed_unmerged` is derived from `prClosed && !prMerged`

Unlike the Copilot/reviewer loop snapshots, this tracker snapshot uses `prClosed` for the raw GitHub closed state. Merged PRs therefore set both `prMerged=true` and `prClosed=true`, while `pr_closed_unmerged` is derived from `prClosed && !prMerged`.

This snapshot surface is intentionally limited to tracker identity plus PR lifecycle facts. It does not encode tracker-native workflow readiness/blocking/done state; higher-level callers must combine tracker-owned state separately when deciding whether opening a PR is appropriate.

Success output shape:
- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "...", "reverseSyncAction": "..." }`

Failure behavior:
- malformed arguments emit `{ "ok": false, "error": "...", "usage": "..." }`
  on stderr and exit non-zero
- unreadable input files, invalid JSON, and invalid snapshot objects emit
  `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/detect-reviewer-loop-state.mjs`

Deterministic reviewer-loop state detector. Captures reviewer-side PR loop state from observable
GitHub facts plus optional local reviewer-loop metadata and interprets that snapshot into one
explicit current state, allowed next transitions, and a recommended next action. See
`docs/reviewer-loop-state-graph.md` for the full reviewer-loop state graph and contracts.

Two modes:

- **Auto-detect**: `--repo <owner/name> --pr <number>`
  Fetches PR/open-head state, review-request status, and pending/submitted review surfaces from
  GitHub and interprets them into deterministic reviewer-loop state. When `--reviewer-login` is
  omitted, this uses aggregate all-reviewer scope for the PR.

- **Snapshot interpretation**: `--input <path>`
  Reads a pre-built snapshot JSON and interprets it without any `gh` calls.

Optional (auto-detect mode only):
- `--reviewer-login <login>`
  Scope review-request and review-surface detection to a single reviewer identity. Success output
  snapshots include `reviewerScope` (`"all_reviewers"` or `"single_reviewer"`) plus
  `reviewerLogin` (`string|null`) so callers can tell whether the detector used aggregate or
  single-reviewer scope.
- `--review-requested <true|false>`
  Override review-request detection with a known prior result.
- `--local-state <path>`
  Inject local reviewer-loop metadata (planning/run/merge/draft-notification status) used for
  deterministic planning/running/merge-ready and draft lifecycle transitions.

Success output shape:
- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "..." }`

Failure behavior:
- malformed arguments, unexpected `gh` failures, and invalid input/local-state JSON emit
  `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/outer-loop.mjs`

Thin deterministic outer-loop wrapper for the Copilot PR remediation path. It combines
the existing Copilot and reviewer inner-loop detectors into one machine-readable outer
action so bounded external waits remain owned by the same remediation family instead of
looking like terminal run endpoints.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--reviewer-login <login>`
- `--checkpoint-dir <path>`
- `--copilot-input <path>`
- `--reviewer-input <path>`

Reviewer-scope contract:
- omitting `--reviewer-login` means aggregate all-reviewer scope for the PR
- providing `--reviewer-login` means single-reviewer scope for that login
- `--reviewer-input` cannot be combined with `--reviewer-login`

Contract:
- auto-detect mode calls both inner detectors, interprets their current states, and emits one
  outer action: `continue_wait`, `reenter_copilot_loop`, `reenter_reviewer_loop`, `stop`, or `done`
- treats draft PRs as a re-entry point into owned draft-stage follow-up rather than a terminal stop
- treats `waiting_for_copilot_review`, `waiting_for_ci`, reviewer `waiting_for_author_followup`,
  and reviewer `waiting_for_re_request` as outer-loop-owned `continue_wait` states
- stops with `unsafe_local_edit_requires_isolation` when the next step needs local execution or
  mutation and the checkout is dirty or detached
- persists bounded checkpoint state to `tmp/copilot-loop/<owner>/<repo>/pr-<n>/outer-loop-state.json` for
  async continuation and false-positive wakeup detection
- emits an additive `conductorRouting` field with the conductor-owned routing outcome, derived
  outer action, stop reason when relevant, and any machine-readable handoff envelope
- supports snapshot-input mode for deterministic gh-free testing

Success output shape:
- `{ "ok": true, "outerAction": "...", "copilotState": "...", "reviewerState": "...", "reviewerScope": { "mode": "all_reviewers"|"single_reviewer", "reviewerLogin": "..."|null }, "reason"?: "...", "conductorRouting": { "routingOutcome": "...", "outerAction": "...", "stopReason": null|"...", "handoffEnvelope": { ... } }, "checkpoint": { ... } }`

Failure behavior:
- malformed arguments emit `{ "ok": false, "error": "...", "usage": "..." }` on stderr and exit non-zero
- unexpected `gh` or `git` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/inspect-run.mjs`

Read-only inspection entrypoint for one explicit Copilot PR outer-loop target.
It composes current inner-loop facts into one JSON snapshot without attaching to
an active worker or mutating local/runtime state.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--steering-state-file <path>`
- `--reviewer-login <login>` — narrows live reviewer detection to one reviewer identity; when omitted, inspection uses aggregate all-reviewer scope for the PR
- `--copilot-input <path>`
- `--reviewer-input <path>` — cannot be combined with `--reviewer-login`

Contract:
- is strictly read-only: it does not write checkpoints, mutate GitHub state, or create local artifacts
- returns a stable top-level inspection shape with target identity, derived `runId`, authoritative `outerState`, conditional top-level `allowedTransitions`, compatibility `outerAction`, active family state,
  status class, trust/source semantics, evidence, markers, and best-effort drill-down layers
- only derives top-level `outerState` / `allowedTransitions` / `outerAction` / `activeFamilyState` / `statusClass` when inspection has a complete current inner-loop picture, whether from live detectors and/or caller-supplied snapshot inputs
- when inspection falls back to checkpoint-only data or mixed live + checkpoint evidence, checkpoint-backed drill-down layers and checkpoint evidence paths remain available as advisory context while the top-level state stays `"unknown"`
- reports not-found or unavailable targets as structured success output with `statusClass: "unknown"`
  rather than by throwing a synthetic blocked-run error
- looks for checkpoints at the repo-qualified default path `tmp/copilot-loop/<owner>/<repo>/pr-<n>/outer-loop-state.json`
- during transition, may read the legacy default path `tmp/copilot-loop/pr-<n>/outer-loop-state.json` only when the checkpoint file's embedded `repo` and `pr` match the explicit target
- surfaces steering as a best-effort drill-down layer when `--steering-state-file` is provided,
  including latest acknowledgement plus queued/effective stop summaries for the current run,
  without exposing full steering history/detail or raw steering-file locator paths
- when live GitHub PR facts are available, surfaces a deterministic `loopIterations` summary for the
  remote Copilot review/fix loop (completed rounds, pending round indicator, Copilot review comments,
  current resolved/unresolved review-thread counts, and fix commits after feedback)
- keeps `loopIterations` unavailable in snapshot-only / non-live inspection paths instead of
  inventing local phase-loop iteration semantics
- rejects mismatched steering-state files from the targeted repo/pr instead of projecting their state onto the inspected run

Success output shape:
- `{ "ok": true, "schemaVersion": 1, "target": { "repo": "...", "pr": 17 }, "runId": "pr-17", "inspectedAt": "...", "activeStateFamily": "copilot-pr-outer-loop", "outerState": "...", "allowedTransitions"?: [...], "outerAction": "...", "activeFamilyState": "...", "statusClass": "...", "needsAttention": false, "sourceMode": "...", "trust": "...", "evidence": { ... }, "markers": { ... }, "loopIterations": { "available": true|false, ... }, "layers": { "reviewer": { "currentState": "...", "scope": { "mode": "all_reviewers"|"single_reviewer", "reviewerLogin": "..."|null }, ... }, ... } }`

Failure behavior:
- malformed arguments emit `{ "ok": false, "error": "...", "usage": "..." }` on stderr and exit non-zero
- unexpected runtime failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/inspect-run-viewer.mjs`

Read-only single-run local browser viewer for one explicit Copilot PR outer-loop target.
This viewer is a downstream consumer of `inspect-run` and does not invent a second status model.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--host <host>` (default: `127.0.0.1`; non-loopback binds require `--allow-non-localhost`)
- `--port <port>` (default: `4311`)
- `--allow-non-localhost` (explicit opt-in for non-loopback binds such as `0.0.0.0` or LAN IPs)
- `--restart` (stop any existing listener on the chosen port before starting; requires `lsof` / POSIX support and sends `SIGTERM` to every listener already bound to that port)
- `--steering-state-file <path>` (pass-through to `inspect-run`)
- `--reviewer-login <login>` (pass-through to `inspect-run`)
- `--copilot-input <path>` (pass-through to `inspect-run`)
- `--reviewer-input <path>` (pass-through to `inspect-run`; cannot be combined with `--reviewer-login`)

Contract:
- read-only: no GitHub mutations, no checkpoint writes, no steering writes, no worker attachment
- local-viewer safety: default host remains loopback-only; non-loopback binds require explicit `--allow-non-localhost` because they may expose local inspection state on the network
- GitHub-first launch boundary: one explicit target (`repo` + `pr`)
- uses one thin adapter module (`scripts/loop/_inspect-run-viewer-adapter.mjs`) to load the normalized inspection snapshot
- adapter is the only viewer integration seam that calls the existing `inspect-run` contract in this source-loaded workspace
- serves two explicit read-only endpoints for the same target:
  - `/` → operator-facing HTML with a Mermaid-first graph that renders the authoritative outer, Copilot, and reviewer state graphs, highlights snapshot-derived current and immediate-next states when available, keeps inactive known states visible but dimmed, surfaces a prominent current-PR-state banner that prefers authoritative `outerState` over compatibility `outerAction`, and preserves supporting textual summary/evidence
  - `/snapshot.json` → the full authoritative inspection snapshot JSON returned by the adapter
- HTML includes a visible link to `/snapshot.json` so machine-readable state no longer depends on an inline full-snapshot dump in the page itself
- `/snapshot.json` returns `application/json; charset=utf-8` on success and deterministic JSON error output with non-2xx status when snapshot loading throws or yields no snapshot
- unsupported paths return deterministic `404` without loading a snapshot (even for unsupported methods on unknown paths); `/favicon.ico` returns deterministic `204`; unsupported methods on supported routes return `405 Allow: GET`
- both primary endpoints send `Cache-Control: no-store` to match the manual-reload workflow
- `--restart` is a local convenience flag that requires `lsof` / POSIX support and attempts to stop every listener already bound to the chosen port with `SIGTERM` before starting the new server process
- manual reload only (`window.location.reload()`); no polling/watch/timeout/control semantics

Local manual verification path:
1. Start viewer for one explicit target:
   - `node scripts/loop/inspect-run-viewer.mjs --repo <owner/name> --pr <number>`
2. Open the printed URL in a local browser and verify the human-oriented `/` page
3. Open `<printed-url>/snapshot.json` and verify it returns the full inspection snapshot JSON for the same target
4. Use browser refresh or the reload button for point-in-time re-inspection

Local WebKit/Playwright smoke path:
1. Install the Safari/WebKit browser runtime once:
   - `npm run playwright:install:safari`
2. Run the viewer smoke suite:
   - `npm run test:playwright:viewer`
3. Review screenshots/traces under `test-results/` and the HTML report under `playwright-report/inspect-run-viewer/`
4. Optionally hit `/favicon.ico` or an unsupported path to confirm those paths stay deterministic and do not perform snapshot rendering
5. For deterministic/local test mode, pass `--copilot-input` and `--reviewer-input` fixtures to viewer; these are forwarded to `inspect-run`

### `scripts/loop/steer-loop.mjs`

Mid-flight operator steering CLI for active dev loops.

Subcommands:
- `submit` — submit a steering directive to a specific run
- `status` — inspect the current steering state for a run

Contract:
- persists steering state to a JSON file (default: `.pi/steering/<owner>/<repo>/pr-<n>.json` for operator-facing `--repo/--pr` mode; `.pi/steering/<run-id>.json` for low-level `--run-id` mode)
- operator-facing `submit` resolves one explicit `repo` + `pr` target through the read-only
  inspection surface and derives `runId: pr-<number>` from that target while persisting repo-qualified target metadata alongside the steering state
- operator-facing `submit` is intentionally limited to `stop_at_next_safe_gate`; other directive
  kinds remain low-level/internal and are rejected on the external submit path
- operator-facing `submit` fails closed when inspection is partial, checkpoint-only, unavailable,
  stale, or conflicting
- low-level/testing mode may still accept injected loop-state inputs for deterministic tests
- returns deterministic acknowledgement/result payloads for `submit` and deterministic state
  readback for `status`
- rejected operator-facing submits leave any trusted durable steering file unchanged; when the
  persisted file is malformed or target-mismatched, the response may include a fresh synthetic
  target-scoped `steeringState` for deterministic readback without trusting broken persisted data

Success output shape:
- `submit`: `{ "ok": true, "acknowledgement": { ... }, "result": { ... }, "steeringState": { ... } }`
- `status`: `{ "ok": true, "status": { ... } }`

Failure behavior:
- argument/usage errors emit `{ "ok": false, "error": "...", "usage": "..." }` on stderr and exit non-zero
- runtime failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

### `scripts/loop/summarize-loop-state.mjs`

Summarize stored loop state from `tmp/phases/index.json` and per-phase manifests.

Optional:
- `--project-root <path>` (defaults to the current working directory)

Success output shape:
- `{ "ok": true, "projectRoot": "...", "index": { ... }, "phases": [...] }`
- each phase entry reports status, manifest presence, validation state, and deterministic artifact-presence/count fields

Failure behavior:
- malformed arguments emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero
- missing index or manifest files are reported in success JSON instead of causing mutation or cleanup

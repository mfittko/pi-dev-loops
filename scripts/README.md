# Shared script area

This directory is reserved for deterministic workflow entrypoints.

Scripts here should prefer:

1. native `gh ... watch` support when it matches the exact wait condition,
2. shared package helpers for pure parsing and state logic,
3. stable machine-readable JSON output for skills and async workflows.

In this source-loaded workspace repo, root scripts may consume shared package helpers through a thin local adapter rather than a published package import path so the checkout remains runnable without an install step.

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

Contract:
- checks `requested_reviewers` first so an existing Copilot request is detected without mutating PR state again
- requests Copilot via `gh pr edit <pr> --repo <owner/name> --add-reviewer @copilot`
- is suitable both for the first request after ready-for-review and for later explicit re-requests after follow-up fix commits land on the PR head
- should be paired with a fresh unresolved-thread check after Copilot posts again; requesting review alone does not complete the loop
- verifies the result through `gh api repos/<owner>/<name>/pulls/<pr>/requested_reviewers`
- does **not** rely on `gh pr view --json reviewRequests`, which can be incomplete for Copilot reviewer state
- normalizes known repository/tooling limitations into a machine-readable `unavailable` result instead of forcing callers to parse ad hoc stderr

Success output shape:
- `{ "ok": true, "status": "requested"|"already-requested"|"unavailable", "repo": "owner/name", "pr": 17, "reviewer": "Copilot", ... }`
- `unavailable` also includes a `detail` string with the normalized GitHub/CLI limitation

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

### `scripts/loop/copilot-pr-handoff.mjs`

Thin high-level helper for the common Copilot PR follow-up handoff path.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--force-rerequest-review` — explicit operator/manual override that forces another Copilot request even when automatic same-head suppression is active

Contract:
- detects the current Copilot-loop state for the PR
- requests Copilot review automatically for `pr_ready_no_feedback`
- requests Copilot review automatically for `ready_to_rerequest_review` only when `autoRerequestEligible=true`
- does not request or re-request Copilot review when `ciStatus` is `none`; that path remains gated as `waiting_for_ci`
- suppresses automatic same-head clean re-request when `sameHeadCleanConverged=true`, unless `--force-rerequest-review` is used
- when a review request is successfully issued or confirmed (including the explicit force path), re-interprets from the shared post-request wait-cycle snapshot and emits `action: "watch"` with exact `watchArgs`
- emits one machine-readable action: `watch`, `fix`, or `stop` (`stop` means no automatic next step; terminal, blocked, or operator-decision-required states all use this action)
- when the action is `watch`, emits exact `watchArgs` for `watch-copilot-review.mjs`

Success output shape:
- `{ "ok": true, "action": "watch"|"fix"|"stop", "state": "...", "allowedTransitions": [...], "nextAction": "...", "snapshot": {...}, "reviewRequestStatus"?: "...", "watchArgs"?: { ... } }`

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
- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "...", "autoRerequestEligible": true|false, "sameHeadCleanConverged": true|false }`
- `state` is one of the stable state names defined in `docs/copilot-loop-state-graph.md`
- `allowedTransitions` is the list of states reachable from `state`
- `nextAction` is a human-readable recommended next step
- `autoRerequestEligible` is `true` only when a meaningful remediation event has made automatic re-request valid again
- `sameHeadCleanConverged` is `true` when the current head already has a clean submitted Copilot review and automatic same-head re-request must be suppressed

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
  GitHub and interprets them into deterministic reviewer-loop state.

- **Snapshot interpretation**: `--input <path>`
  Reads a pre-built snapshot JSON and interprets it without any `gh` calls.

Optional (auto-detect mode only):
- `--reviewer-login <login>`
  Scope review-request and review-surface detection to a single reviewer identity.
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
- `{ "ok": true, "outerAction": "...", "copilotState": "...", "reviewerState": "...", "reason"?: "...", "conductorRouting": { "routingOutcome": "...", "outerAction": "...", "stopReason": null|"...", "handoffEnvelope": { ... } }, "checkpoint": { ... } }`

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
- `--copilot-input <path>`
- `--reviewer-input <path>`

Contract:
- is strictly read-only: it does not write checkpoints, mutate GitHub state, or create local artifacts
- returns a stable top-level inspection shape with target identity, derived `runId`, outer action, active family state,
  status class, trust/source semantics, evidence, markers, and best-effort drill-down layers
- reports not-found or unavailable targets as structured success output with `statusClass: "unknown"`
  rather than by throwing a synthetic blocked-run error
- looks for checkpoints at the repo-qualified default path `tmp/copilot-loop/<owner>/<repo>/pr-<n>/outer-loop-state.json`
- during transition, may read the legacy default path `tmp/copilot-loop/pr-<n>/outer-loop-state.json` only when the checkpoint file's embedded `repo` and `pr` match the explicit target
- surfaces steering as a best-effort drill-down layer when `--steering-state-file` is provided,
  including latest acknowledgement plus queued/effective stop summaries for the current run,
  without exposing full steering history/detail or raw steering-file locator paths
- rejects mismatched steering-state files from the targeted repo/pr instead of projecting their state onto the inspected run

Success output shape:
- `{ "ok": true, "schemaVersion": 1, "target": { "repo": "...", "pr": 17 }, "runId": "pr-17", "inspectedAt": "...", "activeStateFamily": "copilot-pr-outer-loop", "outerAction": "...", "activeFamilyState": "...", "statusClass": "...", "needsAttention": false, "sourceMode": "...", "trust": "...", "evidence": { ... }, "markers": { ... }, "layers": { ... } }`

Failure behavior:
- malformed arguments emit `{ "ok": false, "error": "...", "usage": "..." }` on stderr and exit non-zero
- unexpected runtime failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

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

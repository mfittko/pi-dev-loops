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
- `--poll-interval-ms <positive-integer>` (default `1000`)
- `--timeout-ms <non-negative-integer>` (default `60000`)

Contract:
- captures a baseline snapshot, then performs a bounded number of follow-up polls
- returns `changed` for any fresh Copilot-authored review-thread comments, PR review summaries, or PR issue comments that were not present in the baseline snapshot
- ignores fresh non-Copilot review activity across those same surfaces
- `--timeout-ms 0` performs a single immediate recheck and returns `idle` if unchanged

Success output shape:
- `{ "ok": true, "status": "changed"|"timeout"|"idle", "repo": "owner/name", "pr": 17, "attempts": 1, "newComments": [...], "newReviews": [...], "newIssueComments": [...] }`

Failure behavior:
- malformed arguments and `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

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
- `prClosed` {boolean} — whether the PR was closed without merge
- `copilotReviewRequestStatus` {"requested"|"already-requested"|"unavailable"|"none"|"failed"} — current known Copilot review-request state
- `copilotReviewPresent` {boolean} — whether at least one Copilot review exists on the PR
- `unresolvedThreadCount` {number} — total unresolved review-thread count
- `actionableThreadCount` {number} — unresolved threads with non-bot actionable comments
- `ciStatus` {"success"|"failure"|"pending"|"none"} — current CI check rollup
- `agentFixStatus` {"applied"|null} — agent-provided: "applied" when code has been fixed

Success output shape:
- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "..." }`
- `state` is one of the stable state names defined in `docs/copilot-loop-state-graph.md`
- `allowedTransitions` is the list of states reachable from `state`
- `nextAction` is a human-readable recommended next step

Failure behavior:
- Malformed arguments, unexpected `gh` failures, and review-thread detection failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

Key behavioral guarantees:
- When `unresolvedThreadCount > 0`, the state is always in the fix/reply-resolve family — never `waiting_for_copilot_review` or any wait state
- When `copilotReviewRequestStatus` is `unavailable` or `failed`, the state is a terminal stop/report state with no allowed transitions
- When `agentFixStatus` is `"applied"` and unresolved threads exist, the state is `already_fixed_needs_reply_resolve`, and `allowedTransitions` includes only `ready_to_rerequest_review`
- If review-thread state cannot be determined during auto-detect, the script fails closed instead of assuming zero unresolved threads

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

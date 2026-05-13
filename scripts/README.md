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

Watch for fresh Copilot-authored review/comment activity on a PR.

Required:
- `--repo <owner/name>`
- `--pr <number>`

Optional:
- `--poll-interval-ms <positive-integer>` (default `1000`)
- `--timeout-ms <non-negative-integer>` (default `60000`)

Contract:
- captures a baseline snapshot, then performs a bounded number of follow-up polls
- returns `changed` only for fresh Copilot-authored comments that were not present in the baseline snapshot
- ignores fresh non-Copilot review activity
- `--timeout-ms 0` performs a single immediate recheck and returns `idle` if unchanged

Success output shape:
- `{ "ok": true, "status": "changed"|"timeout"|"idle", "repo": "owner/name", "pr": 17, "attempts": 1, "newComments": [...] }`

Failure behavior:
- malformed arguments and `gh` failures emit `{ "ok": false, "error": "..." }` on stderr and exit non-zero

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

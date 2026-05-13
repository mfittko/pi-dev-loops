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

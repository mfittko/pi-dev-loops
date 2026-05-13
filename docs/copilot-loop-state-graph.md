# Copilot Loop State Graph

This document defines the deterministic state machine for the async Copilot review/fix loop.

## Overview

The state machine captures observable PR/GitHub/worktree facts (the **snapshot**) and maps them to exactly one **current state**, a list of **allowed next transitions**, and a **recommended next action**.

The implementation lives in:

- **Pure logic**: `packages/core/src/loop/copilot-loop-state.mjs` — state constants, transition table, `normalizeSnapshot`, `interpretLoopState`
- **CLI**: `scripts/loop/detect-copilot-loop-state.mjs` — auto-detect or `--input` snapshot interpretation

## State Definitions

| State | Meaning |
|---|---|
| `no_pr` | No open PR exists for the current work |
| `pr_draft` | PR exists but is in draft state |
| `pr_ready_no_feedback` | PR is ready-for-review; no Copilot review requested or received yet |
| `waiting_for_copilot_review` | Copilot is in `requested_reviewers`; waiting for review activity |
| `unresolved_feedback_present` | Unresolved review threads exist that require fix and/or reply/resolve |
| `already_fixed_needs_reply_resolve` | Agent has applied a fix; threads still need reply/resolve on GitHub before re-request |
| `ready_to_rerequest_review` | All threads resolved; Copilot has reviewed at least once; ready for next pass or done |
| `review_request_unavailable` | Copilot review request returned `unavailable`; must stop/report |
| `waiting_for_ci` | CI checks are in progress; wait before proceeding |
| `blocked_needs_user_decision` | Unexpected failure (CI failure, bad request result); requires user decision |
| `done` | PR has been merged or closed |

## Transition Graph

```
no_pr
  (no transitions — create a PR or hand work to Copilot)

pr_draft
  → pr_ready_no_feedback  (move PR from draft to ready)

pr_ready_no_feedback
  → waiting_for_copilot_review  (request Copilot review)

waiting_for_copilot_review
  → unresolved_feedback_present  (Copilot reviewed; unresolved threads exist)
  → ready_to_rerequest_review    (Copilot reviewed; all threads resolved)
  → waiting_for_ci               (CI checks are running)

unresolved_feedback_present
  → already_fixed_needs_reply_resolve  (agent applied fix; threads still open on GitHub)
  → unresolved_feedback_present        (iterative: address one thread at a time)

already_fixed_needs_reply_resolve
  → ready_to_rerequest_review     (all threads replied to and resolved)

ready_to_rerequest_review
  → waiting_for_copilot_review    (re-request another Copilot pass)
  → review_request_unavailable    (re-request failed with unavailable)
  → done                          (agent decides PR is complete)

review_request_unavailable
  (no transitions — stop and report; do not sleep or watch)

waiting_for_ci
  → pr_ready_no_feedback          (CI passed; no review yet)
  → ready_to_rerequest_review     (CI passed; Copilot has reviewed before)
  → blocked_needs_user_decision   (CI failed)

blocked_needs_user_decision
  (no transitions — stop and report; await explicit user authorization)

done
  (no transitions)
```

## Snapshot Schema

The snapshot is the set of observable facts that the interpreter uses to determine the current state.

| Field | Type | Description |
|---|---|---|
| `prExists` | `boolean` | Whether a PR was found |
| `prNumber` | `number \| null` | PR number if `prExists`, otherwise `null` |
| `prDraft` | `boolean` | Whether the PR is in draft state |
| `prMerged` | `boolean` | Whether the PR has been merged |
| `prClosed` | `boolean` | Whether the PR was closed without merge |
| `copilotReviewRequestStatus` | `"requested" \| "already-requested" \| "unavailable" \| "none" \| "failed"` | Result of the most recent Copilot review-request attempt |
| `copilotReviewPresent` | `boolean` | Whether at least one Copilot review exists on the PR |
| `unresolvedThreadCount` | `number` | Total unresolved review-thread count |
| `actionableThreadCount` | `number` | Unresolved threads with non-bot actionable comments |
| `ciStatus` | `"success" \| "failure" \| "pending" \| "none"` | Current CI check rollup |
| `agentFixStatus` | `"applied" \| null` | Agent-provided: `"applied"` when code has been fixed |

### Review request status values

| Value | Meaning |
|---|---|
| `requested` | `gh pr edit --add-reviewer @copilot` succeeded; Copilot is now in `requested_reviewers` |
| `already-requested` | Copilot was already in `requested_reviewers` before the request attempt |
| `unavailable` | GitHub rejected the request (Copilot review not enabled, not a collaborator, etc.) |
| `none` | No recent request attempt; status is unknown / not yet requested |
| `failed` | An unexpected `gh` failure occurred during the request attempt |

### Agent judgment boundary

The `agentFixStatus` field is the only explicit agent input to the state machine.

The machine detects all other fields from observable GitHub/git facts. Agent decisions that are **not** encoded in the snapshot (and remain in the agent layer):

- Whether a comment should be accepted, deferred, or disagreed with
- Whether the code is already fixed (→ sets `agentFixStatus: "applied"`)
- What the narrowest valid fix is
- Whether another Copilot pass is actually desired (→ triggers re-request or selects `done`)

## Interpretation Rules (ordered)

The interpreter applies rules in priority order. The first matching rule wins.

1. `prExists === false` → `no_pr`
2. `prMerged || prClosed` → `done`
3. `prDraft` → `pr_draft`
4. `copilotReviewRequestStatus === "unavailable"` → `review_request_unavailable`
5. `copilotReviewRequestStatus === "failed"` → `blocked_needs_user_decision`
6. `unresolvedThreadCount > 0 && agentFixStatus === "applied"` → `already_fixed_needs_reply_resolve`
7. `unresolvedThreadCount > 0` → `unresolved_feedback_present`
   *(Unresolved feedback always takes priority over any wait/watch path)*
8. `copilotReviewRequestStatus === "requested" || copilotReviewRequestStatus === "already-requested"` → `waiting_for_copilot_review`
9. `copilotReviewPresent && ciStatus === "pending"` → `waiting_for_ci`
10. `copilotReviewPresent && ciStatus === "failure"` → `blocked_needs_user_decision`
11. `copilotReviewPresent` → `ready_to_rerequest_review`
12. `ciStatus === "pending"` → `waiting_for_ci`
13. `ciStatus === "failure"` → `blocked_needs_user_decision`
14. Default → `pr_ready_no_feedback`

## Key Behavioral Guarantees

### Unresolved feedback always routes to fix/reply-resolve — never to wait

Rules 6 and 7 check `unresolvedThreadCount > 0` **before** checking review-request status (rule 8). Even if Copilot is currently in `requested_reviewers`, unresolved threads from a prior review take priority and route the loop into fix/reply-resolve work.

### `unavailable` and `failed` stop the loop immediately

Rules 4 and 5 check for terminal review-request failures before any other non-closed state. The loop never falls through to `waiting_for_copilot_review` or `waiting_for_ci` when the review request itself has failed.

### Incomplete review-thread detection blocks auto-detect

Auto-detect must fail closed when review-thread state cannot be captured or parsed. The detector must not synthesize `unresolvedThreadCount: 0` from a GitHub or parser failure, because that could hide unresolved feedback and produce an unsafe wait or re-request recommendation.

### Reply/resolve must precede re-request

`already_fixed_needs_reply_resolve` transitions only to `ready_to_rerequest_review`, not directly to `waiting_for_copilot_review`. The agent must explicitly resolve threads on GitHub (via `scripts/github/reply-resolve-review-thread.mjs`) before triggering the next Copilot pass.

## Related Scripts

| Script | Purpose |
|---|---|
| `scripts/loop/detect-copilot-loop-state.mjs` | Current-state detection and snapshot interpretation (this machine) |
| `scripts/github/request-copilot-review.mjs` | Request or detect Copilot review; its `status` output maps to `copilotReviewRequestStatus` |
| `scripts/github/watch-copilot-review.mjs` | Watch for fresh Copilot review activity (use in `waiting_for_copilot_review`) |
| `scripts/github/capture-review-threads.mjs` | Capture and normalize review threads; provides `unresolvedThreadCount` / `actionableThreadCount` |
| `scripts/github/reply-resolve-review-thread.mjs` | Reply to and resolve a single review thread (use in `already_fixed_needs_reply_resolve`) |

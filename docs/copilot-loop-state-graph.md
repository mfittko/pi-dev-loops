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
| `waiting_for_copilot_review` | Copilot is in `requested_reviewers` or has a pending review on the current head commit, and has not yet submitted a review on the current head; waiting for review activity |
| `unresolved_feedback_present` | Unresolved review threads exist that require fix and/or reply/resolve |
| `already_fixed_needs_reply_resolve` | Agent has applied a fix; threads still need reply/resolve on GitHub before re-request |
| `ready_to_rerequest_review` | All threads resolved; Copilot has reviewed at least once; only re-request once the updated head is green or credibly green |
| `review_request_unavailable` | Copilot review request returned `unavailable` and no observable in-progress review evidence exists; must stop/report |
| `waiting_for_ci` | CI checks are in progress or no usable CI readiness signal exists yet; wait before proceeding |
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
  → waiting_for_ci               (CI checks are running or have not materialized yet)

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
  (no transitions — stop and report; explicit request failed and no Copilot review is observably in progress)

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
| `copilotReviewRequestStatus` | `"requested" \| "already-requested" \| "unavailable" \| "none" \| "failed"` | Current known Copilot review-request state |
| `copilotReviewPresent` | `boolean` | Whether at least one Copilot review exists on the PR |
| `copilotReviewOnCurrentHead` | `boolean` | Whether a submitted (non-PENDING) Copilot review exists for the current head commit; when true the wait is done even if `requested_reviewers` has not yet cleared |
| `unresolvedThreadCount` | `number` | Total unresolved review-thread count |
| `actionableThreadCount` | `number` | Unresolved threads with non-bot actionable comments |
| `ciStatus` | `"success" \| "failure" \| "pending" \| "none"` | Current CI check rollup; `none` means no usable CI readiness signal yet and is not treated as green |
| `agentFixStatus` | `"applied" \| null` | Agent-provided: `"applied"` when code has been fixed |

### Review request status values

| Value | Meaning |
|---|---|
| `requested` | Copilot is currently in `requested_reviewers`, whether detected directly or immediately after a successful request; also set when a PENDING Copilot review for the current head commit is detected as observable in-progress evidence |
| `already-requested` | A caller with prior request-attempt context knows Copilot review was already observably in progress before or after that attempt (for example: `requested_reviewers`, a PENDING review for the current head commit, or post-failure verification after a rejected request) |
| `unavailable` | GitHub rejected the request (Copilot review not enabled, not a collaborator, etc.) **and** no observable in-progress review evidence was found |
| `none` | Copilot is not currently requested and there is no stronger request-attempt result to inject |
| `failed` | A prior request attempt failed unexpectedly |

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
   *(only reached when no in-progress evidence was found; the request helper returns `already-requested` instead when Copilot review is observably in progress before or after known unavailable/unrequestable failures, including the 422 collaborator case)*
5. `copilotReviewRequestStatus === "failed"` → `blocked_needs_user_decision`
6. `unresolvedThreadCount > 0 && agentFixStatus === "applied"` → `already_fixed_needs_reply_resolve`
7. `unresolvedThreadCount > 0` → `unresolved_feedback_present`
   *(Unresolved feedback always takes priority over any wait/watch path)*
8. `(copilotReviewRequestStatus === "requested" || copilotReviewRequestStatus === "already-requested") && !copilotReviewOnCurrentHead` → `waiting_for_copilot_review`
   *(Copilot is in `requested_reviewers` or a pending review is in progress, and has not yet submitted a review on the current head; when `copilotReviewOnCurrentHead === true` the wait is concluded and the loop falls through to rule 9+)*
9. `copilotReviewPresent && ciStatus === "failure"` → `blocked_needs_user_decision`
10. `copilotReviewPresent && (ciStatus === "pending" || ciStatus === "none")` → `waiting_for_ci`
11. `copilotReviewPresent` → `ready_to_rerequest_review`
12. `ciStatus === "failure"` → `blocked_needs_user_decision`
13. `ciStatus === "pending" || ciStatus === "none"` → `waiting_for_ci`
14. Default → `pr_ready_no_feedback`

When rule 11 yields `ready_to_rerequest_review`, the interpreter also emits two machine-readable flags:

- `autoRerequestEligible` — `true` only when a meaningful remediation event has occurred since the last Copilot review basis (deterministically: there is no submitted Copilot review on the current head).
- `sameHeadCleanConverged` — `true` when the current head already has a clean submitted Copilot review and no unresolved/actionable threads remain, so automatic same-head re-request must be suppressed.

## Key Behavioral Guarantees

### Unresolved feedback always routes to fix/reply-resolve — never to wait

Rules 6 and 7 check `unresolvedThreadCount > 0` **before** checking review-request status (rule 8). Even if Copilot is currently in `requested_reviewers`, unresolved threads from a prior review take priority and route the loop into fix/reply-resolve work.

### Fresh Copilot review on current head concludes the wait state

Rule 8 only routes to `waiting_for_copilot_review` when `copilotReviewOnCurrentHead === false`. When a submitted (non-PENDING) Copilot review is detected for the current head commit, that review is complete and the wait is over, even if `requested_reviewers` still lists Copilot (GitHub does not always clear this immediately after a review is submitted). The loop falls through to rule 9+ and reaches `ready_to_rerequest_review` or another appropriate next state.

### Automatic same-head re-request suppression after clean convergence

When the current head already has a submitted Copilot review, unresolved/actionable thread counts are 0, and CI is not in a blocked wait/failure state, automatic follow-up re-request is suppressed for that head (`sameHeadCleanConverged: true`, `autoRerequestEligible: false`). Automatic re-request becomes eligible again only after a meaningful remediation event changes the review basis (for this loop: a newer head without a submitted Copilot review on that head). Explicit operator/manual re-request remains allowed, but the direct request helper now suppresses same-head clean re-requests by default unless `--force-rerequest-review` is provided.

### `unavailable` stops the loop only when no in-progress evidence exists

Rule 4 routes to `review_request_unavailable` when the explicit request path returned `unavailable`. However, this only reaches the state machine when there is **no observable in-progress evidence**. The request helper (`request-copilot-review.mjs`) short-circuits to `already-requested` when Copilot review is already observably in progress before the mutation attempt, and it also performs post-failure verification after known unavailable/unrequestable failures (including the 422 collaborator error): if Copilot is found in `requested_reviewers` or has a PENDING review pinned to the current head commit, it returns `already-requested` instead of `unavailable`. The auto-detect path also treats a PENDING Copilot review on the current head as equivalent evidence to being in `requested_reviewers`, setting `copilotReviewRequestStatus = "requested"`.

The net effect: `unavailable` in the snapshot means the request path failed **and** Copilot is observably not in progress. The loop never drops to the approval gate when Copilot review is still in progress.

### `failed` and plain `unavailable` stop the loop immediately

Rules 4 and 5 check for terminal review-request failures before any other non-closed state. The loop never falls through to `waiting_for_copilot_review` or `waiting_for_ci` when the review request has definitively failed with no in-progress evidence.

### Incomplete review-thread detection blocks auto-detect

Auto-detect must fail closed when review-thread state cannot be captured or parsed. The detector must not synthesize `unresolvedThreadCount: 0` from a GitHub or parser failure, because that could hide unresolved feedback and produce an unsafe wait or re-request recommendation.

### Reply/resolve must precede re-request

`already_fixed_needs_reply_resolve` transitions only to `ready_to_rerequest_review`, not directly to `waiting_for_copilot_review`. The agent must explicitly resolve threads on GitHub (via `scripts/github/reply-resolve-review-thread.mjs`) before triggering the next Copilot pass.

### Green validation precondition before follow-up re-request

Re-requesting Copilot after a follow-up fix is gated on the updated head being green or credibly green. In practice: run the smallest honest local validation for the accepted fix scope, continue remediation if that validation is still known red, continue remediation if CI/checks for the current head are known red for a fixable issue, and do not treat `ciStatus: "none"` as equivalent to green.

## Related Scripts

| Script | Purpose |
|---|---|
| `scripts/loop/detect-copilot-loop-state.mjs` | Current-state detection and snapshot interpretation (this machine) |
| `scripts/github/request-copilot-review.mjs` | Request or detect Copilot review; its `status` output maps to `copilotReviewRequestStatus` |
| `scripts/github/watch-copilot-review.mjs` | Watch for fresh Copilot review activity (use in `waiting_for_copilot_review`) |
| `scripts/github/capture-review-threads.mjs` | Capture and normalize review threads; provides `unresolvedThreadCount` / `actionableThreadCount` |
| `scripts/github/reply-resolve-review-thread.mjs` | Reply to and resolve a single review thread (use in `already_fixed_needs_reply_resolve`) |

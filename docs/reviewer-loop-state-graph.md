# Reviewer Loop State Graph

This document defines the deterministic reviewer-side PR loop state machine.

## Overview

The reviewer loop captures observable PR/GitHub facts plus explicit local reviewer-loop metadata (planning/run/merge status) into one snapshot and deterministically maps that snapshot to exactly one current state.

Implementation:

- Pure logic: `packages/core/src/loop/reviewer-loop-state.mjs`
- Detector CLI: `scripts/loop/detect-reviewer-loop-state.mjs`
- Draft-review staging helper: `scripts/github/stage-reviewer-draft.mjs`

## State Definitions

| State | Meaning |
|---|---|
| `waiting_for_review_request` | No active reviewer loop for this PR/head |
| `review_requested` | Review has been requested for the active reviewer |
| `determine_review_plan` | Review angles are being selected |
| `reviews_running` | Bounded local review passes are running |
| `merge_results` | Local review runs completed; merged synthesis pending |
| `draft_review_ready` | Merged review package is ready to stage |
| `draft_review_posted` | Pending GitHub review exists for current head but link not yet surfaced |
| `waiting_for_user_submit` | Pending review link is surfaced; wait for submission |
| `submitted_review` | Review was submitted (Pi or GitHub) |
| `waiting_for_author_followup` | Submitted review exists; waiting for author fixes or PR close |
| `waiting_for_re_request` | Author pushed new commits after submission; waiting for explicit re-request |
| `review_invalidated` | Pending draft review is stale for current head SHA |
| `blocked_needs_user_decision` | Failure state requiring explicit user decision |

## Snapshot Contract

`normalizeReviewerSnapshot` canonicalizes this schema:

- PR/observable: `prExists`, `prNumber`, `prDraft`, `prMerged`, `prClosed`, `prHeadSha`, `reviewRequested`
- local planning/run/merge status: `localPlanningStatus`, `localReviewRunsStatus`, `localMergeStatus`, `draftReviewPrepared`
- staged draft review state: `draftReviewPosted`, `draftReviewId`, `draftReviewUrl`, `draftReviewCommitSha`, `draftReviewNotificationStatus`
- submitted review state: `submittedReviewPresent`, `submittedReviewCommitSha`
- explicit prior action-result state: `reviewSubmissionStatus`

The contract separates observable current state (`submittedReviewPresent`, `draftReviewPosted`, `reviewRequested`) from prior action-result state (`reviewSubmissionStatus`) to avoid overloading one field.

## Deterministic Review Plan Contract

`selectReviewerPlan` produces bounded parallel review plans:

- supported angles: `correctness`, `tests`, `maintainability`, `security`, `scope`
- max fan-out is capped to 4
- default fan-out is 3
- output is deterministic (`runId` sequence + angle ordering)

For `pi-dev-loops`, the default pre-approval gate before calling a branch/PR review-complete, approval-ready, merge-ready, or ready for final handoff is three focused lenses: `DRY`, `KISS`, and `YAGNI`. These are workflow lenses for how reviewer runs must cover the change; they do not replace the state machine's supported review-angle taxonomy (`correctness`, `tests`, `maintainability`, `security`, `scope`). Instead, map the DRY/KISS/YAGNI passes onto that existing taxonomy when planning or merging reviewer runs so the workflow gate stays aligned with the deterministic review-plan contract. Run those lens passes in fresh context and in parallel when practical. If true parallelism is impractical, all three lenses still require coverage and the limitation must be explicitly recorded in the merged review artifact/verdict.

## Deterministic Merge/Synthesis Contract

`mergeReviewerResults` merges parallel review run outputs into one bounded machine-readable package:

- deduplicates findings by `path|line|message`
- classifies findings into `inlineComments` vs `summaryFindings`
- emits one deterministic verdict: `APPROVE`, `COMMENT`, or `REQUEST_CHANGES`
- preserves `headSha`, `runsMerged`, and `totalFindings`

`buildDraftReviewPayload` converts a merged review package into a deterministic pending-review payload:

- pins the pending review to `headSha`
- renders one deterministic summary body including verdict, totals, and summary findings
- emits only bounded inline comments with `path`, `line`, `body`, and `side: "RIGHT"`
- keeps draft-review creation separate from final review submission

## Detector CLI Contract

`node scripts/loop/detect-reviewer-loop-state.mjs` supports:

- `--input <path>` (snapshot interpretation only)
- `--repo <owner/name> --pr <number>` (auto-detect)
- optional: `--reviewer-login <login>`
- optional: `--review-requested <true|false>` (inject known request result)
- optional: `--local-state <path>` (inject local planning/run/merge metadata)

Success output:

- `{ "ok": true, "snapshot": { ... }, "state": "...", "allowedTransitions": [...], "nextAction": "..." }`

Failure output:

- `{ "ok": false, "error": "..." }` on stderr with non-zero exit

## Key Deterministic Guarantees

- planning/running/merge-ready states are explicitly represented
- draft-ready vs draft-posted vs waiting-for-submit vs submitted are distinct
- pending draft reviews are invalidated when `draftReviewCommitSha !== prHeadSha`
- waiting-for-author-followup vs waiting-for-re-request is determined from submitted review commit vs current head
- unexpected failures fail closed into `blocked_needs_user_decision`

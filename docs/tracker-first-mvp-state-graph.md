# Tracker-First MVP State + Artifact Graph

This document defines the tracker-first MVP workflow-family contract for:

```text
story -> draft PR -> reviewable PR -> merged PR -> tracker sync
```

This scope is intentionally bounded to the MVP family under issue `#17`, complements `#21`, and stays narrower than the broader umbrella model in `#19`.

## Inherited authority boundary from `#21`

This document is **not** the source of truth for tracker ownership, PR projection, or reverse-sync semantics. It inherits those rules from `#21` and applies them to a narrower workflow-family state machine.

Inherited from `#21` and **not** redefined here:

- the **one-work-item -> one-PR invariant**
- **source-of-truth ownership**:
  - tracker owns work-item identity, planning hierarchy, and tracker-native workflow state
  - GitHub owns PR lifecycle, review, CI, and merge facts
  - `pi-dev-loops` owns projection + sync logic only
- the required durable **work item <-> PR link**
- the canonical **reverse-sync semantics** that map draft/open, reviewable, merged, and closed-without-merge PR outcomes back to tracker-native state

This document adds only:

- mutually exclusive workflow-family states around the ready-for-review -> review/fix -> merge path
- bounded post-merge `tracker_sync` / `done` detection for whether the inherited `#21` reverse-sync effect has been observed and verified
- artifact/recovery expectations for this MVP slice

`tracker_sync` in this document is therefore a **verification phase**, not a new source of truth. The authoritative post-merge facts remain the merged PR facts in GitHub plus the tracker-native state/link facts defined by `#21`.

## Observable facts used for detection

The current state must be derived from durable observable facts, not intent or guesswork. The minimal fact set for this MVP family is:

- `trackerItemExists`
- `workItemPrLinkPresent`
- `prExists`
- `prDraft`
- `prMerged`
- `prClosedUnmerged`
- `reviewRequested`
- `reviewActivityPresent`
  - at least one submitted review and/or review thread exists
- `actionableReviewFeedbackPresent`
  - at least one unresolved review thread, unresolved change request, or equivalent review blocker exists
- `fixCommitPushedAfterLatestFeedback`
  - the PR head SHA is newer than the latest actionable review feedback currently being addressed
- `requiredCiPending`
- `trackerReflectsMergedOutcome`
  - the tracker already reflects the inherited `#21` merged/done reverse-sync effect
- `trackerSyncInProgress`
  - a sync attempt is explicitly underway and has not yet been verified
- `trackerSyncVerificationFailed`
  - a sync attempt failed, or merged-PR facts and tracker facts still contradict the inherited `#21` terminal expectation

If observable facts are contradictory or insufficient to decide safely, stop at `blocked_needs_user_decision` instead of guessing.

## Workflow-family state machine

### State definitions

1. `selected_ready`
   - A tracker work item (story/task/bug) is selected and ready.
   - Required execution target: one PR for this one work item (per `#21`).
   - Detect when: `trackerItemExists && !prExists`.
2. `draft_pr`
   - PR exists and is draft.
   - Detect when: `prExists && prDraft && !prMerged && !prClosedUnmerged`.
3. `reviewable_pr`
   - PR exists, is ready-for-review, and has **not** yet entered a waiting/review/fix substate.
   - Detect when: `prExists && !prDraft && !prMerged && !prClosedUnmerged && !reviewRequested && !reviewActivityPresent && !actionableReviewFeedbackPresent && !requiredCiPending`.
4. `waiting_for_review`
   - Review has been requested, but no submitted review/threads exist yet and CI is not the active blocker.
   - Detect when: `prExists && !prDraft && !prMerged && !prClosedUnmerged && reviewRequested && !reviewActivityPresent && !actionableReviewFeedbackPresent && !requiredCiPending`.
5. `under_review`
   - Review activity or actionable review feedback is the active state.
   - Detect when: `prExists && !prDraft && !prMerged && !prClosedUnmerged && (actionableReviewFeedbackPresent || reviewActivityPresent) && !fixCommitPushedAfterLatestFeedback`.
   - `under_review` wins over `waiting_for_ci` whenever review feedback is still active.
6. `fixes_in_progress`
   - A follow-up fix commit has been pushed after the latest actionable feedback, but that feedback has not yet been replied/resolved or superseded by a fresh clean review.
   - Detect when: `prExists && !prDraft && !prMerged && !prClosedUnmerged && actionableReviewFeedbackPresent && fixCommitPushedAfterLatestFeedback`.
7. `waiting_for_ci`
   - Required CI checks are the only active blocker.
   - Detect when: `prExists && !prDraft && !prMerged && !prClosedUnmerged && requiredCiPending && !actionableReviewFeedbackPresent && !fixCommitPushedAfterLatestFeedback`.
   - `waiting_for_ci` does **not** overlap with `under_review`; if review feedback is active, the state is `under_review` or `fixes_in_progress` instead.
8. `merged`
   - PR merged, but post-merge tracker verification has not started yet.
   - Detect when: `prMerged && !trackerReflectsMergedOutcome && !trackerSyncInProgress && !trackerSyncVerificationFailed`.
9. `tracker_sync`
   - The merged PR exists and the inherited `#21` reverse-sync effect is being applied or verified against tracker facts.
   - Detect when: `prMerged && !trackerReflectsMergedOutcome && trackerSyncInProgress && !trackerSyncVerificationFailed`.
10. `done`
   - Tracker reflects the merged outcome and the inherited required work item <-> PR link remains present.
   - Detect when: `prMerged && trackerReflectsMergedOutcome && workItemPrLinkPresent`.
11. `blocked_missing_artifact`
   - A required durable artifact for the otherwise-highest valid state is missing.
   - Detect when: `!trackerItemExists` or `prExists && !workItemPrLinkPresent`.
   - Typical cases:
     - the tracker work item / planning root for this workflow-family run is missing
     - PR exists but the inherited required work item <-> PR link is missing
12. `blocked_sync_failed`
   - Tracker sync failed or verification contradicts the inherited `#21` merged/done expectation.
   - Detect when: `prMerged && trackerSyncVerificationFailed`.
13. `blocked_needs_user_decision`
   - Contradictory facts, out-of-scope requests, policy conflict, closed-without-merge outcomes that require a human decision, or otherwise unclear intent.
   - Detect when: `prClosedUnmerged`, contradictory facts, or the workflow falls outside this MVP family's bounded automatic path.

### Terminal states

- `done`
- `blocked_needs_user_decision`

### Deterministic detection priority

Evaluate states in this order so the machine always returns exactly one state:

1. contradictory or out-of-scope facts -> `blocked_needs_user_decision`
2. tracker work item missing -> `blocked_missing_artifact`
3. PR closed without merge -> `blocked_needs_user_decision`
4. merged PR + failed sync verification -> `blocked_sync_failed`
5. merged PR + tracker reflects merged outcome + required work item <-> PR link present -> `done`
6. required durable work item <-> PR link missing while a PR exists -> `blocked_missing_artifact`
7. merged PR + sync explicitly underway -> `tracker_sync`
8. merged PR with sync still pending but not yet started -> `merged`
9. actionable review feedback + newer fix commit pushed -> `fixes_in_progress`
10. actionable review feedback or submitted review activity -> `under_review`
11. required CI pending with no active review-feedback blocker -> `waiting_for_ci`
12. review requested, but no submitted review activity yet -> `waiting_for_review`
13. ready-for-review PR with no waiting/review/fix signals yet -> `reviewable_pr`
14. draft PR exists -> `draft_pr`
15. tracker item selected and no PR exists -> `selected_ready`

This priority order removes overlap between states such as:

- `reviewable_pr` vs `waiting_for_review`
  - `reviewable_pr` requires **no** review request yet.
  - `waiting_for_review` requires `reviewRequested`.
- `under_review` vs `waiting_for_ci`
  - `waiting_for_ci` applies only when CI is the **only** active blocker.
  - active review feedback always routes to `under_review` or `fixes_in_progress` first.

### Allowed transitions

- `selected_ready -> draft_pr`
- `draft_pr -> reviewable_pr`
- `reviewable_pr -> waiting_for_review | waiting_for_ci | under_review | merged`
- `waiting_for_review -> waiting_for_ci | under_review | merged`
- `under_review -> fixes_in_progress | waiting_for_ci | merged`
- `fixes_in_progress -> waiting_for_review | waiting_for_ci | under_review | merged`
- `waiting_for_ci -> waiting_for_review | under_review | merged`
- `merged -> tracker_sync | done`
- `tracker_sync -> done`

### Recovery edges

- `blocked_missing_artifact -> selected_ready | draft_pr | reviewable_pr | merged`
  - Reconstruct from permanent artifacts and return to the highest valid state.
- `blocked_sync_failed -> tracker_sync`
  - Retry sync after reconciling merged-PR facts with tracker facts already owned by `#21`.
- `blocked_needs_user_decision -> selected_ready | reviewable_pr | tracker_sync`
  - Resume only after explicit user decision.
- `under_review -> reviewable_pr`
  - If all review activity is cleared without new fix commits and no waiting state remains.

## Artifact graph

### Permanent planning artifacts

- tracker work item (`story`/`task`/`bug`) — canonical planning root
- optional epic reference
- optional PRD reference
- optional ADR/RFC reference

### Permanent execution artifacts

- PR (single PR for the work item in MVP)
- required work item <-> PR link inherited from `#21`
- review threads / submitted review metadata
- CI checks
- merge result (merge commit / merged PR metadata)
- tracker-native post-merge state visible through the adapter

### Temporary local artifacts (refinement/recovery only)

- local refinement notes, snapshots, and handoff drafts under `tmp/`
- temporary reconciliation notes used to recover when remote facts conflict
- optional local sync logs or audit notes used to explain why verification failed

Temporary artifacts are never required to establish final truth once permanent artifacts are present.

### Canonical vs derived vs temporary

- **Canonical**
  - tracker work item identity/state (per `#21`)
  - GitHub PR/review/CI/merge facts (per `#21`)
  - required work item <-> PR link (per `#21`)
- **Derived**
  - current workflow state interpretation from observable artifacts
  - transition advice (`allowedTransitions`, next valid actions)
  - missing-artifact diagnostics
  - whether the inherited `#21` reverse-sync effect is still pending, verified, or failed
- **Temporary**
  - local `tmp/` artifacts used for bounded refinement/recovery only

### Link model

Inherited required durable link from `#21`:

- work item <-> PR

Optional reference links in this MVP slice:

- work item -> epic/PRD/ADR/RFC

Execution links/facts derived around the PR:

- PR -> review threads / submitted reviews
- PR -> CI checks
- PR -> merge result
- merged PR + work item <-> PR link + tracker-native state -> tracker sync verification outcome

### Deterministic detection implications

Implementations should be able to:

1. Detect one current state from durable observable facts.
2. Explain valid next transitions from that state.
3. Report missing required artifacts for the state.
4. Distinguish waiting-for-review, active review, fixes-in-progress, and waiting-for-CI without overlap.
5. Reconstruct `done` using only merged-PR facts plus the inherited `#21` tracker/link facts when temporary local artifacts are absent.

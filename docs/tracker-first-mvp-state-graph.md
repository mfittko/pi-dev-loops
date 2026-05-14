# Tracker-First MVP State + Artifact Graph

This document defines the tracker-first MVP workflow-family contract for:

```text
story -> draft PR -> reviewable PR -> merged PR -> tracker sync
```

This scope is intentionally bounded to the MVP family under issue `#17`, complements `#21`, and stays narrower than the broader umbrella model in `#19`.

## Workflow-family state machine

### Normal path states

1. `selected_ready`
   - A tracker work item (story/task/bug) is selected and ready.
   - Required execution target: one PR for this one work item (per `#21`).
2. `draft_pr`
   - PR exists and is draft.
3. `reviewable_pr`
   - PR exists and is ready-for-review.
4. `under_review`
   - Feedback is pending (review threads and/or CI checks still unresolved).
5. `fixes_in_progress`
   - Follow-up commits are being prepared/pushed for current review feedback.
6. `merged`
   - PR merged.
7. `tracker_sync`
   - Tracker update is being applied/verified from merged PR outcome.
8. `done`
   - Tracker reflects merged outcome and required links are present.

### Waiting/blocker/stop states

- `waiting_for_review`
  - Review requested, no actionable feedback yet.
- `waiting_for_ci`
  - CI checks still running/pending.
- `blocked_missing_artifact`
  - Required artifact for current state is missing (for example PR missing for selected work item, or missing merge evidence before sync).
- `blocked_sync_failed`
  - Tracker sync attempt failed or produced inconsistent result.
- `stopped_needs_user_decision`
  - Contradictory facts, out-of-scope requests, policy conflict, or unclear intent.

### Terminal states

- `done`
- `stopped_needs_user_decision`

### Allowed transitions

- `selected_ready -> draft_pr`
- `draft_pr -> reviewable_pr`
- `reviewable_pr -> waiting_for_review`
- `waiting_for_review -> under_review`
- `under_review -> fixes_in_progress`
- `fixes_in_progress -> reviewable_pr`
- `under_review -> waiting_for_ci`
- `waiting_for_ci -> under_review`
- `reviewable_pr -> merged`
- `under_review -> merged`
- `merged -> tracker_sync`
- `tracker_sync -> done`

### Recovery edges

- `blocked_missing_artifact -> selected_ready | draft_pr | reviewable_pr | merged`
  - Reconstruct from permanent artifacts and return to the highest valid state.
- `blocked_sync_failed -> tracker_sync`
  - Retry sync after reconciling merge/tracker facts.
- `stopped_needs_user_decision -> selected_ready | reviewable_pr | tracker_sync`
  - Resume only after explicit user decision.
- `under_review -> reviewable_pr`
  - If all feedback is resolved without new fix commits.

## Artifact graph

## Permanent planning artifacts

- tracker work item (`story`/`task`/`bug`) — canonical planning root
- optional epic reference
- optional PRD reference
- optional ADR/RFC reference

## Permanent execution artifacts

- PR (single PR for the work item in MVP)
- review threads
- CI checks
- merge result (merge commit / merged PR metadata)
- tracker sync outcome (status + timestamp + synced fields)

## Temporary local artifacts (refinement/recovery only)

- local refinement notes, snapshots, and handoff drafts under `tmp/`
- temporary reconciliation notes used to recover when remote facts conflict

Temporary artifacts are never required to establish final truth once permanent artifacts are present.

## Canonical vs derived vs temporary

- **Canonical**
  - tracker work item state
  - merged PR outcome
  - tracker sync outcome for this workflow family
- **Derived**
  - current workflow state interpretation from observable artifacts
  - transition advice (`allowedTransitions`, next valid actions)
  - missing-artifact diagnostics
- **Temporary**
  - local `tmp/` artifacts used for bounded refinement/recovery only

## Link model

- work item -> (optional) epic/PRD/ADR
- work item -> PR
- PR -> review threads
- PR -> CI checks
- PR -> merge result
- merge result -> tracker sync outcome
- tracker sync outcome -> work item state update/annotation

## Deterministic detection implications

Implementations should be able to:

1. Detect one current state from durable observable facts.
2. Explain valid next transitions from that state.
3. Report missing required artifacts for the state.
4. Distinguish normal waiting (`waiting_for_review`, `waiting_for_ci`) from blockers/stops.
5. Recover in degraded mode using only permanent artifacts when temporary local artifacts are absent.

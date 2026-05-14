# Tracker-First MVP State + Artifact Graph

This document defines the tracker-first MVP workflow-family contract for:

```text
story -> draft PR -> reviewable PR -> merged PR -> tracker sync
```

This scope is intentionally bounded to the MVP family under issue `#17`, complements `#21`, and stays narrower than the broader umbrella model in `#19`.

## Authority boundary (normative)

### Inherited from `#21` (not redefined here)

- one work-item -> one PR invariant
- source-of-truth and deterministic PR-projection rules
- reverse-sync semantics and tracker-link meaning

### Defined in this document

- tracker-first MVP workflow-family states for this bounded path
- mutually exclusive state-detection predicates and ordered interpretation rules
- blocker/wait/stop states, transitions, and recovery edges
- artifact-role classification for state detection (canonical vs derived vs temporary)

If any statement in this file appears to conflict with `#21` for source-of-truth or reverse-sync behavior, `#21` is authoritative.

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

### Snapshot schema (observable facts)

The interpreter should use only observable durable facts plus bounded local recovery metadata:

| Field | Type | Description |
|---|---|---|
| `workItemReady` | `boolean` | Tracker work item is selected/ready for execution |
| `prExists` | `boolean` | PR exists for the work item |
| `prDraft` | `boolean` | PR is currently draft |
| `prReviewRequested` | `boolean` | A review request is currently outstanding |
| `actionableFeedbackPresent` | `boolean` | Unresolved review feedback requires follow-up |
| `localFixInProgress` | `boolean` | Optional local marker that fixes are currently being prepared |
| `ciStatus` | `"none" \| "pending" \| "passing" \| "failing"` | Aggregate CI status for the current head |
| `prMerged` | `boolean` | PR is merged |
| `trackerSyncStatus` | `"none" \| "pending" \| "succeeded" \| "failed"` | Sync attempt status for merged outcome |
| `requiredSyncLinksPresent` | `boolean` | Required tracker/PR linkage evidence exists (as defined by `#21`) |
| `factsConflict` | `boolean` | Contradictory or non-reconcilable observed facts |
| `requiredArtifactMissing` | `boolean` | Required artifact for current phase is missing |

### Ordered interpretation rules (first match wins)

Rules are evaluated top-to-bottom. The first satisfied rule selects the **one current state**.

1. `factsConflict === true` -> `stopped_needs_user_decision`
2. `requiredArtifactMissing === true` -> `blocked_missing_artifact`
3. `prMerged && trackerSyncStatus === "failed"` -> `blocked_sync_failed`
4. `prMerged && trackerSyncStatus === "succeeded" && requiredSyncLinksPresent` -> `done`
5. `prMerged && trackerSyncStatus === "pending"` -> `tracker_sync`
6. `prMerged && trackerSyncStatus === "none"` -> `merged`
7. `prExists && prDraft && !prMerged` -> `draft_pr`
8. `actionableFeedbackPresent && localFixInProgress && !prMerged` -> `fixes_in_progress`
9. `actionableFeedbackPresent && !prMerged` -> `under_review`
10. `prExists && !prDraft && !prMerged && !actionableFeedbackPresent && ciStatus === "pending"` -> `waiting_for_ci`
11. `prExists && !prDraft && !prMerged && !actionableFeedbackPresent && ciStatus !== "pending" && prReviewRequested` -> `waiting_for_review`
12. `prExists && !prDraft && !prMerged && !actionableFeedbackPresent && ciStatus !== "pending" && !prReviewRequested` -> `reviewable_pr`
13. `workItemReady && !prExists` -> `selected_ready`
14. otherwise -> `stopped_needs_user_decision`

In degraded recovery when `localFixInProgress` is unavailable, rule 8 cannot match and the interpreter falls back to `under_review` via rule 9.

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

### Permanent planning artifacts

- tracker work item (`story`/`task`/`bug`) — canonical planning root
- optional epic reference
- optional PRD reference
- optional ADR/RFC reference

### Permanent execution artifacts

- PR (single PR for the work item in MVP)
- review threads
- CI checks
- merge result (merge commit / merged PR metadata)
- tracker sync outcome evidence (status + timestamp + references required by `#21`)

### Temporary local artifacts (refinement/recovery only)

- local refinement notes, snapshots, and handoff drafts under `tmp/`
- temporary reconciliation notes used to recover when remote facts conflict

Temporary artifacts are never required to establish final truth once permanent artifacts are present.

### Canonical vs derived vs temporary

- **Canonical**
  - tracker work item state/links (authority inherited from `#21`)
  - PR and merge outcome
- **Derived**
  - current workflow state interpretation from observable artifacts
  - transition advice (`allowedTransitions`, next valid actions)
  - missing-artifact diagnostics
  - sync-readiness checks derived from merged outcome + required link evidence
- **Temporary**
  - local `tmp/` artifacts used for bounded refinement/recovery only

### Link model

- work item -> (optional) epic/PRD/ADR/RFC
- work item -> PR
- PR -> review threads
- PR -> CI checks
- PR -> merge result
- merge result -> tracker sync outcome
- tracker sync outcome -> work item state update/annotation

### Deterministic detection implications

Implementations should be able to:

1. Detect one current state from durable observable facts.
2. Explain valid next transitions from that state.
3. Report missing required artifacts for the state.
4. Distinguish normal waiting (`waiting_for_review`, `waiting_for_ci`) from blockers/stops.
5. Recover in degraded mode using only permanent artifacts when temporary local artifacts are absent.

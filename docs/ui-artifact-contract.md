# UI screenshot/state artifact contract and CI promotion rules

This document defines the bounded screenshot/state artifact contract introduced for issue #125 under umbrella issue #97.

## Public entrypoint and scope boundary

- `dev-loop` remains the single public entrypoint for UI validation work.
- This contract documents the internal artifact shape behind `dev-loop`; it does not introduce a second public workflow name.
- The contract is intentionally small and reusable for opted-in UI slices that use the local Playwright/WebKit smoke harness from [UI Smoke Harness](ui-smoke-harness.md).

## What a named UI state means here

A **named UI state** is one small explicit render or interaction state that:
- is directly tied to a slice acceptance criterion, review question, or risk boundary
- can be reproduced deterministically from a fixture-backed local smoke run
- has a stable human-readable state name and a deterministic path slug
- is narrow enough that reviewers can understand what they are looking at without replaying the whole feature manually

Examples from the current inspect-run viewer proving path:
- `Current PR dashboard`
- `Checkpoint only graph uncertainty`
- `Terminal merged state`

## Artifact levels

This contract distinguishes three bounded artifact levels.

### 1. Manual review artifacts

These are screenshots or demo captures created for human discussion only.

- screenshot alone is acceptable here
- they may live outside the reusable harness path
- they are not deterministic smoke-validation evidence
- they do not imply CI enforcement

### 2. Deterministic smoke-validation artifacts

These are the reusable harness artifacts emitted for named UI states.

For this level, a paired state artifact is required:
- `screenshot.png`
- `state.json`

Why both are required:
- the screenshot shows what rendered
- `state.json` explains which named state it is, which slice produced it, and the minimum metadata needed for review or follow-up automation

### 3. CI-promoted required artifacts

These use the same deterministic artifact shape as smoke-validation artifacts, but the slice is now required to produce them in CI for the relevant PR/branch changes.

If a slice is CI-promoted and the expected artifacts are missing or malformed, validation must fail closed.

## Deterministic path contract

For a slice id of `<sliceId>` and a state slug of `<state-slug>`, the harness path is:

- state directory: `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/`
- screenshot artifact: `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/screenshot.png`
- structured state artifact: `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/state.json`
- HTML report root: `playwright-report/ui-smoke/<sliceId>/`

The harness currently normalizes:
- `sliceId` into a stable path segment
- the human-readable state name into `<state-slug>`

## Minimum `state.json` contract

The current reusable harness emits `state.json` with this minimum reviewer-facing metadata:
- `schemaVersion`
- `artifactType`
- `validationLevel`
- `sliceId`
- `stateName`
- `stateSlug`
- `runId`
- `capturedAt`
- `projectName`
- `testTitle`
- `testFile`
- `artifacts.screenshot.fileName`
- `artifacts.screenshot.relativePath`
- `artifacts.state.fileName`
- `artifacts.state.relativePath`
- `metadata.fixture`
- `metadata.route`
- `metadata.reviewHint`

This is intentionally minimal. The contract is not trying to describe every possible UI surface; it is only making the current reusable review inputs explicit.

## When screenshot alone is acceptable

Screenshot alone is acceptable only when the artifact is:
- a manual review artifact
- a one-off discussion aid
- not being presented as deterministic smoke-validation evidence
- not being required by a CI-promoted slice

## When the paired state artifact is required

The `screenshot.png` + `state.json` pair is required when:
- the artifact is part of the reusable deterministic smoke harness
- the slice is handing named UI states to a later reviewer loop
- the artifact needs to map back to a deterministic local run without guesswork
- the slice has been promoted into CI-required UI validation

## CI promotion rules

A UI slice may remain local-only when all of the following are true. In other words, local-only validation is still acceptable when:
- the slice is still proving the first honest local smoke path
- the UI surface is new, exploratory, or not yet stable enough for durable CI expectations
- the artifacts are useful for local review but not yet required to protect an established regression boundary

CI promotion is warranted when one or more of the following become true:
- the UI state is directly part of the slice acceptance criteria for a user-facing surface
- the local harness path is already deterministic and cheap enough to run in CI
- reviewers repeatedly depend on the named-state artifacts to approve the slice
- a regression-prone UI surface has a stable fixture-backed smoke path
- the repo already has a bounded changed-files gate that can keep CI promotion narrow

In this repository, the current proving example is the conditional `viewer-smoke` job in `.github/workflows/ci.yml`, which promotes the inspect-run viewer smoke suite only when the bounded viewer surface or its smoke-path dependencies change.

## Failure policy for CI-promoted slices

When a slice is CI-promoted:
- missing or malformed `state.json` is a validation failure
- missing `screenshot.png` is a validation failure
- mismatched state naming/path conventions are a validation failure
- the PR should fail closed rather than silently downgrade to screenshot-only review

## Relationship to the local harness and later reviewer loop

- [UI Smoke Harness](ui-smoke-harness.md) defines how the local harness captures these artifacts
- this document defines the reusable artifact contract and when CI should start requiring it
- later review-loop work should consume this artifact bundle rather than redefine the artifact shape from scratch
- the current designer-review-loop consumer contract lives in [UI Designer Review Loop](ui-designer-review-loop.md)

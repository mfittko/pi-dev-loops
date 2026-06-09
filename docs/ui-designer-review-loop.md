# Designer + vision review loop for UI slices

This document defines the bounded designer-persona review loop.

## Public entrypoint and dependency boundary

- `dev-loop` remains the single public entrypoint.
- This review loop is an internal capability behind `dev-loop`; it does not introduce a second public workflow name.
- The loop depends on the reusable harness from [UI Smoke Harness](./ui-smoke-harness.md) and the artifact contract from [UI Artifact Contract](./ui-artifact-contract.md).
- The loop is a **consumer** of those earlier slices. It does not redefine browser capture, artifact naming, or CI promotion policy.

## Purpose

The designer-persona review loop turns deterministic UI artifacts into a repeatable next-iteration handoff.

This contract now also defines an opt-in **vision-model** review mode behind the same `dev-loop` boundary for UI slices that request `uiReviewMode: vision`.

It exists for UI-heavy work where code correctness and smoke-test success are necessary but not sufficient to answer:
- what visual or interaction problems remain
- which named UI states still miss the intended bar
- what the next UI-fix iteration should focus on
- when the design-review side is satisfied enough to stop iterating

## Required input bundle

The loop requires all of the following inputs before it may run:

1. **Acceptance criteria**
   - the slice-level UI acceptance criteria the review is judging
2. **Short review brief**
   - one bounded note describing what the designer-persona should pay extra attention to
3. **Deterministic artifact bundle** from the reusable harness/artifact path
   - `sliceId`
   - optional report root such as `playwright-report/ui-smoke/<sliceId>/index.html`
   - one or more named states under `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/`
   - for each named state:
     - `stateName`
     - `screenshotPath`
     - `statePath`

If any required part of this bundle is missing, incomplete, or ambiguous, the loop fails closed instead of guessing.

## Review modes behind `dev-loop`

Two bounded reviewer modes are supported for opted-in UI slices:

- `designer` (default): prompt-driven designer-persona review against the same artifact bundle.
- `vision`: screenshot-first review using the reusable prompt template at `skills/dev-loop/templates/ui-vision-review.md`.

Both modes must return the same structured outcome set and follow the same fail-closed input contract.

## Required output bundle

Every review pass (designer or vision) must produce a bounded structured result. The canonical output format (outcome enum, severity enum, JSON schema, finding shape) is defined in [UI Vision Review Template](../skills/dev-loop/templates/ui-vision-review.md).

This loop adds one designer-specific field beyond the canonical schema:
- **Corrective actions**: what should be changed next in the fix iteration

## Outcome semantics

The canonical outcome enum is defined in [UI Vision Review Template](../skills/dev-loop/templates/ui-vision-review.md). The loop's behavior per outcome:

### `continue_ui_fix_loop`

The handoff goes back to the fixer/developer with findings, corrective actions, next-iteration focus areas, and the same acceptance criteria and artifact contract for the next pass.

### `ui_review_satisfied`

The named states in scope satisfy the review brief and acceptance criteria closely enough to stop iterating on the UI/design side. This does **not** replace normal engineering validation; it only means the designer-persona review loop is satisfied.

### `blocked_needs_human_decision`

The loop found a genuine design/product decision that cannot be resolved by another normal UI-fix iteration alone — conflicting acceptance cues, a tradeoff requiring a product/design decision, or artifacts exposing a scope contradiction.

## Fail-closed behavior

The loop fails closed when:
- required acceptance criteria are missing
- the review brief is missing or empty
- the artifact bundle is missing
- the artifact bundle has no named states
- a named state lacks `screenshotPath` or `statePath`
- vision mode is requested but a named state screenshot path does not end with `screenshot.png`
- vision mode is requested but a named-state `statePath` does not end with `state.json`
- the work is not actually a UI slice \(the loop returns a skip outcome rather than failing closed\)
- an unsupported `uiReviewMode` value (anything other than `designer` or `vision`) fails closed with `blocked_unsupported_review_mode`

When the work is non-UI, the loop does not trigger for non-UI work; it returns a skip outcome instead of pretending to review unrelated artifacts.

## Handoff sequence under `dev-loop`

1. Run or reuse the deterministic local UI smoke path.
2. Collect the named-state artifact bundle from `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/` and the optional HTML report.
3. Route by review mode:
   - `designer` → run designer-persona review
   - `vision` → run the vision review template at `skills/dev-loop/templates/ui-vision-review.md`
4. Run the selected review mode against the acceptance criteria and review brief.
5. If the outcome is `continue_ui_fix_loop`, hand findings back to the fixer/developer.
6. Regenerate the artifact bundle after the fix iteration.
7. Re-run the selected review mode until the outcome is `ui_review_satisfied` or `blocked_needs_human_decision`.

## Current minimal validation seam

The pure validation helper at `scripts/loop/ui-designer-review-contract.mjs` codifies the fail-closed entry conditions for this loop:
- non-UI or not-requested work is skipped
- missing required inputs are blocked
- incomplete artifact bundles are blocked
- only a complete artifact bundle is eligible for routed review (`ready_for_designer_review` or `ready_for_vision_review`)

This keeps the boundary testable before any later higher-level reviewer orchestration is layered on top.

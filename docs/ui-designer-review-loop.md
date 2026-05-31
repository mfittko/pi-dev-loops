# Designer-persona review loop for UI slices

This document defines the bounded designer-persona review loop introduced for issue #122 under umbrella issue #97.

## Public entrypoint and dependency boundary

- `dev-loop` remains the single public entrypoint.
- This review loop is an internal capability behind `dev-loop`; it does not introduce a second public workflow name.
- The loop depends on the reusable harness from `docs/ui-smoke-harness.md` and the artifact contract from `docs/ui-artifact-contract.md`.
- The loop is a **consumer** of those earlier slices. It does not redefine browser capture, artifact naming, or CI promotion policy.

## Purpose

The designer-persona review loop turns deterministic UI artifacts into a repeatable next-iteration handoff.

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

## Required output bundle

Every designer-persona pass must produce a bounded structured result with:
- **Findings**
  - what is visually or interaction-wise wrong or unclear
  - which named state it affects
  - the evidence path(s) that support the finding
- **Corrective actions**
  - what should be changed next
- **Next-iteration focus areas**
  - the small set of UI items the fixer/developer should prioritize next
- **Outcome**
  - exactly one of:
    - `continue_ui_fix_loop`
    - `ui_review_satisfied`
    - `blocked_needs_human_decision`

## Outcome semantics

### `continue_ui_fix_loop`

Use this when findings remain and a normal UI fix iteration should continue.

The handoff goes back to the fixer/developer with:
- the findings
- the corrective actions
- the next-iteration focus areas
- the same acceptance criteria and artifact contract for the next pass

### `ui_review_satisfied`

Use this when:
- the named states in scope satisfy the review brief and acceptance criteria closely enough to stop iterating on the UI/design side
- any remaining issues are minor enough that they do not justify another dedicated UI-fix pass

This does **not** replace normal engineering validation; it only means the designer-persona review loop is satisfied.

### `blocked_needs_human_decision`

Use this when the loop finds a genuine design/product decision that cannot be resolved by another normal UI-fix iteration alone.

Examples:
- conflicting acceptance cues
- a tradeoff that requires a product or design decision
- artifacts that expose a scope contradiction rather than a normal implementation defect

## Fail-closed behavior

The loop fails closed when:
- required acceptance criteria are missing
- the review brief is missing or empty
- the artifact bundle is missing
- the artifact bundle has no named states
- a named state lacks `screenshotPath` or `statePath`
- the work is not actually a UI slice and the loop was requested anyway

When the work is non-UI, the loop does not trigger for non-UI work; it returns a skip outcome instead of pretending to review unrelated artifacts.

## Handoff sequence under `dev-loop`

1. Run or reuse the deterministic local UI smoke path.
2. Collect the named-state artifact bundle from `test-results/ui-smoke/<sliceId>/named-states/<state-slug>/` and the optional HTML report.
3. Run the designer-persona review against the acceptance criteria and review brief.
4. If the outcome is `continue_ui_fix_loop`, hand findings back to the fixer/developer.
5. Regenerate the artifact bundle after the fix iteration.
6. Re-run the designer-persona review until the outcome is `ui_review_satisfied` or `blocked_needs_human_decision`.

## Current minimal validation seam

The pure validation helper at `scripts/loop/ui-designer-review-contract.mjs` codifies the fail-closed entry conditions for this loop:
- non-UI or not-requested work is skipped
- missing required inputs are blocked
- incomplete artifact bundles are blocked
- only a complete artifact bundle is eligible for designer review

This keeps the boundary testable before any later higher-level reviewer orchestration is layered on top.

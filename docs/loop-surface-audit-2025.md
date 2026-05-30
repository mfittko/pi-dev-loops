# Loop Contract Surface Audit — 2025

This document records the bounded package-core surface audit for the four loop contract modules
flagged by the JS-tooling scan (see issue #202).

## Scope

The audit covers:
- `packages/core/src/loop/public-dev-loop-routing.mjs`
- `packages/core/src/loop/conductor-ownership.mjs`
- `packages/core/src/loop/conductor-pr-projection.mjs`
- `packages/core/src/loop/tracker-pr-state.mjs`

## Methodology

For each module:
1. Enumerate every export.
2. Identify all import sites (runtime scripts, tests, package-level consumers).
3. Classify each export as: **runtime** (imported by a non-test script), **test-only** (imported only by test files), or **docs-only** (referenced in contract docs but not in code).
4. Decide: **KEEP** (justified), **TRIM** (reduce or unexport), or **DELETE** (no consumers).

---

## Module: `public-dev-loop-routing.mjs`

**Size:** 1 628 lines, 24 named exports (3 functions + 21 constants)

### Consumer inventory

| Consumer | Import type | Which exports |
|---|---|---|
| `packages/core/test/public-dev-loop-routing.test.mjs` | test | all 24 |
| `packages/core/test/retrospective-checkpoint.test.mjs` | test | 6 constants + `evaluatePublicDevLoopRouting` |
| `skills/docs/public-dev-loop-contract.md` | doc reference | `DEV_LOOP_GATE`, `PUBLIC_DEV_LOOP_GATE_CONTRACT`, `DEV_LOOP_VARIATION_PARAMETER_CONTRACT` |
| `skills/dev-loop/SKILL.md` | doc reference | module path |
| No runtime scripts | — | — |

### Decision per export

All 24 exports are actively used in tests and/or referenced in the authoritative contract doc.
No dead exports identified. Module size is large because it encodes a complex, well-tested routing
contract; the size is intentional, not incidental.

**Decision: KEEP all exports as-is.**

### Follow-up candidates

- `resolveAuthoritativeStartupResumeBundle` is the largest sub-surface (~300 lines). Consider
  whether its normalisation helpers warrant extraction into a focused sub-module in a follow-up
  slice (sharper issue to be filed).

---

## Module: `conductor-ownership.mjs`

**Size:** 572 lines, 6 named exports (3 constants + 3 functions)

### Consumer inventory

| Consumer | Import type | Which exports |
|---|---|---|
| `packages/core/test/conductor-ownership.test.mjs` | test | all 6 |
| `packages/core/src/loop/conductor-routing.mjs` | comment-only reference | (not an import) |
| `docs/conductor-ownership-contract.md` | doc reference | module path |
| No runtime scripts | — | — |

### Decision per export

- `ACTION` — needed to supply valid `action` values to `evaluateOwnershipAction`; callers must have it. **KEEP**
- `OWNERSHIP_STATE` — needed to interpret `classifyOwnershipState` output. **KEEP**
- `OUTCOME` — needed to interpret `evaluateOwnershipAction` output. **KEEP**
- `normalizeOwnershipKey` — documented intermediate seam; explicitly tested. **KEEP**
- `classifyOwnershipState` — documented intermediate seam; explicitly tested. **KEEP**
- `evaluateOwnershipAction` — primary policy entrypoint per contract. **KEEP**

Overall surface is well-scoped (6 exports for a complete state-machine contract).
No reductions identified with high confidence.

**Decision: KEEP all exports as-is.**

---

## Module: `conductor-pr-projection.mjs`

**Size:** 623 lines, 9 named exports (4 constants + 5 functions)

### Consumer inventory

| Consumer | Import type | Which exports |
|---|---|---|
| `packages/core/test/conductor-pr-projection.test.mjs` | test | all 9 |
| `skills/docs/conductor-pr-projection-contract.md` | doc reference | `computeProjectionKey`, `defaultProjectionConfig`, `classifyPostMergeKind`, `evaluateMentionEligibility` |
| `skills/dev-loop/SKILL.md` | doc reference | module path |
| `skills/copilot-dev-loop/SKILL.md` | doc reference | module path |
| No runtime scripts | — | — |

### Decision per export

- `PROJECTION_TRANSITION` — callers need it to supply valid transition values. **KEEP**
- `PROJECTION_REQUIREMENT` — callers need it to interpret projection decisions. **KEEP**
- `POST_MERGE_KIND` — callers need it to interpret `classifyPostMergeKind` output. **KEEP**
- `MENTION_TRIGGER` — callers need it to supply valid trigger values. **KEEP**
- `defaultProjectionConfig` — documented default factory; callers must have it. **KEEP**
- `evaluateProjection` — primary evaluator. **KEEP**
- `computeProjectionKey` — documented idempotency-key helper; also called internally by `evaluateProjection` which returns the key in its result. Low-confidence trim candidate: callers who need only the key (e.g. for pre-emission dedup) would lose a convenient entry point.  Filed as a follow-up rather than a confirmed trim.
- `classifyPostMergeKind` — documented classification helper; complement to `evaluateProjection`. **KEEP**
- `evaluateMentionEligibility` — documented secondary evaluator used after `evaluateProjection`. **KEEP**

**Decision: KEEP all exports as-is. `computeProjectionKey` is a low-confidence trim candidate; file as a follow-up.**

### Surface gap fixed

`./loop/conductor-pr-projection` was listed in `package.json` exports but was absent from
`packages/core/test/package-surface.test.mjs`. Added to the surface test as part of this audit.

---

## Module: `tracker-pr-state.mjs`

**Size:** 295 lines, 5 named exports (3 constants + 2 functions) → **4 exports after this audit**

### Consumer inventory

| Consumer | Import type | Which exports |
|---|---|---|
| `packages/core/test/tracker-pr-state.test.mjs` | test | all 5 (previously) |
| `scripts/loop/detect-tracker-pr-state.mjs` | **runtime** | `interpretTrackerPrState`, `normalizeTrackerPrSnapshot` |
| `test/loop/detect-tracker-pr-state.test.mjs` | integration test | (via the script) |
| `docs/tracker-story-pr-contract.md` | doc reference | `interpretTrackerPrState`, `normalizeTrackerPrSnapshot`, `REVERSE_SYNC_ACTION` |
| `docs/tracker-first-mvp-state-graph.md` | doc reference | `allowedTransitions` (return field, not constant) |

### Decision per export

- `TRACKER_PR_STATE` — needed by callers to interpret `state` and `allowedTransitions` returned by `interpretTrackerPrState` without relying on magic strings. **KEEP**
- `TRACKER_PR_TRANSITIONS` — **TRIMMED** (see below)
- `REVERSE_SYNC_ACTION` — referenced in `docs/tracker-story-pr-contract.md`; callers need it to map states to tracker-side sync actions. **KEEP**
- `normalizeTrackerPrSnapshot` — imported by the runtime script. **KEEP**
- `interpretTrackerPrState` — primary runtime entrypoint. **KEEP**

### Reduction implemented: unexport `TRACKER_PR_TRANSITIONS`

**Evidence:**
- Zero runtime script imports of `TRACKER_PR_TRANSITIONS`.
- Not mentioned in any contract doc (`docs/tracker-story-pr-contract.md` and
  `docs/tracker-first-mvp-state-graph.md` reference only `allowedTransitions` — the return
  field of `interpretTrackerPrState`, not the raw graph constant).
- `interpretTrackerPrState` already returns `allowedTransitions` as a fresh array for
  every call, making the raw graph constant redundant for all callers.
- The only consumer was a structural integrity test that verified the static shape of the constant.
  That test is replaced with a behavior-based verification that exercises
  `interpretTrackerPrState` for each reachable state and checks that returned
  `allowedTransitions` contain only valid `TRACKER_PR_STATE` values — stronger coverage
  at equal or lower surface area.

**Files changed:**
- `packages/core/src/loop/tracker-pr-state.mjs` — removed `export` from `TRACKER_PR_TRANSITIONS`; updated module JSDoc.
- `packages/core/test/tracker-pr-state.test.mjs` — removed import; replaced static graph test with behavior-based verification.

### Surface gap fixed

`./loop/tracker-pr-state` was listed in `package.json` exports and has a real runtime
consumer (`detect-tracker-pr-state.mjs`) but was absent from
`packages/core/test/package-surface.test.mjs`. Added to the surface test as part of this audit.

---

## Summary table

| Module | Exports before | Exports after | Decision |
|---|---|---|---|
| `public-dev-loop-routing.mjs` | 24 | 24 | KEEP all |
| `conductor-ownership.mjs` | 6 | 6 | KEEP all |
| `conductor-pr-projection.mjs` | 9 | 9 | KEEP all; `computeProjectionKey` low-confidence follow-up |
| `tracker-pr-state.mjs` | 5 | **4** | TRIM: unexported `TRACKER_PR_TRANSITIONS` |

## Follow-up items

The following sharper slices are out of scope for this bounded audit and should be filed as
separate issues if the evidence continues to grow:

1. **`public-dev-loop-routing.mjs` split** — `resolveAuthoritativeStartupResumeBundle` is a
   dense sub-surface (~300 lines). Evaluate whether its normalization helpers can be extracted
   into a focused sub-module without breaking the existing API contract.

2. **`conductor-pr-projection.mjs`: `computeProjectionKey` trim** — Low-confidence trim candidate.
   If future audits confirm that no callers use it independently of `evaluateProjection`, removing
   the export is a bounded follow-up.

3. **`conductor-ownership.mjs`: runtime activation** — The module has no runtime script consumers
   today. Once `conductor-routing.mjs` begins importing and calling it at runtime, re-evaluate
   whether `normalizeOwnershipKey` and `classifyOwnershipState` should remain public or be
   collapsed into the single `evaluateOwnershipAction` entrypoint.

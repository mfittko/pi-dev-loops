# UI validation contract under `dev-loop`

This document defines the first bounded UI validation contract for issue #97 follow-up slices.

## Public entrypoint and opt-in boundary

- `dev-loop` remains the single public entrypoint for this UI validation work.
- UI validation is opt-in and bounded in this slice.
- Opt-in is a doc-only convention in this slice: the phase doc or PR description must explicitly annotate when UI validation is requested.
- If no opt-in annotation exists, UI validation is not a default requirement.

## First-slice bounded validation modes

Only these three categories are in-bounds for this slice:

| Category | In-bounds for this slice | Out of bounds for this slice |
|---|---|---|
| Manual review artifacts | Manual screenshots or demo captures used for review communication | Treating manual artifacts as deterministic test evidence |
| Deterministic UI smoke validation | Small screenshot-backed UI smoke validation, with optional DOM/assertion checks when needed by the slice | Expanding into always-on screenshot testing or a browser-heavy default workflow |
| Broader visual regression coverage | Explicitly deferred boundary reference only | Full visual regression suite, baseline-management productization, or broad CI enforcement |

## Mode details

### 1) Screenshot-backed UI smoke validation

- Keep smoke checks deterministic, small, and scoped to the explicitly requested UI states.
- Screenshot capture is allowed as smoke evidence for the opted-in slice.
- This is not an always-on screenshot testing requirement for all work.

### 2) Optional DOM/assertion checks

- DOM/assertion checks are optional and only used when the opted-in UI slice needs them.
- They supplement smoke checks; they do not redefine the loop as browser-first.

### 3) Fixture-backed rendering when practical

- When practical, prefer fixture-backed rendering to keep smoke checks deterministic.
- Reference example: `test/playwright/inspect-run-viewer.spec.mjs`.
- This slice does not introduce a generalized fixture template or reusable toolkit abstraction.

## Guardrails and non-goals for this slice

This slice will not:

- introduce any new public workflow entrypoint besides `dev-loop`
- require mandatory multi-browser support
- make browser validation mandatory for non-UI work
- decide the WebKit-vs-Chromium default browser question
- build a full shared Playwright helper toolkit
- promote screen recording/video automation as a first-class helper

## Deferred follow-up work

The following are intentionally deferred:

- whether first reusable toolkit helpers should be doc/skill-only or include deterministic helper scripts
- WebKit-vs-Chromium default decision
- whether screen recording remains manual or becomes first-class helper tooling
- CI promotion/enforcement strategy for UI smoke validation (now defined in `docs/ui-artifact-contract.md`)

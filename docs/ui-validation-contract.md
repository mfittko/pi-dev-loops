# UI validation contract under `dev-loop`

This document defines the bounded UI validation contract.

## Public entrypoint and opt-in boundary

- `dev-loop` remains the single public entrypoint for UI validation work.
- UI validation is opt-in and bounded.
- Opt-in is a doc-only convention: the phase doc or PR description must explicitly annotate when UI validation is requested.
- If no opt-in annotation exists, UI validation is not a default requirement.

## Bounded validation modes

Only these three categories are in-bounds:

| Category | In-bounds | Out of bounds |
|---|---|---|
| Manual review artifacts | Manual screenshots or demo captures used for review communication | Treating manual artifacts as deterministic test evidence |
| Deterministic UI smoke validation | Small screenshot-backed UI smoke validation, with optional DOM/assertion checks when needed | Expanding into always-on screenshot testing or a browser-heavy default workflow |
| Broader visual regression coverage | Explicitly deferred boundary reference only | Full visual regression suite, baseline-management productization, or broad CI enforcement |

Artifact shape and CI promotion rules for these modes are defined in [UI Artifact Contract](./ui-artifact-contract.md).

## Guardrails and non-goals

- No new public workflow entrypoint besides `dev-loop`
- No mandatory multi-browser support
- No browser validation mandatory for non-UI work
- No WebKit-vs-Chromium default browser decision
- No full shared Playwright helper toolkit
- No screen recording/video automation as a first-class helper

## Deferred follow-up work

The following are intentionally deferred:

- whether first reusable toolkit helpers should be doc/skill-only or include deterministic helper scripts
- WebKit-vs-Chromium default decision
- whether screen recording remains manual or becomes first-class helper tooling
- later workflow consumers beyond the artifact/CI contract already settled in [UI Artifact Contract](./ui-artifact-contract.md)

# phase-1 durable plan

## Status

Not started

## Objective

Normalize the imported assets without changing their intended workflow behavior.

## Why this phase exists now

Phase 0 establishes the workflow convention and phase-planning model. Phase 1 uses that foundation to remove or classify imported repo-specific assumptions so the first reusable assets can become genuinely package-friendly.

## Provisional scope

This phase is intentionally not fully refined yet. The likely scope is:

- local dev-loop normalization for portable naming, templates, and path handling
- copilot-dev-loop normalization to remove remaining imported repo-specific assumptions
- agent classification and policy extraction
- deciding which existing deterministic helpers should move into `packages/core`

## Explicit non-goals

- do not refine this phase in detail until Phase 0 is complete
- do not start implementation from this doc while `docs/IMPLEMENTATION_STATE.md` still points at Phase 0
- do not broaden into package-polish, second-repo pilots, or later extension UX work yet

## Provisional acceptance shape

When Phase 1 is eventually refined, it should at minimum make it clear:

- which imported assets are reusable now
- which need moderate refactor
- which assumptions belong in overlays rather than base skills/agents
- which helper extractions into `packages/core` are actually justified next

## Notes

This is a placeholder durable phase doc only. Refine it after Phase 0 closes.

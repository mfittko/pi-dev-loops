# phase-9 durable plan

## Status

planning

## Tracker reference

GitHub issue [#294](https://github.com/mfittko/pi-dev-loops/issues/294) — Tracker-backed local implementation: spec input-source contract

The issue body is the canonical spec. This file is a thin pointer.

## Objective

Add tracker-backed input-source support to the local implementation path so a
GitHub issue (or equivalent tracker reference) can serve as the spec source of
truth without duplicating its content into `docs/phases/`.

## Why now

#286 (config contract) surfaced this pattern ad hoc. #301 tried to use it and
hit the gap. The pattern is clearly needed — it should be formalized before
more issues land this way.

## In scope (summary)

See the issue body for the full contract scope. At minimum:
- spec resolution from a tracker reference
- canonical-home rule (tracker issue is source; phase doc is pointer)
- state-sync convention (update the issue when the phase advances)
- non-duplication contract

## Non-goals

See the issue body. No new routing mode, no bidirectional sync, no replacing existing paths.

## Links to execution artifacts

- local execution artifacts under `tmp/phases/phase-9/`

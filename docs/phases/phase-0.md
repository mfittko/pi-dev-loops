# Phase 0 — Handoff Envelope Viewer Tab

**Issue:** [#538](https://github.com/mfittko/pi-dev-loops/issues/538)
**Depends on:** [#536](https://github.com/mfittko/pi-dev-loops/issues/536) (handoff envelope function — already merged)
**Status:** refinement-complete → implementation

## Objective

Add an "Agent handoff" tab to the `inspect-run-viewer` that renders the output of `buildDevLoopHandoffEnvelope()` as structured HTML alongside the existing live-detector view.

## Scope

- Server: `/handoff-envelope.json` endpoint → calls `buildDevLoopHandoffEnvelope()` and returns JSON
- Renderer: `handoff-envelope-renderer.mjs` → `renderHandoffEnvelopeSection(envelope)`
- UI: tab navigation CSS + JS in `rendering.mjs`
- Test: Playwright smoke test verifying tab renders correctly

## Non-goals

- Modifying `buildDevLoopHandoffEnvelope()` output shape
- Auto-dispatch from the viewer
- Editing envelope fields in the viewer
- Raw JSON dump — must be structured HTML

## Approach

### Server endpoint

Add `/handoff-envelope.json?repo=<owner/name>&pr=<n>` to `server.mjs`. Loads config, runs resolver, calls `buildDevLoopHandoffEnvelope()`, returns JSON.

### Rendering

New module `handoff-envelope-renderer.mjs` with `renderHandoffEnvelopeSection(envelope)` — renders each envelope section (identity, current state, work directive, gate config, policy, acceptance, control, overrides) as structured HTML using the existing shared rendering helpers.

### Tab UI

Two tabs: "Live view" (existing) + "Agent handoff" (new). Tab switching via JavaScript. Envelope fetched on tab activation via fetch to `/handoff-envelope.json`.

### Validation

- `npm run verify` green
- Playwright test: opens viewer, clicks "Agent handoff" tab, verifies envelope renders

## Definition of done

- Viewer accessible at `npm run test:playwright:viewer` shows both tabs
- Clicking "Agent handoff" tab fetches and renders the envelope
- Envelope fields match live-detector summary for same PR
- "Envelope unavailable" shown when function inputs are missing

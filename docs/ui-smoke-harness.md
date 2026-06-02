# Local Playwright/WebKit smoke harness for UI slices

This document defines the minimal reusable local smoke harness/template introduced for issue #124 under umbrella issue #97.

## Purpose

Use this harness when a `dev-loop` slice is explicitly opting into deterministic UI smoke validation for a user-facing HTML/UI/component surface.

The harness is intentionally small:
- Playwright
- WebKit only
- fixture-backed scenarios
- named screenshot/state artifact capture
- deterministic local artifact/report locations

It is not a general E2E framework and it does not make browser validation mandatory for non-UI slices.

## Reusable baseline

The reusable baseline lives in:
- `test/playwright/harness/webkit-smoke-harness.mjs`
- `playwright.inspect-run-viewer.config.mjs` as the proving reference adoption
- `test/playwright/inspect-run-viewer.spec.mjs` as the bounded fixture-backed example

The harness exposes three main seams:
- `createWebkitSmokeConfig(...)` — create the minimal WebKit-only Playwright config with deterministic output/report locations
- `startFixtureServer(...)` / `stopFixtureServer(...)` — start and stop a bounded local fixture-backed HTTP server for the UI surface under test
- `captureNamedUiState(...)` — write deterministic named-state artifacts for reviewer consumption

## Adoption path

A new UI slice should:

1. add a small fixture-backed Playwright spec under `test/playwright/`
2. create a thin config via `createWebkitSmokeConfig({ sliceId, testMatch })`
3. start the slice-specific fixture server with `startFixtureServer(...)`
4. exercise only the small explicit UI states needed by the slice acceptance criteria
5. call `captureNamedUiState(...)` for each named state that should remain reviewable

Keep the per-slice layer thin. The shared harness owns the repeatable WebKit/report/artifact shape; the slice should only own its fixture and explicit assertions.

## Deterministic local paths

Given a `sliceId` of `inspect-run-viewer`, the baseline paths are:
- Playwright output directory: `test-results/ui-smoke/inspect-run-viewer`
- HTML report directory: `playwright-report/ui-smoke/inspect-run-viewer`
- named-state artifacts: `test-results/ui-smoke/inspect-run-viewer/named-states/<state-slug>/`

Each named-state directory currently contains:
- `screenshot.png`
- `state.json`

These paths are the local proving ground for the reusable artifact contract in [UI Artifact Contract](./ui-artifact-contract.md) and for later designer-review-loop work.

## Reference example

The current proving example is the inspect-run viewer smoke suite:
- fixture input: `test/playwright/fixtures/inspect-run-viewer-fixture.mjs`
- spec: `test/playwright/inspect-run-viewer.spec.mjs`
- config: `playwright.inspect-run-viewer.config.mjs`
- command: `npm run test:playwright:viewer`

The example intentionally covers a small explicit set of viewer states rather than broad end-to-end workflows.

## Limitations and non-goals

This harness does not attempt to provide:
- multi-browser coverage
- generalized E2E orchestration
- large fixture catalogs
- visual-diff baseline management
- mandatory CI enforcement for every UI slice
- a second public workflow entrypoint beside `dev-loop`

CI promotion policy is now defined in [UI Artifact Contract](ui-artifact-contract.md): keep the local harness honest first, then promote only the bounded UI slices whose settled contract warrants CI enforcement.

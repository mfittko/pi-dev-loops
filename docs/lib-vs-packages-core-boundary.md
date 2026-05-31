# lib/ vs packages/core/ Ownership Boundary

This document defines which shared logic belongs in `lib/` versus `packages/core/`.

## One-line rule

| Location | Owner | What belongs here |
|---|---|---|
| `packages/core/` | Reusable deterministic logic | Pure functions with no filesystem, network, or runtime dependencies |
| `lib/` | Runtime command support | Extension + CLI command surface, readiness check collection using runtime probes |
| `scripts/_core-helpers.mjs` | Script re-export shim | Re-exports from `packages/core/` + script-runtime utilities like `isDirectCliRun` |

## packages/core/

`packages/core/` is the authoritative home for **reusable deterministic logic**:

- Pure parsing helpers (state detection, JSON normalization, comment parsing)
- State machine definitions with no side effects
- Data transformation and aggregation utilities
- GitHub data normalization (review threads, gate-review comments, Copilot reviews)
- Loop-state logic (Copilot loop, reviewer loop, tracker PR state, conductor routing)
- Phase-file helpers

A helper belongs in `packages/core/` when:
- it has no `import` of filesystem, network, or process modules
- it can be unit-tested from raw data fixtures without any runtime setup
- it is consumed (or could be consumed) by more than one caller across `scripts/`, `lib/`, or external packages

Current exports live under:
- `packages/core/src/github/` — GitHub data helpers (review threads, repo slug, Copilot helpers)
- `packages/core/src/loop/` — loop state machines and deterministic logic

## lib/

`lib/` is for **shared runtime command support** used by the extension and the CLI:

- `lib/dev-loops-core.mjs` — command parsing (`parseDevLoopsCommand`), readiness check collection (`collectDevLoopChecks`), result rendering (`renderCheckLines`, `summarizeChecks`, `describeReadiness`)

A helper belongs in `lib/` when:
- it ties together command parsing, runtime probing (`commandExists`, `ghAuthOk`, `insideGitRepo`), and result rendering into a unified command surface
- it is consumed by both `extension/` and `cli/` but not by `scripts/` or `packages/core/`

`lib/` is **not** the place for pure deterministic helpers that have no runtime dependency — those belong in `packages/core/`.

## scripts/_core-helpers.mjs

`scripts/_core-helpers.mjs` is a **thin re-export shim** and home for script-runtime utilities:

- It re-exports deterministic helpers from `packages/core/` so scripts can import from one local path.
- It hosts `isDirectCliRun` — a filesystem-dependent utility that checks whether a script was invoked directly; it uses `realpathSync` and belongs here rather than in `packages/core/` because it is a runtime entry-point guard, not a pure function.

Do **not** add new deterministic parsing or aggregation logic here. Add it to `packages/core/src/github/` or `packages/core/src/loop/` and re-export from this shim if needed by scripts.

## Decision tree for new shared logic

```
Is the function pure (no fs/net/process imports)?
  YES → does it deal with GitHub data or Copilot parsing?
          YES → packages/core/src/github/
          NO  → packages/core/src/loop/ (loop/state logic) or packages/core/src/github/ (GitHub primitives)
  NO  → is it an extension/CLI command or readiness check?
          YES → lib/dev-loops-core.mjs
          NO  → is it a script entry-point guard (e.g. isDirectCliRun)?
                  YES → scripts/_core-helpers.mjs
                  NO  → scripts/<area>/ (keep it local)
```

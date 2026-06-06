# Phase 10 — Reduce CLI flag surface: remove policy flags from deterministic helpers

## Status

Refinement complete. Ready for implementation (not started).

## Objective

Remove policy flags (`--timeout-ms`, `--poll-interval-ms`, `--probe-only`, `--force-rerequest-review`, `--force`, `--force-reason`) from CLI helpers in `scripts/loop/` and `scripts/github/`. Replace with hardcoded constants from a shared `policy-constants.mjs` module. Agents should invoke helpers with only operational params; defaults come from constants or config, not CLI flags.

## Why this phase exists now

- Issue #486 defines the contract and acceptance criteria
- From #482 F7: agents should not control policy through CLI flags
- Current CLI surface exposes timeouts, poll intervals, and force bypass as flags — these are policy decisions, not operational parameters

## In scope

- 6 scripts: `probe-copilot-review.mjs`, `watch-initial-copilot-pr.mjs`, `run-watch-cycle.mjs`, `copilot-pr-handoff.mjs`, `request-copilot-review.mjs`, `upsert-checkpoint-verdict.mjs`
- 1 new file: `packages/core/src/loop/policy-constants.mjs`
- `REMOVED_FLAGS` rejection pattern for clear errors on removed flags
- Full `--force` bypass code path removal from `upsert-checkpoint-verdict.mjs`

## Explicit non-goals

- Not adding `.pi/dev-loop/settings.yaml` schema for timeout/poll defaults
- Not removing `forceRerequestReview` from internal function signatures
- Not touching `inspect-run.mjs` test flags
- Not refactoring `timeout-policy.mjs`
- Not changing the bypass authorization path for `--force` (separate phase)

## Acceptance criteria

- [ ] No policy flags accepted by any script's CLI parser
- [ ] Removed flags produce clear rejection errors via REMOVED_FLAGS pattern
- [ ] Default timeouts resolved from `policy-constants.mjs`
- [ ] Default poll intervals resolved from `policy-constants.mjs`
- [ ] `--force` bypass removed from CLI AND internal code path
- [ ] `--force-rerequest-review` removed from CLI surface
- [ ] `--probe-only` removed from `run-watch-cycle.mjs`
- [ ] Internal function signatures preserved for programmatic callers
- [ ] `npm run verify` passes

## Definition of done

- 1 new file (`policy-constants.mjs`) + tests
- 6 scripts modified
- All policy flags removed from CLI surface
- USAGE strings updated
- `resolveRuntimeForceOptions` export deleted
- Full `npm run verify` green

## Validation approach

1. `node --test packages/core/test/loop/policy-constants.test.mjs`
2. Script-level rejection tests for each removed flag
3. `npm run verify` (full suite)
4. Manual: `node scripts/github/probe-copilot-review.mjs --help` — verify USAGE

## Durable decisions

- Hybrid approach: centralized constants (Variant B) + loud rejection (Variant C) + full force-bypass removal (Variant A/B)
- REMOVED_FLAGS Map pattern for consistent rejection across all scripts
- `resolveRuntimeForceOptions` deleted entirely (not simplified)
- `buildGateEntryRefusalError` updated to reference separate authorization path

## Open questions

None — all decisions resolved during refinement review.

## Links to execution artifacts

- `tmp/phases/phase-10/variant-a.md` — Smallest safe variant
- `tmp/phases/phase-10/variant-b.md` — Best DX variant
- `tmp/phases/phase-10/variant-c.md` — Safest boundary variant
- `tmp/phases/phase-10/merged-plan.md` — Merged plan (hybrid: B + C + A/B)
- `tmp/phases/phase-10/review.md` — Adversarial review (APPROVED, 3 revisions applied)
- `tmp/phases/phase-10/subagents/` — Refinement subagent summaries

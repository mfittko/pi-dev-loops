# Copilot current-head CI/check normalization contract

This contract owns deterministic interpretation of current-head GitHub CI/check inputs used by Copilot PR follow-up flows.

Implementation surface:
- `@pi-dev-loops/core/loop/copilot-ci-status`
- source file: `packages/core/src/loop/copilot-ci-status.mjs`

## Inputs

- `checkRunsStatus` — normalized head-scoped check-runs status (`success` | `failure` | `pending` | `none`)
- `commitStatus` — normalized head-scoped commit-status status (`success` | `failure` | `pending` | `none`)

## Output

`normalizeHeadScopedCiContract(...)` returns:

- `overallStatus` (`success` | `failure` | `pending` | `none`)
- `rollup` (`success`/`failure`/`pending`/`none` booleans; exactly one true)
- `semantics.wait` (`true` when `overallStatus` is `pending` or `none`)
- `semantics.blocked` (`true` when `overallStatus` is `failure`)

## Deterministic precedence

The rollup precedence is fixed and policy-agnostic:
1. `failure`
2. `pending`
3. `success`
4. `none`

This keeps stale prose logic out of loop skills/docs; markdown should reference this contract instead of re-implementing CI/check interpretation rules.

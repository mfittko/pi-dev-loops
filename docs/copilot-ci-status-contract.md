# Copilot PR CI/check normalization contract

This contract owns deterministic interpretation of PR CI/check inputs used by Copilot PR follow-up flows.

Implementation surface:
- `@pi-dev-loops/core/loop/copilot-ci-status`
- source file: `packages/core/src/loop/copilot-ci-status.mjs`

## Entry points

- `normalizeStatusCheckRollupContract(statusCheckRollup)` — normalizes the PR `statusCheckRollup` snapshot from `gh pr view`
- `normalizeHeadScopedCiContract({ checkRunsStatus, commitStatus })` — normalizes current-head refresh inputs after explicit `check-runs` / commit-status probes

Both entry points return the same machine-readable contract shape.

## Inputs

### `normalizeStatusCheckRollupContract(statusCheckRollup)`

- `statusCheckRollup` — the raw PR `statusCheckRollup` array from `gh pr view`

### `normalizeHeadScopedCiContract({ checkRunsStatus, commitStatus })`

- `checkRunsStatus` — normalized head-scoped check-runs status (`success` | `failure` | `pending` | `none`)
- `commitStatus` — normalized head-scoped commit-status status (`success` | `failure` | `pending` | `none`)

## Output

The returned object always includes:

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

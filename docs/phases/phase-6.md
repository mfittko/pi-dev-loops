# phase-6 durable plan

## Status

Awaiting-finalization

## Objective

Harden the newly public repository with the minimum release-readiness assets needed for outside evaluation: an explicit open-source license and baseline GitHub Actions CI.

## Why this phase exists now

The repository is now public at `mfittko/pi-dev-loops`, but it still lacks a formal license and any automated public quality gate. Those are the smallest missing pieces blocking a credible public-facing baseline before broader reuse and second-repo pilot work continues.

## In scope

- add a top-level MIT `LICENSE` file
- add matching SPDX license metadata to the root `package.json`
- add a baseline GitHub Actions CI workflow under `.github/workflows/ci.yml`
- run the existing root test suite in CI on Node 24
- reflect the release-hardening phase in durable planning/state docs

## Explicit non-goals

- no npm publishing or package registry setup
- no release tagging or GitHub Release automation
- no badges, changelog generation, or README marketing rewrite
- no branch protection or repository-settings automation
- no expansion of the existing test surface beyond wiring the current suite into CI
- no second-repo pilot work yet

## Acceptance criteria

- a top-level `LICENSE` file exists and contains the MIT license text
- the root `package.json` declares `"license": "MIT"`
- `.github/workflows/ci.yml` runs on `push` and `pull_request`
- the workflow installs dependencies and runs `npm test`
- the workflow uses Node 24
- `PLAN.md` and `docs/IMPLEMENTATION_STATE.md` reflect the public-release hardening phase

## Definition of done

- the durable phase doc records the objective, scope, non-goals, AC, DoD, validation approach, durable decisions, and open questions
- the repository has a committed-ready MIT license file and matching package metadata
- the baseline CI workflow is present, readable, and bounded to the current test contract
- local validation for the phase is recorded via the existing root test suite and a whitespace/diff sanity check
- the phase is not marked `completed` until commit/merge finalization happens; until then it stays `awaiting-finalization`

## Validation approach

- run `npm test`
- run `git diff --check`
- do a focused read-through of `LICENSE`, `package.json`, and `.github/workflows/ci.yml`

## Durable decisions

- MIT is the chosen initial public license for `pi-dev-loops`
- the first public CI baseline should stay intentionally small and run the existing root test suite only
- Node 24 is the initial CI environment for the public baseline
- broader release automation and repository-governance setup remain separate follow-up work

## Open questions

- should CI expand to a multi-version Node matrix once the package/install contract is finalized more explicitly?
- should a later release-hardening follow-up add branch protection, badges, or release/tag automation, or should those remain repository-local policy choices?

## Operational closure status

Phase 6 implementation is in place locally and pending finalization through the normal commit/merge flow.

## Links to execution artifacts

- local execution artifacts may exist under `tmp/phases/phase-6/`

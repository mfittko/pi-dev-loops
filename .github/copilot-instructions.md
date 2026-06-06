# Copilot instructions — dev-loops

Single entrypoint: `dev-loop`. Prefer GitHub-first path. KISS, SRP, YAGNI.
Work test-first, ≥90% coverage. `npm run verify` for full validation.

## Canonical rule docs (single owner per rule)

Confirmation → `../skills/docs/confirmation-rules.md`
Stop conditions → `../skills/docs/stop-conditions.md`
Anti-patterns → `../skills/docs/anti-patterns.md`
Validation → `../skills/docs/validation-policy.md`
Merge preconditions → `../skills/docs/merge-preconditions.md`
Structural quality → `../skills/docs/structural-quality.md`

## Per-strategy entrypoint briefings (30-50 lines each)

`../skills/docs/entrypoint-briefing-*.md` — load the one for the routed strategy.

## Key helpers

Startup: `node scripts/loop/resolve-dev-loop-startup.mjs`
Draft PR: `node scripts/github/create-draft-pr.mjs --assignee @me ...`
Gate: `node scripts/github/upsert-checkpoint-verdict.mjs`
Branch guard: `node scripts/loop/pre-commit-branch-guard.mjs`

## Contracts

[Public Dev Loop Contract](skills/docs/public-dev-loop-contract.md)
[Worktree Guidance](docs/worktree-guidance.md)

# Entrypoint briefing: Local implementation

State vocabulary: `local_branch`, `local_phase`, `in_progress`, `review`, `merge_ready`

Next-action sentence: "Fan-out refinement (unless light-mode), implement phase, validate, then create PR or continue to next phase."

Helpers to run first:
1. `dev-loops loop startup` — resolve routing
2. `node scripts/loop/pre-commit-branch-guard.mjs --expected-branch <name> [--require-worktree] [--block-main-checkout]` — verify isolation (no CLI route; use script path)

Required reading:
- [Public Dev Loop Contract](public-dev-loop-contract.md)
- [Local Implementation SKILL](../local-implementation/SKILL.md)
- [Anti-patterns](anti-patterns.md)
- [Structural quality](structural-quality.md)
- [Validation policy](validation-policy.md)

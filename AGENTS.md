# AGENTS.md

## Repo contract
- `dev-loop` is the single public workflow entrypoint.
- For routed work, run `dev-loops loop startup ...` first, then load only the returned `requiredReads`.
- Canonical workflow docs live under `skills/docs/`.

## Working rules
- No direct commits to `main`; use feature branches, worktrees, and PRs.
- Use `tmp/worktrees/<issue-or-branch-slug>/` for mutating local work; keep the main checkout for inspection.
- Canonical guidance lives in `docs/worktree-guidance.md`.
- Prefer the GitHub-first routed path for branch/PR/CI/review work; use local implementation only when explicitly requested.
- Use `npm run verify` as the default local validation path.
- When creating GitHub issues via `gh issue create`, always include `--assignee @me` so the new artifact is self-assigned.
- When creating PRs in this repo, use `dev-loops pr create-draft --assignee @me ...` so draft-first is enforced mechanically while preserving self-assignment.
- Implement one phase at a time; if durable repo docs explicitly record a reprioritization exception, follow [Implementation State](docs/IMPLEMENTATION_STATE.md) and the active phase doc.
- Keep compatibility surface minimal; do not add legacy aliases, wrappers, or duplicate docs unless explicitly requested.
- Keep workflow procedure out of AGENTS; put shared contracts under `skills/docs/`.

# AGENTS.md

## Repo contract
- `dev-loop` is the single public workflow entrypoint.
- For routed work, run `node scripts/loop/resolve-dev-loop-startup.mjs ...` first, then load only the returned `requiredReads`.
- Canonical workflow docs live under `skills/docs/`.

## Working rules
- No direct commits to `main`; use feature branches, worktrees, and PRs.
- Use `tmp/worktrees/<issue-or-branch-slug>/` for mutating local work; keep the main checkout for inspection.
- Prefer the GitHub-first routed path for branch/PR/CI/review work; use local implementation only when explicitly requested.
- Use `npm run verify` as the default local validation path.
- Create GitHub issues with `gh issue create --assignee @me`.
- Create PRs with `node scripts/github/create-draft-pr.mjs --assignee @me ...` so draft-first is enforced mechanically.
- Keep one phase at a time; if durable repo docs record a reprioritization exception, follow `docs/IMPLEMENTATION_STATE.md` and the active phase doc.
- Keep compatibility surface minimal; do not add legacy aliases, wrappers, or duplicate docs unless explicitly requested.
- Keep workflow procedure out of AGENTS; put shared contracts under `skills/docs/`.

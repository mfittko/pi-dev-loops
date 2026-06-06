# AGENTS.md

## Repo contract
- `dev-loop` is the single public workflow entrypoint.
- For routed work, run `dev-loops loop startup ...` first, then load only the returned `requiredReads`.
- Canonical workflow docs live under `skills/docs/`.

## Working rules
- No direct commits to `main`; use feature branches, worktrees, and PRs.
- Use `tmp/worktrees/<issue-or-branch-slug>/` for mutating local work; keep the main checkout for inspection.
- Always run `git fetch origin` before creating or reusing a worktree — never create from a stale `origin/main`.
- Canonical guidance lives in `docs/worktree-guidance.md`.
- Prefer the GitHub-first routed path for branch/PR/CI/review work; use local implementation only when explicitly requested.
- Use `npm run verify` as the default local validation path.
- When creating GitHub issues via `gh issue create`, always include `--assignee @me` so the new artifact is self-assigned.
- When creating PRs in this repo, use `dev-loops pr create-draft --assignee @me ...` so draft-first is enforced mechanically while preserving self-assignment.
- Never start implementation (file mutation, branch creation, PR creation) without explicit instruction. "Queue," "add to list," "track," "note" are NOT implementation triggers. Only proceed when the user says "start," "go," "implement," "do it," "work on," or equivalent imperative. Confirm if unsure.
- All work must originate from a tracked artifact: a GitHub issue (tracker-first) or a persisted markdown plan file. No work may originate from a PR or direct local change unless explicitly requested.
- Implement one phase at a time; if durable repo docs explicitly record a reprioritization exception, follow [Implementation State](docs/IMPLEMENTATION_STATE.md) and the active phase doc.
- Keep compatibility surface minimal; do not add legacy aliases, wrappers, or duplicate docs unless explicitly requested.
- Keep workflow procedure out of AGENTS; put shared contracts under `skills/docs/`.
- No PR scope has gate exemptions (#579): see skills/dev-loop/SKILL.md "No gate exemptions" section.

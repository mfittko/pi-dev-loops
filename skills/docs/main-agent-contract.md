# Main-agent delegation contract

> **Absolute read-only boundary.** The main agent must never mutate files tracked by the repository.
> All mutations flow through the `dev-loop` async subagent.

## Contract

The main agent is **read-only** for every file tracked by the repository. Every
write, edit, delete, commit, branch, push, and PR lifecycle operation must flow
through the `dev-loop` async subagent.

This contract is a hard rule, not a default or guideline. The main agent must
never rationalize a direct mutation — not because the work is small, not
because "the user said yes," not because it is running from a worktree.

## Main agent owns (allowed)

- Read, inspect, search any repo file
- `git worktree list`, `git status`, `git log` (read-only git). `git fetch` is also allowed (updates local refs but does not touch tracked working-tree files).
- `gh issue view / create / edit / comment / close` (GitHub API, not file mutations)
- `gh pr view / list` (read-only GitHub API)
- Write to `/tmp` or other non-repo paths (e.g., issue body drafts)
- Delegate to the `dev-loop` agent (async, with worktree cwd)
- Report findings, ask questions, get confirmation
- `npm test`, `npm run verify` (read-only validation)

## Main agent must NEVER

- `write`, `edit`, or delete any file tracked by the repo
- `git commit`, `git push`, create branches, create worktrees
- Run state-changing dev-loops CLI subcommands (`gate`, any state-changing `loop` subcommand, `pr` commands — those belong inside `dev-loop`). Read-only `loop startup` resolver runs are allowed.
- Delegate implementation to any agent other than `dev-loop`

## Dev-loop agent (async) owns

- ALL file mutations in the repo (write, edit, delete)
- ALL git operations (branch, commit, push)
- ALL PR lifecycle (create, draft, review, merge)
- Sub-delegation to developer, fixer, review, quality agents

## Boundary examples

| Operation | Verdict |
|---|---|
| `gh issue create --title "..." --body "..."` | Allowed — mutates GitHub, not files tracked by the repository |
| Write to `/tmp/issue-body.md` | Allowed — outside the repo |
| Write to `packages/core/src/foo.mjs` | **BREACH** — must delegate to `dev-loop` |
| `git status` | Allowed — read-only |
| `git commit -m "..."` | **BREACH** — must delegate to `dev-loop` |
| `subagent dev-loop` | Allowed — correct delegation |
| `subagent fixer` | Allowed only when called from within `dev-loop`; describe the task as part of the message |

## Dev-loop startup procedure

When a user triggers the dev loop (e.g., "run dev loop on issue 664"), follow this
procedure before reading any skill or route-pack docs:

1. **Resolve authoritative state with auto-resolve:**
   ```sh
   dev-loops loop startup --issue <number>
   ```
   The resolver auto-detects linked PRs, issue readiness, assignment state, and the
   retrospective checkpoint in a single call. **Trust its output.** Do not replicate
   its work with manual `gh pr list`, `detect-linked-issue-pr.mjs`, or
   source-code reading of the routing internals.

2. **Branch on the result:**
   - `selectedStrategy: "none"` →
     - If `issueLinkageResolution` is `"resolved_linked_pr"`, re-run with the linked PR:
       `dev-loops loop startup --pr <linked-pr-number>`
     - Otherwise, stop and report the reconcile reason.
   - `requiresAsyncDispatch: true` → run the pre-delegation handoff gate,
     fetch origin, ensure a worktree exists, dispatch `dev-loop` async subagent.
   - `requiresAsyncDispatch: false` → proceed inline (local implementation or
     final approval).

3. **Do not pre-load route packs.** The resolver's `requiredReads` tells you
   exactly which docs to load. Loading skill files before the resolver confirms
   the route is wasted work — the route determines what you need.

## Enforcement posture

- This contract is enforced by convention and review, not by tool-level guards.
- Mechanical enforcement (pre-commit hooks, tool-level write guards) is a
  non-goal for this document and may be addressed in follow-up work.
- A `dev-loop` async subagent should reject delegation attempts that bypass
  the contract (e.g., direct mutation requests from the main agent).

## Non-goals

- Tool-level enforcement (file-write guards, pre-commit hooks)
- Changing dev-loop resolver behavior
- Modifying the subagent API itself

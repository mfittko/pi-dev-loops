# Workflow-Run Subagent Hand-Off Template

This is the canonical hand-off contract for subagents tasked with running
the dev-loop workflow. Every hand-off must use this template — no abbreviated
task summaries or operator-memory shortcuts.

## Required contract-doc reads

Before executing any step, the subagent must read these contract docs:

| Doc | Purpose |
|---|---|
| `docs/gate-review-comment-contract.md` | `draft_gate` and `pre_approval_gate` semantics, verdict definitions, rerun rules, fail-closed behavior |
| `skills/copilot-dev-loop/SKILL.md` | Step 7: review/fix follow-up loop, reply/resolve policy, merge-ready preconditions |
| `scripts/README.md` | Deterministic helpers for gate evidence, thread capture, review requests |

## Mandatory sequence

Every step is non-optional. Do not skip, reorder, or batch steps.

### 1. Create draft PR

- Branch off `origin/main`
- Implement changes, write tests, run `npm run verify`
- Create PR as **draft** via `gh pr create --draft`

### 2. Draft gate review

- Run parallel subagent reviews (correctness vs AC, scope compliance, test coverage)
- Post visible `draft_gate` comment on the PR with:
  - gate name `draft_gate`
  - reviewed head SHA
  - verdict (clean / findings_present / blocked)
  - findings summary
  - next action
- If findings_present or blocked → fix and re-run draft gate

### 3. Mark ready for review

- Only after a clean `draft_gate` comment exists for the current head SHA
- Run: `gh pr ready`

### 4. Wait for Copilot review

- Poll `gh pr view --json reviews` until Copilot review appears
- Do not proceed without Copilot feedback

### 5. Address Copilot feedback

For each Copilot review pass:
- Apply fixes, verify with `npm run verify`
- Reply to **every** inline comment with the resolving commit reference
- **Resolve** the corresponding review threads on GitHub
- Verify: `unresolvedThreadCount === 0` before proceeding

### 6. Re-request Copilot review for new heads

- After pushing fixes to a new head, re-request Copilot review
- Repeat steps 4–6 until Copilot review has no actionable feedback

### 7. Pre-approval gate review

- Confirm legality: `node scripts/loop/detect-pr-gate-coordination-state.mjs --repo <owner/name> --pr <number>`
- Run parallel subagent reviews (DRY, KISS, YAGNI lenses)
- Post visible `pre_approval_gate` comment on the PR
- If findings → fix, push new head, re-run pre-approval gate

### 8. Merge

- Required evidence:
  - `draft_gate` clean comment exists (any head — one-time transition boundary, no current-head requirement)
  - `pre_approval_gate` clean comment exists for **current** head SHA
  - CI green on current head
  - `unresolvedThreadCount === 0`
- Merge only after explicit authorization

## Non-negotiable invariants

- The Copilot review loop (steps 4–6) sits **between** `draft_gate` and `pre_approval_gate` — never reorder
- `unresolvedThreadCount === 0` verification is required before step 7
- Gate comments must be visible on the PR — no hidden/local-only evidence
- Never merge without explicit authorization

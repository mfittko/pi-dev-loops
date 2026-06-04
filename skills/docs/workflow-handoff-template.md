# Workflow-Run Subagent Hand-Off Template

This is the canonical hand-off contract for subagents tasked with running
the dev-loop workflow. Every hand-off must use this template — no abbreviated
task summaries or operator-memory shortcuts.

## Required contract-doc reads

Before executing any step, the subagent must read these contract docs:

| Doc | Purpose |
|---|---|
| [Gate Review Comment Contract](../../docs/gate-review-comment-contract.md) | `draft_gate` and `pre_approval_gate` semantics, verdict definitions, rerun rules, fail-closed behavior |
| [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md) | Step 7: review/fix follow-up loop, reply/resolve policy, merge-ready preconditions |
| [Scripts Documentation](../../scripts/README.md) | Deterministic helpers for gate evidence, thread capture, review requests |

## Mandatory sequence

Every step is non-optional. Do not skip, reorder, or batch steps.

### 1. Create draft PR

- Branch off `origin/main`
- Implement changes, write tests, run `npm run verify`
- Create PR as **draft** via `node scripts/github/create-draft-pr.mjs --assignee @me ...`

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

- Use the deterministic wait boundary: `node scripts/loop/run-copilot-watch-cycle.mjs --repo <owner/name> --pr <number>`
- Treat the PR follow-up as a loop, not a one-shot watch: `watch → detect → if threads found, fix + reply + resolve → re-request → watch again → …`
- If the watch cycle returns fresh Copilot activity / `cycleDisposition: "needs_followup"`, continue immediately to step 5
- If the watch cycle returns `watchStatus: "timeout"`, refresh once with `node scripts/loop/copilot-pr-handoff.mjs --repo <owner/name> --pr <number> --watch-status timeout`
- If the refreshed state still waits on Copilot, stop with `watch timeout — PR #<number> needs manual attention`
- Default max watch timeout per Copilot watch boundary is **30 minutes** (`--timeout-ms 1800000`)

### 5. Address Copilot feedback

For each Copilot review pass:
- Apply fixes, verify with `npm run verify`
- Reply to **every** inline comment with the resolving commit reference
- **Resolve** the corresponding review threads on GitHub
- Verify: `unresolvedThreadCount === 0` before proceeding

### 6. Re-request Copilot review for new heads

- After pushing fixes to a new head, re-request Copilot review
- Return immediately to step 4 after the re-request; do not stop at `review requested` or after a single watch cycle
- Repeat steps 4–6 until Copilot review has no actionable feedback

### 7. Pre-approval gate review

- Confirm legality: `node scripts/loop/detect-pr-gate-coordination-state.mjs --repo <owner/name> --pr <number>`
- If legality returns `gateBoundary=conflict_resolution`, stop the gate, resolve conflicts on the PR branch, rerun validation, re-detect gate state for the new head, and only then rerun `pre_approval_gate`
- Run parallel subagent reviews with angles resolved from config (`resolveGateAngles(config, "preApproval")`)
- Post visible `pre_approval_gate` comment on the PR
- If findings → fix, push new head, re-run pre-approval gate

### 8. Merge

- Immediately before merge, run `node scripts/github/detect-checkpoint-evidence.mjs --repo <owner/name> --pr <number>` and stop if it fails. Gate evidence enforcement is always-on; there is no opt-out flag.
- Required evidence:
  - `draft_gate` clean comment exists (any head — one-time transition boundary, no current-head requirement)
  - `pre_approval_gate` clean comment exists for **current** head SHA
  - CI green on current head
  - `unresolvedThreadCount === 0`
- Merge only after explicit authorization

## Non-negotiable invariants

- **PERSISTENCE RULE: Do not exit your session until the PR is merged or you hit a hard stop that requires conductor authorization.**
- A single watch cycle return is not completion; stay in the same loop until merge or a hard stop
- The Copilot review loop (steps 4–6) sits **between** `draft_gate` and `pre_approval_gate` — never reorder
- `unresolvedThreadCount === 0` verification is required before step 7
- Gate comments must be visible on the PR — no hidden/local-only evidence
- Never merge without explicit authorization
- Never run `gh pr merge` without a same-boundary successful gate evidence check (always-on, no opt-out)

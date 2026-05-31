# Gate-Review Comment Contract

This document defines the required visible PR-comment contract for the two gate
boundaries in the dev-loop workflow: `draft_gate` and `pre_approval_gate`.

## Purpose

Gate-review PR comments make the workflow auditable and transparent from the PR
conversation alone. A reviewer or maintainer can inspect which gate ran, which head
commit was reviewed, whether it passed cleanly, and whether a result is current for
the latest head — without relying on local or session-only artifacts.

This document owns the visible gate-review comment evidence contract only. It does
not restate the full PR follow-up procedure; that remains owned by the relevant
workflow skill.

## Scope

This contract covers exactly two gates:

- `draft_gate` — runs right before `gh pr ready` (draft → ready-for-review boundary)
- `pre_approval_gate` — runs right before final approval / merge readiness

## Review-angle ownership and non-substitution rules

These gates are related but **not interchangeable**.

| Gate | Boundary it governs | Review-angle ownership | What a clean comment authorizes | What it does **not** authorize |
|---|---|---|---|---|
| `draft_gate` | Draft → ready for review | correctness vs acceptance criteria, scope compliance, test coverage adequacy, CI/check status, no unrelated files | `gh pr ready` / leaving draft for the reviewed head SHA | final-approval readiness, merge-ready claims, or satisfaction of `pre_approval_gate` |
| `pre_approval_gate` | Final approval / merge readiness | DRY, KISS, YAGNI | approval-ready / final-human-approval readiness for the reviewed head SHA | draft-stage `gh pr ready` decisions for a different gate run |

A clean `draft_gate` comment does **not** satisfy `pre_approval_gate` requirements.
A clean `pre_approval_gate` comment does **not** retroactively replace the required `draft_gate` evidence for leaving draft.

## Required fields

Every gate-review PR comment must include:

| Field | Description |
|---|---|
| **Gate name** | `draft_gate` or `pre_approval_gate` |
| **Head SHA reviewed** | The exact commit SHA that was reviewed |
| **Verdict** | `clean`, `findings_present`, or `blocked` |
| **Findings summary** | Short truthful audit summary. Use `no issues found` only when the reviewed head needed no corrective change for that gate pass. |
| **Next action** | One of: `stay draft and fix`, `rerun gate`, `mark ready for review`, `await final human approval` |

## Verdict definitions

| Verdict | Meaning |
|---|---|
| `clean` | All gate review angles passed; no must-fix findings remain |
| `findings_present` | The gate found issues; fixes are required before the gate boundary can be crossed |
| `blocked` | The gate could not complete or a hard blocker prevented a verdict |

## Readable deterministic format

- Keep the visible comment compact and deterministic, but slightly human-friendly:
  prefer labels like `Gate review`, `Reviewed head SHA`, `Verdict`, `Findings summary`, and `Next action`.
- Preserve parser stability for gate name and reviewed head SHA; minor label wording is fine as long as those fields remain easy to extract deterministically.
- When a gate pass reached `clean` only after corrective changes on the reviewed head, the findings summary should briefly say what gap was found, what changed, and why the current head now satisfies the gate.
- Validation reporting in visible gate comments must stay concise by default:
  include command names plus pass/fail status, aggregate counts when useful, and
  current-head CI/check status when available — not raw passing log streams.
- Any command output included in the visible comment must be truncated to a
  deterministic maximum length before comment creation.
- When validation fails, include only a focused relevant excerpt rather than an
  unbounded raw log dump; detailed logs may live in local/session artifacts or
  linked GitHub logs instead of the visible audit comment.


## Behavior requirements

### Draft gate (`draft_gate`) comment requirements

- When the `draft_gate` runs, the PR must receive a visible gate-review comment.
- If the `draft_gate` verdict is `findings_present` or `blocked`, the comment must
  state that the PR stays draft and fixes are required before retrying.
- The PR must not leave draft (`gh pr ready`) unless a visible `clean` `draft_gate`
  gate-review comment exists for the current head SHA.
- A gate-review comment for an older head SHA does not satisfy this requirement for
  the current head.

### Pre-approval gate (`pre_approval_gate`) comment requirements

- When the `pre_approval_gate` runs, the PR must receive a visible gate-review comment.
- If the `pre_approval_gate` verdict is `findings_present` or `blocked`, the comment
  must state that follow-up fixes are required before final approval.
- Final-approval readiness must not rely only on local or hidden artifacts; the
  visible PR comment is the required auditable evidence.
- A gate-review comment for an older head SHA does not satisfy this requirement for
  the current head.

## Rerun rules

| Scenario | Rule |
|---|---|
| Same head SHA rerun | Idempotent behavior: do not post a second visible marker for the same gate+head. Reuse/suppress by default; if correction is needed, update/replace the existing marker in place. |
| New head SHA rerun | A new visible gate-review comment must be posted for the new head; the older-head comment remains but does not satisfy readiness for the new head |

## Fail-closed behavior

If the required gate-review comment cannot be posted (for example due to a GitHub
API error, permission restriction, or tooling failure), the workflow must not cross
the gate boundary:

- do not run `gh pr ready` (for `draft_gate`)
- do not declare final-approval readiness (for `pre_approval_gate`)

The gate boundary is not crossed until both the review verdict is `clean` **and** the
required visible PR comment is confirmed posted for the current head SHA.

## Relationship to other contracts

| Contract | Relationship |
|---|---|
| `draft_gate` boundary | Governs the draft → ready-for-review transition in `copilot-dev-loop` Step 7, including the issue-intake/autonomy overlays now owned there |
| `pre_approval_gate` boundary | Governs final-approval readiness in `copilot-dev-loop` Step 7, including the issue-intake/autonomy overlays now owned there |
| Local/session artifacts | These remain complementary; the visible PR comment is the minimum required auditable surface, not a replacement for all local artifacts |

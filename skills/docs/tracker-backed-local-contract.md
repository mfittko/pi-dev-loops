# Tracker-backed local implementation contract

This document defines the canonical contract for when a local implementation
session uses a tracker issue (GitHub issue, Shortcut story, Jira ticket, etc.)
as its spec input source instead of a standalone `docs/phases/phase-x.md` plan.

**Invariant:** if a tracker issue already defines the work, the tracker issue is
the canonical spec. Do not duplicate its content into durable repo docs.

This is an **input-source addition** to the existing `local_implementation`
strategy, not a new routing mode. The routing (`target.kind=issue` +
`targetPreference=prefer_local` → `local_implementation`) is unchanged.

## 1. Detection

A local implementation session is **tracker-backed** when:

1. The routed strategy is `local_implementation`
2. The target includes a tracker issue reference (GitHub `owner/repo#N`, Shortcut `sc#N`, etc.)
3. The tracker issue body contains a spec (summary, problem, desired behavior, scope, acceptance criteria)

An explicit `--spec-source tracker` flag is not required; detection is
heuristic: if a tracker reference resolves to a spec-bearing issue body, the
session is tracker-backed.

## 2. Spec resolution

When the session is tracker-backed:

1. **Fetch the issue body** — use the appropriate tracker API or CLI
   - GitHub: `gh issue view <N> --json body,title,state`
   - Shortcut: appropriate API call
   - Jira: appropriate API call
2. **Treat the issue body as the canonical spec** for scope, acceptance
   criteria, and definition of done
3. **Resolve implicit metadata**: issue title → phase objective, labels →
   scope hints, assignee → ownership context

The resolved spec is the single source of truth for the phase. If the issue
body is incomplete (missing acceptance criteria, unclear scope), apply the
same plan-sufficiency check as full local mode and run clarification if needed.

## 3. Canonical home

| Layer | Home | Content |
|---|---|---|
| Spec | Tracker issue body | Full spec: summary, problem, desired behavior, scope, acceptance criteria |
| Execution artifacts | `tmp/phases/phase-x/` | Same as full local mode: variants, merged plan, review, summary, retrospective |

**Rule:** the tracker issue and a `docs/phases/phase-x.md` are mutually
exclusive. If a tracker issue exists as the canonical spec, do NOT create a
phase doc — not even a thin pointer. The phase index at
`tmp/phases/index.json` still records the phase entry and references the
tracker issue as its spec source.

## 4. State sync

When the phase advances, update the tracker issue:

| Event | Sync action |
|---|---|
| Planning starts | Add comment: "Starting local implementation planning. Branch: `<branch>`" |
| Plan merged (fan-in complete) | Update issue body or add comment with merged plan summary + link to `tmp/` artifacts |
| Implementation starts | Add comment: "Implementation in progress. Branch: `<branch>`" |
| Phase complete / awaiting-finalization | Add comment: "Phase complete. Branch `<branch>` merged to local main." or "Awaiting finalization: `<pending step>`" |

State sync is **best-effort**, not transactional. A missing sync comment is
not a workflow failure. The durable truth is in the branch history and local
artifacts; the issue comments are convenience pointers.

## 5. Execution artifacts

Tracker-backed sessions use the same `tmp/` logging structure as full local
mode. Required artifacts:

- `tmp/phases/phase-x/manifest.json`
- `tmp/phases/phase-x/variant-a.md`
- `tmp/phases/phase-x/variant-b.md`
- `tmp/phases/phase-x/merged-plan.md`
- `tmp/phases/phase-x/review.md`
- `tmp/phases/phase-x/summary.md`
- `tmp/phases/phase-x/retrospective.md`

Optional: `variant-c.md`, `clarification.md`, subagent summaries, dev-mode
artifacts.

The `tmp/phases/index.json` entry still exists but references the tracker
issue as its spec source.

## 6. Startup reads

Before a tracker-backed local implementation session:

1. Read `AGENTS.md` (if exists)
2. Read the tracker issue body → canonical spec
3. Read previous phase learnings (`summary.md`, `retrospective.md`) if a
   prior phase exists
4. if `docs/phases/phase-x.md` exists for the active phase, treat it as a conflict — tracker-backed sessions and phase docs are mutually exclusive; stop and reconcile (fail closed) before proceeding

Do **not** require `PLAN.md`, `docs/IMPLEMENTATION_STATE.md`, or
`docs/IMPLEMENTATION_WORKFLOW.md` for tracker-backed sessions. The issue body
is sufficient as the spec; those files remain optional context.

## 7. Plan sufficiency for tracker-backed sessions

Apply the same plan-sufficiency check as full local mode, but against the
**issue body** instead of `docs/phases/phase-x.md`. The issue body is
sufficient when it contains:

- The goal of the phase / issue
- The main constraints
- The intended scope or boundaries
- At least rough acceptance criteria or success shape

If the issue body is insufficient, run a clarification step (same as full
local mode: interactive or auto) and record clarifications in
`tmp/phases/phase-x/clarification.md`.

## 8. Phase planning loop for tracker-backed sessions

The fan-out/fan-in/review loop runs identically to full local mode, with one
difference: the spec is the issue body, not a standalone phase doc.

1. Create `tmp/` scaffold via `scripts/init-phase.mjs`
2. Fan out variants from the issue body spec
3. Fan in to a merged plan in `tmp/phases/phase-x/merged-plan.md`
4. Review the merged plan adversarially
5. Update the issue body with the merged plan summary (state sync)

After the merged plan is produced, update the tracker issue with a comment summarizing the merged plan (state sync). Do NOT create or update any `docs/phases/phase-x.md`.

## 9. Non-duplication enforcement

- The spec MUST NOT be copied from the issue body into a `docs/phases/phase-x.md`
- The merged plan MUST NOT reproduce the full issue body
- `docs/phases/phase-x.md` MUST NOT be created for tracker-backed sessions;
  the phase index (`tmp/phases/index.json`) is the only index artifact needed
- `PLAN.md` is only updated if the phase changes durable product truth (same
  rule as full local mode)
- Issue-specific execution plans remain in the GitHub issue, not in repo-level
  durable docs

## 10. Fail-closed rules

| Condition | Action |
|---|---|
| Tracker reference does not resolve | Fail closed; ask for a valid reference |
| Issue body is empty or non-spec-bearing | Fall back to full local mode or ask for clarification |
| Issue body conflicts with existing phase doc | Fail closed; reconcile manually |
| Tracker API/CLI unavailable | Fall back to full local mode with a warning |

## 11. Relationship to full local mode

| Aspect | Full local mode | Tracker-backed |
|---|---|---|
| Spec source | `docs/phases/phase-x.md` | Tracker issue body |
| Phase doc | Required | Must NOT exist |
| Startup reads | 6 files minimum | Issue body + previous learnings |
| `PLAN.md` requirement | Required | Optional context only |
| State sync | Durable docs only | Issue comments + durable docs |
| `tmp/` artifacts | Required | Required (same structure) |
| Fan-out/fan-in | Required | Required (same procedure) |

## 12. Related

- Public dev-loop contract: `skills/docs/public-dev-loop-contract.md`
- Dev-loop skill: `skills/dev-loop/SKILL.md` (source checkout) or `.pi/skills/dev-loop/SKILL.md` (installed)
- Implementation workflow: `docs/IMPLEMENTATION_WORKFLOW.md`

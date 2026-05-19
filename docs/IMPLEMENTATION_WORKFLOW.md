# Implementation workflow

This repository supports both a local phased workflow and a GitHub-first remote workflow.

## Repo-level workflow preference

Use these defaults unless the user explicitly asks for something else:
- prefer the **GitHub remote-loop workflow** for active implementation and release work
- use the local **`dev-loop`** for phase-bounded local planning/implementation when explicitly requested

In practice:
- use `copilot-dev-loop` for normal GitHub-first issue/PR execution
- use `copilot-autopilot` when the user wants end-to-end issue-first GitHub execution
- use `dev-loop` only when the user explicitly wants the local phase-based path

## Layers of truth

### 1. GitHub issues and PRs

Use GitHub as the backlog and execution trail for GitHub-first work:
- issues are the backlog
- PRs are the execution and review trail
- issue/PR comments are the durable discussion trail for remote-loop work

Do not invent a parallel backlog file for active GitHub-first execution.

### 2. `PLAN.md`

Use for durable repo/product/architecture/roadmap truth.

Do not turn `PLAN.md` into an issue-level implementation checklist.

### 3. `docs/IMPLEMENTATION_STATE.md`

Use for the current repo execution snapshot:
- which phase is active
- what a fresh session should read first
- which workflow mode is expected next

### 4. `docs/phases/phase-<n>.md`

Use for the durable plan for one local phase:
- why the phase exists now
- in-scope work
- explicit non-goals
- acceptance criteria
- definition of done
- validation approach
- durable decisions and open questions

A fresh human or agent should be able to read the active phase doc first and understand the current local-phase intent without replaying `tmp/` artifacts.

### 5. `tmp/`

Use for temporary execution artifacts and audit trails:
- planning variants
- merged plan drafts
- review notes
- retrospective notes
- subagent summaries
- deterministic logs
- proposal/intake artifacts

These files are normally local-only and do not need to be committed.

## Documentation sync rule

When a merged slice changes durable repo truth, update the affected durable docs before treating the slice as closed.

Typical touched docs:
- `README.md` when the shipped surface or usage contract changed
- `PLAN.md` when durable roadmap/product truth changed
- `docs/IMPLEMENTATION_STATE.md` when the current status, active phase, or fresh-session guidance changed
- `docs/IMPLEMENTATION_WORKFLOW.md` when workflow preference or source-of-truth rules changed
- relevant contract/state-graph docs under `docs/` when a helper or workflow contract changed
- `scripts/README.md` when script surfaces, outputs, or supported entrypoints changed

Keep issue-specific execution plans in GitHub issues/PRs or `tmp/`, not in repo-level durable docs.

## Default operating rules for local phase work

When the user explicitly chooses the local phased path:
- work one phase at a time
- refine the active phase before coding it
- use the dedicated refiner role for phase-refinement work when available, while keeping the coordinator as the RFC receiving boundary and decision owner
- keep durable decisions in docs and execution traces in `tmp/`
- use fan-out / fan-in / review before implementation
- write tests first for non-trivial changes
- validate locally before closing a phase
- prefer dedicated local branches over direct work on `main`
- treat phase closure as including review/fix, commit history capture, and merge back to local `main` when authorized

## Phase completion semantics

Use these terms consistently:
- `planning` / `in-progress` = the phase is still being refined or executed
- `awaiting-finalization` = scoped work, required support files, artifacts, and validation are done, but commit and/or merge steps are still pending authorization or execution
- `completed` = the phase is fully finalized, including commit history capture and merge back to local `main`

Do not mark a phase `completed` if the only thing left is “commit later” or “merge later.” In that case, mark it `awaiting-finalization` and record the missing step explicitly.

## Bootstrap/support expectation for the local phase path

The local phase workflow expects the repo to maintain:
- `AGENTS.md`
- `docs/IMPLEMENTATION_STATE.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `docs/phases/phase-<n>.md`
- `tmp/phases/index.json`
- `tmp/phases/phase-<n>/...`

## Convention goal

The split is intentional:
- GitHub issues/PRs carry backlog and remote execution trail
- durable docs carry long-lived human-and-agent truth
- `tmp/` carries resumable execution detail and machine-friendly artifacts

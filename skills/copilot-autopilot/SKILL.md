---
name: copilot-autopilot
description: >-
  Use for end-to-end GitHub-first execution that starts with preflight
  clarification, normalizes any input (issue number, plan-doc path, or abstract
  roadmap idea) to a GitHub issue, runs an async issue-refinement fan-out,
  assigns Copilot, then drives the full draft-PR → local review/fix →
  Copilot re-review → final review → merge cycle. Pauses for clarification
  when input is ambiguous rather than proceeding blindly.
compatibility: Pi skill for git+GitHub repositories. Requires gh auth and pi-subagents; async follow-up works best in Pi/TelePi sessions.
allowed-tools: read bash edit write subagent review_loop
user-invocable: true
---

# Copilot Autopilot

This skill is the issue-intake compatibility/internal strategy behind the public `dev-loop` façade.

It extends the `copilot-dev-loop` with:

1. A **preflight intake phase** that clarifies ambiguous or underspecified inputs before any automation starts.
2. An **input normalization phase** that converts plan-doc paths and abstract ideas into a properly-scoped GitHub issue.
3. An **async issue-refinement phase** (fan-out / fan-in) that tightens the issue before Copilot assignment.
4. The **full GitHub/Copilot lifecycle loop** from Copilot assignment through draft PR, review/fix, Copilot re-review, final review, and merge.

Typical triggers:
- `copilot-autopilot 60`
- `copilot-autopilot docs/plans/doc-validation.md`
- `copilot-autopilot @docs/PLAN.md ADR validation`
- start autopilot from issue 42
- run the full Copilot loop for this plan section

## Skill asset path resolution

When this skill refers to helper paths such as `scripts/...` or `docs/...`, resolve them from the actual skill installation layout you are running, not from the active target repository checkout.

Use this rule:
- if the skill is installed as a normalized standalone copy, helper assets may live under `scripts/` and `docs/` inside the skill directory
- if you are working in the `pi-dev-loops` source repository, this skill file lives under `skills/copilot-autopilot/`, so shared scripts live two levels up at `../../scripts/` and docs at `../../docs/`
- when in doubt, resolve helper paths relative to this `SKILL.md` file first, then verify the target file exists before running it

Do not assume `scripts/...` is repo-local to the target codebase you are operating on.

## Authority and safety rules

Core safety rules (authoritative):

- Source code, tests, CI, and config are authoritative. The generated wiki is a navigation aid, not the source of truth.
- GitHub Issues are the backlog. Do not invent a parallel backlog file.
- Before any state-changing action, get explicit confirmation unless the user's latest message already clearly authorizes that action.
- Questions, preferences, future-tense statements, and implied approval are not confirmation. The bare response `ok` is not confirmation.
- State-changing actions include: local edits, commits, pushes, merges, rebases, branch deletion, issue assignment, label or milestone changes, PR reviews, thread resolution, workflow triggers, and publication.
- When handing work to Copilot, assign `copilot-swe-agent` directly, not `copilot`.
- Prefer single commands where practical. If the logic is too involved, write a temporary `.mjs` script under `tmp/` instead of building fragile shell sequences.
- For GitHub issue or PR comments, prefer `--body-file` / `-F` or stdin via `-F -` over inline shell strings.
- Keep scope tight to the issue/PR at hand.

Additional rules specific to this skill:
- Do not assign Copilot, create issues, or mutate GitHub state during the preflight or normalization phases without explicit confirmation.
- Do not proceed past the preflight gate if the work item is ambiguous or underspecified.
- Do not merge while Copilot review threads remain unresolved unless they are explicitly deferred with rationale by the user.
- When the preflight verdict is `pause_for_clarification`, ask the user the clarifying questions and stop. Do not attempt to guess through them.
- When the preflight verdict is `proceed_with_assumptions`, list all assumptions explicitly and get confirmation before continuing.
- If the current issue/PR state is materially unclear, contradictory, off-trail, or not cleanly covered by the deterministic helper/state-machine guidance, stop and ask for human direction rather than guessing.

## New-idea safety layer (default contract in this repo)

For **all new ideas** that are not already anchored to an existing issue (including abstract ideas such as plain-language requests without an issue number or plan-doc path), apply this coordinator-owned intake contract before any GitHub mutation:

- coordinator owns classification and mutation gating decisions
- run classification in fresh context by default
- run classification asynchronously when practical
- run async fan-out / fan-in proposal generation by default when practical
- emit a proposal artifact before any GitHub state-changing mutation, including create/edit/retitle/collapse/link operations
- default to create-new over overwrite/update when a new tracked artifact is justified
- do not repurpose/retitle/collapse/overwrite an existing issue unless that exact mutation is explicitly proposed and explicitly approved
- after approval, run a second async coordinator mutation pass instead of mutating directly from inherited context
- verify post-mutation artifact state and record what actually changed

Deterministic intake + mutation-gate state machine (proposal-first):

```text
idea_received
  -> fresh_context_started
  -> fanout_started
  -> fanin_complete
  -> artifact_scan_complete
  -> classified
  -> proposal_emitted
  -> awaiting_user_approval
  -> ready_for_mutation
  -> mutation_executed
  -> mutation_verified
  -> done

stop states:
- stopped_overlap_needs_decision
- stopped_low_confidence
- stopped_explicit_reject
```

`pause_for_clarification` remains the Phase 1 preflight gate and is evaluated before entering this intake state machine.

Proposal artifact contract (must exist before mutation):

- all proposal fields below are required before mutation
- human-readable Markdown proposal with:
  - idea summary
  - proposed classification
  - candidate target artifacts
  - overlap assessment
  - intended mutation
  - create-new recommendation
  - confidence/ambiguity notes
  - recovery hints
  - source inputs
- machine-readable JSON snapshot of the same required classification/proposal facts for deterministic pickup and recovery

Recoverability requirement:

- temporary artifacts are run-scoped working outputs
- write temporary artifacts under deterministic phase-scoped paths in `tmp/`
- path examples: `tmp/new-idea-intake/<run-id>/proposal.md` and `tmp/new-idea-intake/<run-id>/proposal.json`
- `<run-id>` should use a stable UTC execution identifier (`YYYYMMDDTHHMMSSZ`), such as:
  - `20260514T143022Z-issue-42`
  - `YYYYMMDDTHHMMSSZ-issue-<number>` when an issue exists
  - `YYYYMMDDTHHMMSSZ-idea` before issue creation
- temporary artifacts may be cleaned up after completion
- permanent artifacts are durable GitHub or repository records that persist independently of local temp files
- temporary artifacts (proposal markdown/json, fan-out outputs, fan-in output, local scans, mutation verification notes) should enable deterministic resume
- permanent artifacts (issues/labels/links/docs) must still support degraded-confidence recovery if temporary artifacts are missing

Mutation-pass contract after approval:

- consume the approved proposal as the mutation input
- perform only the approved mutation(s)
- record which GitHub artifacts were actually changed
- verify resulting artifact state
- emit a concise post-mutation verification artifact

## Autopilot authorization and automatic re-entry

Once the user has explicitly authorized unattended execution for a specific issue/PR scope, treat `copilot-autopilot` as permission to continue through the normal loop mutations for that scope without stopping at every intermediate phase boundary.

Under that unattended authorization:
- automatically detect the current lifecycle entrypoint from existing GitHub state before choosing a phase
- if a PR already exists for the issue, do **not** restart from assignment or earlier intake phases; interpret the current PR through the deterministic helper/state-machine surface and resume from that state
- if the PR is draft, enter the draft-stage PR tightening / local review / fix path automatically rather than stopping just because it has not left draft yet
- use the deterministic state graph as the authority for current-state routing and next-step selection, not ad hoc phase guessing
- continue unattended until the final approval gate unless you hit a genuine stop condition: `pause_for_clarification`, `review_request_unavailable`, `blocked_needs_user_decision`, unrelated CI failure needing maintainer judgment, or another ambiguity the contract explicitly forbids guessing through
- stop for human approval/merge by default once the final review verdict is ready; only merge unattended when the user has explicitly authorized unattended merge for the current issue/PR scope

If unattended authorization has **not** been given, keep the normal confirmation checkpoints below.

## Phase 1 — Preflight intake

Before any automation, run a preflight analysis of the input.

### Accepted input types

| Input type | Example |
| --- | --- |
| GitHub issue number or URL | `60`, `https://github.com/org/repo/issues/60` |
| Plan-doc path | `docs/plans/doc-validation.md` |
| Abstract roadmap idea | `@docs/PLAN.md ADR validation`, `"add rate limiting to the API"` |

### Preflight analysis checklist

For any input, answer these questions before proceeding:

1. **Smallest executable work item**: Can this be scoped to one PR? If not, what is the smallest slice?
2. **Existing issue check**: Does a matching GitHub issue already exist?
3. **Scope clarity**: Are the boundaries and non-goals of the work item unambiguous?
4. **Acceptance criteria**: Are there clear, verifiable acceptance criteria?
5. **Verification path**: Is there a concrete way to verify the work is done?
6. **Active PR check**: Is there already a PR for this work? If so, route to `copilot-dev-loop` PR follow-up mode instead.

### Preflight verdict

Choose one:

| Verdict | Condition | Next step |
| --- | --- | --- |
| `proceed` | All checklist items pass; scope is clear and self-contained | Continue to Phase 2 |
| `proceed_with_assumptions` | Minor gaps exist but reasonable assumptions are available | List assumptions explicitly; get confirmation; continue |
| `pause_for_clarification` | Scope is too vague, acceptance criteria missing, or work cannot fit in one PR | Ask clarifying questions; stop until answered |

Do not choose `proceed` or `proceed_with_assumptions` when:
- the work spans more than one coherent PR
- acceptance criteria are absent or unmeasurable
- there are significant open questions about approach or scope
- the input refers to a large roadmap section without a clear bounded slice

## Phase 2 — Input normalization

Normalize any non-issue input to a GitHub issue before entering the main execution loop.

### From a GitHub issue number or URL

1. Resolve the target repository and issue number first:
   - if the input is a full GitHub issue URL, parse `<owner/name>` and `<number>` from the URL and use that repo slug for the subsequent GitHub commands
   - if the input is a bare issue number, use the current repository slug
2. Fetch the issue with `gh issue view <number> --repo <owner/name> --json number,title,body,state,labels,assignees,milestone`.
3. If the issue is closed, stop for a user decision before proceeding (for example: reopen it when authorized, reference it and stop, or draft a follow-up issue).
4. If it is open, check whether a PR already exists for this issue via the deterministic linked-PR helper:
   ```sh
   node <resolved-skill-scripts>/github/detect-linked-issue-pr.mjs --repo <resolved-repo> --issue <number>
   ```
   - treat the helper output as authoritative for linked-PR detection/selection
   - do not re-implement linked-event query behavior, pagination, repo filtering, or tie-break logic in ad hoc markdown/prompt logic
   - do not rely only on PR title/body containing a literal issue number
   - treat an open linked PR reported by the helper as the active implementation for this issue
5. If a PR already exists, classify the post-assignment seam before follow-up:
   ```sh
   node <resolved-skill-scripts>/loop/detect-initial-copilot-pr-state.mjs --repo <resolved-repo> --issue <number>
   ```
   - `waiting_for_initial_copilot_implementation`: keep waiting and continue polling; do not enter PR tightening or local review/fix yet
   - `linked_pr_ready_for_followup`: route to the existing PR follow-up path immediately with that PR number
   - `no_linked_pr`: continue to Phase 3
6. If no linked PR exists, proceed to Phase 3 with this issue as the execution entry point.
7. Carry that resolved repo slug through every later GitHub issue/PR command for this execution so follow-up edits, PR actions, and merge steps stay scoped to the intended repository.

### From a plan-doc path

1. Resolve the target repository slug for this work item before any GitHub search or mutation:
   - default to the current repository slug
   - if the plan-doc reference explicitly points at another GitHub repository, parse or confirm that `<resolved-repo>` first
2. Read the planning document.
3. Identify the most specific bounded work item described.
4. Search GitHub issues for a matching title or reference: `gh issue list --repo <resolved-repo> --state all --search "<title keywords>"`.
5. If a matching issue exists:
   - fetch it with `gh issue view <number> --repo <resolved-repo> --json number,title,body,state,labels,assignees,milestone`
   - if the matching issue is closed, stop for a user decision before proceeding (for example: reopen it when authorized, reference it and stop, or draft a new follow-up issue)
    - if it is still open, run the same deterministic helper:
      ```sh
      node <resolved-skill-scripts>/github/detect-linked-issue-pr.mjs --repo <resolved-repo> --issue <number>
      ```
    - rely on that helper output rather than title/body number heuristics or re-implementing linked-event selection details in this skill text
    - if a PR already exists, classify bootstrap-wait versus follow-up:
      ```sh
      node <resolved-skill-scripts>/loop/detect-initial-copilot-pr-state.mjs --repo <resolved-repo> --issue <number>
      ```
    - if the state is `waiting_for_initial_copilot_implementation`, keep waiting and do not enter PR tightening/local review-fix yet
    - if the state is `linked_pr_ready_for_followup`, route immediately into the existing PR follow-up path instead of entering Phase 3 refinement again
    - otherwise confirm with the user and proceed with that issue
6. If no matching issue exists:
   - Draft a properly scoped issue body. At minimum include:
     - **Title** — concise and action-oriented
     - **Summary** — what the change does and why it is needed now
     - **Scope / context** — which files, components, or behaviors are in scope
     - **Acceptance criteria** — specific, testable, and observable conditions for done
     - **Non-goals** — explicit statements of what is out of scope
     - **Verification** — concrete steps or commands to prove the work is done
     - **Link** to the governing plan doc or roadmap reference when applicable
   - Show the draft to the user and get confirmation before creating the issue.
   - Create the issue only after confirmation: `gh issue create --repo <resolved-repo> --title "..." --body-file <tmpfile>`.
7. Proceed to Phase 3 with the confirmed issue.

### From an abstract roadmap idea

1. Parse the idea into a bounded work item candidate.
2. Run the preflight checklist (Phase 1) explicitly for this idea.
3. If the Phase 1 preflight verdict is `pause_for_clarification`, stop and ask.
4. Run the **New-idea safety layer** state machine above (proposal-first, coordinator-owned) before any GitHub mutation.
5. If the intake state machine stops at `stopped_overlap_needs_decision` or `stopped_low_confidence`, stop and ask.
6. If the intake state machine stops at `stopped_explicit_reject`, stop and record that the proposal was rejected; do not mutate GitHub.
7. Once the Phase 1 preflight verdict allows continuation, the intake state machine reaches proposal approval, and the user approves the proposal artifact, start a separate async coordinator mutation pass that consumes the approved proposal and emits a post-mutation verification artifact:
    - resolve `<resolved-repo>` for this work item using the same rule as the plan-doc path (default current repo unless the input explicitly targets another repository)
    - if a governing plan doc or roadmap section actually applies, follow the plan-doc normalization path above
    - otherwise search existing issues directly with `gh issue list --repo <resolved-repo> --state all --search "<title keywords>"`
    - if a matching issue exists, follow the issue-number/URL normalization path so open-state and existing-PR checks still run
    - if that matching issue turns out to be closed, stop for a user decision before reopening it or drafting follow-up work
    - if no matching issue exists, draft a properly scoped issue body using the same minimum sections required in the plan-doc path, show it to the user, and create the issue only after confirmation
    - record what the mutation pass actually changed and verify the resulting issue/artifact state before continuing into the normal execution loop

## Phase 3 — Async issue refinement

Before assigning Copilot, tighten the issue through an async refinement fan-out.

### Fan-out

Launch 2–4 parallel refinement passes, each with a distinct specialist angle:

| Pass | Focus |
| --- | --- |
| Scope | Are the boundaries tight? Is the scope the minimum needed? |
| Acceptance criteria | Are all criteria specific, testable, and observable? |
| Non-goals | Are the non-goals explicit enough to prevent scope creep? |
| Implementation slices | Can this be implemented in one clear PR, or does it need sequencing? |
| Risks | What are the edge cases, integration risks, or unknowns? |
| Verification | Is the verification path clear and concrete? |

For each pass:
- start in fresh context
- provide the issue number, current issue body, and a brief focus description
- ask the refinement pass (or an issue-refinement specialist, when available) to emit a structured suggestion: what to add, change, or remove in each section

### Fan-in

After all passes complete:
- merge the refinement suggestions into a single updated issue body
- resolve contradictions in favor of the narrowest, most verifiable interpretation
- keep the original author's intent intact; only tighten, do not rewrite the goal

### Issue update

Before updating the GitHub issue:
- show the diff between the original and updated issue body
- get explicit confirmation

After confirmation:
```sh
gh issue edit <number> --repo <resolved-repo> --body-file <updated-body-file>
```

## Phase 4 — Copilot handoff

After refinement, assign `copilot-swe-agent` to the issue.

Before assignment:
- summarize the issue one more time: number, title, acceptance criteria, non-goals, verification
- confirm the scope is still tight enough for one PR
- get explicit confirmation before assigning

Assignment:
```sh
gh issue edit <number> --repo <resolved-repo> --add-assignee copilot-swe-agent
```

Verify assignment:
```sh
gh issue view <number> --repo <resolved-repo> --json assignees
```

After assignment, wait for Copilot to open a draft PR. Use the deterministic watcher when available (see `copilot-dev-loop` async watch behavior for defaults).

When the draft PR appears, classify whether it is still the bootstrap-only Copilot draft or already a substantive implementation PR before entering PR tightening or local review/fix.

Useful check:
```sh
node <resolved-skill-scripts>/github/detect-linked-issue-pr.mjs --repo <resolved-repo> --issue <number>
```
If the helper returns an open linked PR in `<resolved-repo>`, run:
```sh
node <resolved-skill-scripts>/loop/detect-initial-copilot-pr-state.mjs --repo <resolved-repo> --issue <number>
```
- `waiting_for_initial_copilot_implementation`: keep waiting; do not enter draft-stage PR tightening or local review/fix yet
- `linked_pr_ready_for_followup`: resume from that PR and do not retrigger Copilot for the same scope

## Phase 5 — PR tightening

When the Copilot draft PR appears:

1. Inspect the PR title and body.
2. Apply the PR description contract from `copilot-dev-loop`:
   - summary
   - scope/context
   - acceptance criteria
   - definition of done
   - non-goals
   - link to the governing issue
3. If the PR body is thin or missing required sections, propose an improved body and get confirmation before editing:
   ```sh
   gh pr edit <pr-number> --repo <resolved-repo> --title "..." --body-file <body-file>
   ```
4. Inspect CI status and unresolved comments before leaving draft.

## Phase 6 — Local review/fix loop

Before marking the PR ready for review, run a local Pi review/fix pass using the `copilot-dev-loop` Step 7 follow-up loop plus the draft gate contract below. Delegation to `copilot-dev-loop` covers fix-loop mechanics only, not review-angle inheritance. Do **not** import the Step 7 pre-approval gate into this draft-stage pass.

Use the draft gate contract below as the authority for whether the PR is ready to leave draft via `gh pr ready`.

### Draft gate contract

This is the draft-stage gate for the draft → ready-for-review boundary.

- **Gate name:** Draft gate
- **Trigger / boundary:** right before running `gh pr ready` (draft → ready for review)
- **Review angles (owned by this gate):**
  - Correctness vs acceptance criteria
  - Scope compliance
  - Test coverage adequacy
  - CI and check status
  - No unrelated files
- **Pass criteria:** all five draft-gate angles pass; all must-fix findings are addressed or explicitly deferred with rationale; validation passes; no unrelated files are included.
- **Next step after passing:** mark the PR ready for review:
  ```sh
  gh pr ready <pr-number> --repo <resolved-repo>
  ```

Do **not** run DRY, KISS, or YAGNI at this gate. Those lenses belong exclusively to the pre-approval gate (Phase 7 below).

## Phase 7 — Copilot review loop

After marking the PR ready, drive the Copilot review → fix → re-review cycle.

Use the deterministic helpers from the resolved skill scripts directory:

**One-step detect → request → emit watch parameters:**
```sh
node <resolved-skill-scripts>/loop/copilot-pr-handoff.mjs --repo <resolved-repo> --pr <number>
```

When that helper returns `action: "watch"`, run `watch-copilot-review.mjs` with the emitted `watchArgs` rather than assuming the handoff command waited by itself.

Follow `copilot-dev-loop` Steps 5–7 exactly for:
- PR discovery and interpretation
- async watch behavior
- Pi review/fix follow-up loop

### Loop exit conditions

Exit the Copilot review loop only when **one** of:
- all Copilot review threads are resolved (addressed or explicitly deferred with rationale)
- the user explicitly authorizes merge despite unresolved threads and records the rationale
- a `review_request_unavailable` or `blocked_needs_user_decision` stop state is reached

Do **not** merge while Copilot review threads remain unresolved unless the user has explicitly deferred them with rationale.

### Pre-approval gate contract

This is the default pre-approval gate for this workflow boundary and owns the DRY, KISS, and YAGNI review angles.

- **Gate name:** Pre-approval gate
- **Trigger / boundary:** right before calling the PR review-complete, approval-ready, merge-ready, or ready for final handoff
- **Review angles (owned by this gate):**
  - DRY
  - KISS
  - YAGNI
- **Pass criteria:** DRY, KISS, and YAGNI lens passes are completed in fresh context and in parallel when practical; if parallel execution is impractical (for example due to tooling or resource constraints), still run all three lenses and explicitly record the limitation in the review verdict summary or a `tmp/copilot-loop/` handoff artifact.
- **Next step after passing:** continue to Phase 8 — Final independent review.

Do not make unrelated cleanup changes just because the branch is already open.

## Phase 8 — Final independent review

Before merge, run a final independent Pi review:

1. Start in fresh context.
2. Inspect:
   - all resolved Copilot threads (were they actually addressed?)
   - all deferred threads (is the rationale recorded?)
   - PR scope vs. issue acceptance criteria
   - CI status
   - final diff
3. Emit a clear verdict:
   - `approve` — issue satisfied, criteria met, threads resolved or deferred with rationale
   - `request-changes` — blocking findings remain
   - `needs-user-decision` — non-blocking concerns requiring user judgment

Report the verdict and get confirmation before submitting any formal GitHub review action.

## Phase 9 — Final approval gate and merge

After the final review verdict is `approve`, stop at the final approval gate by default.

Default behavior:
- report that the PR is ready for final human approval/merge
- do **not** merge unattended unless the user has explicitly authorized unattended merge for the current issue/PR scope

If final human approval is required, return a concise merge-ready summary and wait.

Only when merge has been explicitly authorized for this issue/PR scope:

1. Submit a formal GitHub review approval (if the PR was not opened by the active GitHub user):
   ```sh
   gh pr review <pr-number> --repo <resolved-repo> --approve --body "..."
   ```
2. Merge:
   ```sh
   gh pr merge <pr-number> --repo <resolved-repo> --squash --delete-branch
   ```
3. Verify the issue was closed by the merge (GitHub should close it automatically if the PR references the issue; otherwise close it manually).

## Workflow state overview

```text
input
  └─► preflight intake
        ├─► pause_for_clarification → ask user → stop
        ├─► proceed_with_assumptions → list assumptions → confirm → normalization
        └─► proceed → normalization
              └─► issue already has PR? → route to copilot-dev-loop PR follow-up mode
              └─► normalize to GitHub issue (find or create)
                    └─► async issue refinement (fan-out / fan-in)
                          └─► update issue body (confirm first)
                                └─► Copilot handoff (assign copilot-swe-agent)
                                      └─► wait for draft PR
                                            └─► PR tightening (title/body)
                                                  └─► local review/fix loop
                                                        └─► mark PR ready
                                                              └─► Copilot review loop
                                                                    └─► final independent review
                                                                          └─► final approval gate
                                                                                └─► approve + merge (only with explicit merge authorization)
```

## Confirmation checkpoints

Always stop and ask before:
- assigning `copilot-swe-agent` to an issue
- creating or editing a GitHub issue
- editing a PR title or body
- committing or pushing local fixes
- resolving review threads
- marking a PR ready for review
- requesting Copilot review
- submitting a formal GitHub review
- merging a PR

If the user has already explicitly authorized unattended end-to-end execution for the current issue/PR scope, treat that authorization as covering the normal loop mutations above except where a stop condition below still requires user judgment.

Unattended end-to-end execution does **not** imply unattended merge by default. Unless the user explicitly authorizes unattended merge for the current issue/PR scope, stop at the final approval gate for human approval/merge.

## Stop conditions

Stop and report instead of acting when:
- preflight verdict is `pause_for_clarification` (ask questions first)
- input refers to a work item that spans more than one coherent PR
- Copilot review requests are `unavailable` for the repository
- the loop reaches `blocked_needs_user_decision`
- scope has broadened beyond the original issue during execution
- any GitHub mutation is required but not yet authorized
- the run reaches the final approval gate and unattended merge was not explicitly authorized for the current issue/PR scope
- the workflow state is materially unclear, contradictory, off the expected trail, or not cleanly covered by the deterministic helper/state-machine guidance
- local facts, GitHub facts, and helper/state-machine output do not agree well enough to choose the next step confidently

A pre-existing PR for the issue is **not** a stop-by-default condition for this skill. It is a resumed-execution entrypoint: detect the current PR state through the deterministic helper/state-machine surface and continue from that state.

## Anti-patterns

Do not:
- proceed past preflight with vague or underspecified input
- create issues or assign Copilot without confirmation
- merge while unresolved Copilot threads exist unless explicitly deferred with rationale
- run the refinement fan-out as a single sequential pass instead of using parallel specialist passes
- skip the local review/fix loop before marking a PR ready
- assume Copilot review will be auto-requested after draft-to-ready; always request explicitly
- duplicate the state machine and watch logic from `copilot-dev-loop`; reuse it

## Recommended companion skills

- `copilot-dev-loop` — the core GitHub/Copilot loop this skill wraps; use it directly when you already have a refined, ready-to-assign issue
- `dev-loop` — when the user explicitly wants a local phase-based implementation path

## Adoption guidance

When a repository adopts this workflow as part of its standard execution model, document that decision in the repository's own `PLAN.md` (or equivalent planning doc) with at minimum:

- which input types will be the primary entry point (issue, plan-doc, or abstract idea)
- whether the preflight gate is operator-confirmed or semi-automated
- any repo-specific validation commands that should run in Phase 6 (local review/fix)
- the merge policy for deferred Copilot threads

This documents the repository's operating contract with this workflow so the behavior is traceable and recoverable.

## Output expectations

When using this skill, keep user-facing summaries concise and operational.

A good phase-transition summary should say:
- current phase and what was completed
- preflight verdict and rationale (Phase 1)
- which issue is the execution entry point and how it was found/created (Phase 2)
- what was changed in the issue body and why (Phase 3)
- current PR state and any blockers (Phases 5–8)
- what the next recommended action is
- whether authorization is needed before taking it

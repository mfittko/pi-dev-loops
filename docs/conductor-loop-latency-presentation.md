---
theme: default
title: Conductor loops and waiting-state automation
info: |
  A stakeholder-focused presentation about latency compression through conductor-led deterministic workflow orchestration.
class: text-center
transition: slide-left
mdc: true
layout: cover
background: https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1600&q=80
---

# Conductor loops
## Reduce delivery latency by owning waiting states

<div class="pt-6 text-lg opacity-90">
The biggest waste in software delivery is often the gap between one state change and the next action.
</div>

---
layout: section
---

# Executive summary
## The value is faster flow, not AI theater

---

# The company problem

Teams lose time in routine gaps such as:
- review arrived, nobody resumed
- CI turned green, PR stayed idle
- obvious remediation existed, but the loop stalled
- approval happened, the next slice did not start

These delays are usually coordination delays.
They accumulate into slower delivery.

---

# Why this matters to the business

Small waiting gaps compound into:
- longer cycle time
- more idle PR time
- more interrupted focus
- slower feedback loops
- lower throughput without better quality

The company cost is not one missed transition.
The cost is hundreds of missed transitions.

---

# What changes with a conductor

A conductor owns the workflow between steps.

It keeps track of:
- the current state
- the next safe transition
- active waits
- who or what is blocking progress
- when to resume automatically

That turns waiting from passive delay into an owned state.

---

# Human attention goes where it matters most

Humans stay focused on:
- architecture
- PRD and requirement shaping
- acceptance criteria and definition of done
- manual testing and exploratory validation
- risk and tradeoff decisions
- final approval and accountability

The conductor owns the predictable coordination work around those decisions.

---
layout: section
---

# The core mechanism
## A deterministic state machine

---

# Why the state machine is central

The state machine is the control surface.

It makes the workflow:
- visible
- inspectable
- resumable
- testable
- optimizable

Without it, teams fall back to memory, polling, and manual babysitting.

---

# Full workflow at a glance

1. intake and overlap scan
2. issue refinement and shaping
3. bounded slice planning
4. local implementation
5. draft PR
6. initial local fan-out review
7. ready-for-review transition
8. explicit Copilot request and review loop
9. final DIY DRY/KISS/YAGNI gate
10. human approval wait
11. merge
12. stop or resume the next slice

Waiting states remain part of the workflow, not gaps outside it.

---

# Key review choreography

The loop uses two different local review gates.

## Draft-stage fan-out
Checks:
- scope fit
- SRP / cohesion / boundaries
- acceptance criteria
- definition of done
- architecture fit
- test adequacy

## Final gate before approval
Checks:
- DRY
- KISS
- YAGNI

---

# State machine view

```mermaid {scale: 0.62}
stateDiagram-v2
    [*] --> intake_received

    intake_received --> overlap_scan_running
    overlap_scan_running --> issue_refinement_running: no blocking duplicate
    overlap_scan_running --> blocked_needs_human_decision: conflicting duplicate / unclear ownership

    issue_refinement_running --> proposal_or_slice_plan_running: scope understandable enough to shape
    issue_refinement_running --> waiting_for_scope_decision: issue too ambiguous / needs decision

    proposal_or_slice_plan_running --> ready_to_start_local_slice: bounded slice frozen
    proposal_or_slice_plan_running --> waiting_for_scope_decision: slice cannot be safely shaped

    waiting_for_scope_decision --> issue_refinement_running: clarification received
    waiting_for_scope_decision --> [*]: stop until human decision

    ready_to_start_local_slice --> kickoff
    kickoff --> active_local: kickoff continuity preserved
    kickoff --> blocked_needs_human_decision: missing authorization / tooling failure

    active_local --> draft_pr_open: slice integration-ready for draft PR
    draft_pr_open --> draft_stage_initial_local_fanout_running
    draft_stage_initial_local_fanout_running --> local_fix_loop: draft fan-out finds issues
    draft_stage_initial_local_fanout_running --> waiting_to_mark_ready_for_review: draft fan-out clean

    local_fix_loop --> active_local: fixes complete, re-verify locally
    waiting_to_mark_ready_for_review --> ready_for_review_transition
    ready_for_review_transition --> waiting_for_copilot_review: explicit ready-state Copilot request

    waiting_for_copilot_review --> copilot_fix_loop: actionable Copilot feedback
    waiting_for_copilot_review --> final_local_fanout_running: bounded convergence

    copilot_fix_loop --> local_fix_loop: apply narrow fixes
    final_local_fanout_running --> waiting_for_human_pr_approval: final gate clean
    final_local_fanout_running --> local_fix_loop: final fan-out finds issues

    waiting_for_human_pr_approval --> waiting_for_merge: human approves
    waiting_for_human_pr_approval --> draft_stage_initial_local_fanout_running: PR reset to draft

    waiting_for_merge --> post_merge_reconcile: merge detected
    post_merge_reconcile --> terminal_slice_complete: last planned step
    post_merge_reconcile --> post_merge_resume: concrete next step exists

    post_merge_resume --> ready_to_start_local_slice
    terminal_slice_complete --> [*]
    blocked_needs_human_decision --> [*]
```

---

# Deterministic tooling needed

To make this trustworthy, the system needs:
- explicit state transitions
- live conductor plus watcher ownership
- draft / ready / Copilot / approval / merge transitions
- visible PR-side state comments
- durable local state and closeout artifacts
- terminal vs resumable merge logic
- mid-flight steering and safe-point behavior
- reliable latest-turn grounding for operator control

This is what turns the pattern into infrastructure instead of ceremony.

---
layout: section
---

# Why this could be a company-scale gain
## The win is latency compression

---

# Expected impact

A conductor-led model should reduce:
- passive delay after state changes
- dropped handoffs
- stale PRs waiting for obvious next actions
- human polling and status babysitting
- context reload overhead between steps

That should improve:
- throughput
- review responsiveness
- slice-to-slice flow
- developer focus

---

# Pilot evidence already supports the direction

The live pilot already surfaced concrete gaps:
- owned state created without a live continuation path
- watcher-only ownership was insufficient
- draft / ready / approval states were misclassified
- mandatory review gates were skipped
- merge handling needed clearer terminal vs resume rules
- post-merge visibility varied by slice
- operator-question grounding failed in one case

That evidence is useful because it is specific and actionable.

---

# Rollout path

Start with bounded slices on real work.

- one conductor
- bounded workers
- explicit refinement and review gates
- visible PR-side state updates
- human approval retained
- deterministic closeout artifacts

That gives the company faster flow without giving up control.

---
layout: end
---

# Bottom line

The opportunity is simple:

## cut the dead time between one state change and the next action

That gives people more time for architecture, requirements, validation, and judgment.

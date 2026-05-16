---
marp: true
theme: default
paginate: true
title: Conductor loops and waiting-state automation
---

# Conductor loops
## Reduce delivery latency by owning waiting states

- Why the biggest waste is often **not coding time**
- Why a deterministic conductor can cut **dead time between state changes**
- Why humans should focus on **judgment**, not on babysitting workflow transitions

---

# The real problem

Most teams do not mainly lose time because every step is hard.

They lose time because the next step is already obvious, but nobody notices the state change quickly enough.

Examples:
- a review landed, but nobody resumed for hours
- CI turned green, but the PR stayed idle
- a fix was obvious, but the remediation loop stalled
- a draft was ready, but the ready-state transition never happened
- an approval happened, but the next slice did not start

---

# The hidden tax is waiting

The expensive part is often:
- waiting
- missing that waiting is over
- reloading context after idle gaps
- manually shepherding the next predictable transition

Each delay looks small in isolation.

Across many PRs, reviews, and loops, it compounds into:
- slower throughput
- more interrupted focus
- more stale work
- longer lead time with no real quality gain

---

# Core idea

Use a **conductor-led state machine** with deterministic tooling so that waiting states are explicitly owned.

The conductor should:
- know the current state
- know the next safe transition
- resume immediately when the state changes
- keep ownership through waits instead of silently dropping it

This is not just about automating coding.

It is about automating the **dead time around coding**.

---

# What humans should focus on

Humans should spend attention where human judgment matters most:
- architecture
- requirements and PRD shaping
- acceptance criteria and definition of done
- manual testing and exploratory validation
- business tradeoffs
- final approval and accountability gates

Humans should not have to spend most of their time on:
- polling status
- re-requesting predictable transitions
- watching CI turn green
- noticing routine review-state changes
- babysitting loops that already know the next step

---

# What the conductor should own

The conductor should own:
- state transitions
- waiting-state monitoring
- deterministic review choreography
- resume / attach / continue decisions
- visible state projection back to PRs and trackers
- safe stop vs resume decisions after merge

Workers can stay bounded.

The conductor keeps the orchestration truth.

---

# Workflow pattern

1. intake and refinement
2. bounded slice planning
3. local implementation
4. draft PR
5. initial local fan-out review
6. ready-for-review transition
7. explicit Copilot request and review loop
8. final DIY DRY/KISS/YAGNI gate
9. human approval wait
10. merge
11. stop or resume next slice

The key is that **waiting states are real states**, not invisible idle time.

---

# Review choreography matters

The loop should distinguish between two different local fan-out gates.

## Draft-stage fan-out
Focus on:
- SRP / cohesion / boundaries
- issue scope fit
- AC compliance
- DoD compliance
- architecture fit
- test adequacy

## Final pre-approval fan-out
Focus on:
- DRY
- KISS
- YAGNI

These are different gates with different purposes.

---

# Deterministic tooling required

To make this trustworthy, the loop needs deterministic tooling for:
- explicit conductor states and transitions
- draft / ready / Copilot / approval / merge transitions
- live conductor plus watcher ownership
- visible PR comments on meaningful local state changes
- durable local state and closeout artifacts
- terminal vs resumable merge decisions
- mid-flight steering and safe-point handling

Without these, the loop feels autonomous but is not actually reliable.

---

# Why this is a company-scale gain

In a company setting, people context-switch constantly.

That means the cost of missed state changes is much higher:
- more PRs in flight
- more reviewers
- more queues
- more partial waits
- more delays between a state change and the next obvious action

A conductor reduces that latency tax.

That can produce:
- shorter cycle time
- less idle PR time
- fewer dropped handoffs
- better developer focus

---

# The human value proposition

This is not:
- “AI replaces developers.”

This is:
- “AI owns the predictable coordination gaps.”

Humans keep:
- judgment
- design
- risk evaluation
- ambiguous decision points
- final accountability

The conductor owns:
- transitions
- waiting-state detection
- routine follow-through
- deterministic next-step orchestration

---

# Pilot evidence already shows the shape

Early pilot runs exposed real orchestration gaps, including:
- kickoff that created owned state but did not stay live
- watcher-only ownership not being enough
- draft / ready / approval states being misclassified
- missing mandatory review gates
- merge detection without clear stop vs resume semantics
- weak post-merge visibility in some slices

This is good evidence.

It means the missing pieces are now concrete and fixable.

---

# Why this is worth doing now

If we solve this well, we do not just save a few minutes.

We reduce one of the most expensive hidden problems in software delivery:

## passive delay after a state change

That means:
- fewer lost hours
- less human polling
- faster flow through reviews and fixes
- better use of expert attention

That is why this can be a real game changer.

---

# Practical rollout idea

Start with bounded slices and prove the loop on real work:
- one conductor
- bounded workers
- explicit review gates
- visible PR-side state comments
- manual approval retained
- deterministic closeout artifacts

Do not aim for magic autonomy first.

Aim for:
- trustworthy state ownership
- reliable waiting-state handling
- faster resume after every state change

---

# Bottom line

The goal is not just to automate implementation.

The goal is to eliminate the dead time between implementation steps.

If we do that well:
- developers focus on the work only humans should do
- the conductor owns the predictable coordination work
- delivery becomes faster without lowering quality

## The biggest win is latency compression.

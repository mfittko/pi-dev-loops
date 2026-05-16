---
theme: default
colorSchema: dark
title: A state-machine-driven shipping process
info: |
  Stakeholder presentation on reducing delivery latency with a deterministic shipping process.
class: text-center
transition: slide-left
mdc: true
layout: cover
---

# A state-machine-driven shipping process
## Reduce delivery latency by owning the work between steps

<div class="pt-6 text-lg opacity-90 max-w-3xl mx-auto leading-7">
The biggest waste in software delivery is often the gap between one state change and the next action.
</div>

<div class="pt-8 flex justify-center gap-3 flex-wrap">
  <span class="pill">state machine</span>
  <span class="pill">owned waiting states</span>
  <span class="pill">review loops</span>
  <span class="pill">human approval gates</span>
</div>

<style>
:root {
  --slidev-theme-primary: #8b5cf6;
}

.slidev-layout {
  background:
    radial-gradient(circle at top right, rgba(139, 92, 246, 0.20), transparent 28%),
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 24%),
    linear-gradient(180deg, #0b1020 0%, #0f172a 46%, #111827 100%);
  color: #e5e7eb;
}

.slidev-layout h1,
.slidev-layout h2,
.slidev-layout h3 {
  color: #f8fafc;
  letter-spacing: -0.02em;
}

.slidev-layout h1 {
  font-weight: 750;
}

.slidev-layout strong {
  color: #c4b5fd;
}

.slidev-layout p,
.slidev-layout li {
  line-height: 1.55;
}

.slidev-layout ul {
  margin-top: 0.65rem;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.8rem;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(167, 139, 250, 0.35);
  color: #ddd6fe;
  font-size: 0.9rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.glass-card {
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 22px;
  padding: 1.15rem 1.25rem;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
}

.soft-note {
  color: #cbd5e1;
  margin-top: 1rem;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.74rem;
  color: #93c5fd;
  margin-bottom: 0.4rem;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
}
</style>

---
layout: section
---

# Why this matters
## Faster shipping through owned waiting states

---

# The company problem

<div class="glass-card text-left max-w-4xl mx-auto">

Teams lose hours in routine gaps such as:
- review arrived, nobody resumed
- CI turned green, PR stayed idle
- a fix was clear, but the loop stalled
- approval happened, the next slice never started

<div class="soft-note">
Those gaps look small. Across a company, they become a large delivery tax.
</div>

</div>

---

# What is pi-dev-loops?

<div class="glass-card text-left max-w-4xl mx-auto">
<div class="kicker">Repository framing</div>

`pi-dev-loops` is a repository for reusable development loops.

It combines:
- deterministic tooling
- workflow skills
- review and control surfaces
- conductor-led orchestration

<div class="soft-note">
It exists to move work from intake to shipped outcome with a process that stays visible, resumable, and improvable.
</div>
</div>

---

# The core concept

<div class="glass-card text-left max-w-4xl mx-auto">
<div class="kicker">Shipping model</div>

Think of this as a **shipping process** built from explicit loops:
- refinement loops
- shaping loops
- implementation loops
- review and fix loops
- approval and closeout loops

<div class="soft-note">
The conductor keeps those loops connected. The shipping process is the product.
</div>
</div>

---

# Process ownership and human ownership

<div class="grid grid-cols-2 gap-8 pt-4 text-left">
<div class="glass-card">
<div class="kicker">Process ownership</div>

- intake and shaping
- local implementation flow
- review choreography
- waiting-state monitoring
- resume and continue decisions
- merge closeout and next-step routing

</div>
<div class="glass-card">
<div class="kicker">Human ownership</div>

- architecture
- PRD and requirement shaping
- acceptance criteria and definition of done
- manual testing and exploratory validation
- business tradeoffs
- final approval and accountability

</div>
</div>

<div class="soft-note text-left pt-3">
The process carries predictable coordination work so people can focus on judgment.
</div>

---
layout: section
---

# The required loops
## Shipping work means guiding it through the right loops at the right time

---

# The loop architecture

<div class="glass-card text-left max-w-4xl mx-auto">
<div class="kicker">Loop set</div>

A real shipping process needs multiple loops:
- refinement
- shaping
- implementation
- draft review
- Copilot review and fix
- final approval
- closeout or resume

<div class="soft-note">
Each loop solves a different delivery problem. The conductor keeps them connected.
</div>
</div>

---

# Flow 1: from intake to draft PR

```mermaid {scale: 0.76}
flowchart TD
    A[Intake] --> B[Refinement]
    B --> C[Slice plan]
    C --> D[Local implementation]
    D --> E[Draft PR]
```

<div class="soft-note">
This first half turns raw work into a bounded slice that is ready for formal review.
</div>

---

# Flow 2: from draft PR to shipped work

```mermaid {scale: 0.72}
flowchart TD
    A[Draft review] --> B[Ready]
    B --> C[Copilot request]
    C --> D[Copilot loop]
    D --> E[Final local gate]
    E --> F[Human approval wait]
    F --> G[Merge]
    G --> H[Closeout or resume]
```

<div class="soft-note">
The full operating model is a chain of loops rather than one flat automation step.
</div>

---

# Waiting states are the real bottleneck

<div class="glass-card text-left max-w-4xl mx-auto">

Most wasted time comes from the gaps around active work.

Typical waiting states:
- review waiting
- CI waiting
- approval waiting
- waiting for somebody to notice the state change

<div class="soft-note">
Owning those states is where the speedup comes from.
</div>
</div>

---

# Review choreography matters

<div class="grid grid-cols-2 gap-8 pt-4 text-left">
<div class="glass-card">
<div class="kicker">Early review loop</div>

- scope fit
- SRP / boundaries
- AC and DoD coverage
- architecture fit
- test adequacy

</div>
<div class="glass-card">
<div class="kicker">Final review loop</div>

- DRY
- KISS
- YAGNI

</div>
</div>

<div class="soft-note text-left pt-3">
Different loops answer different questions.
</div>

---

# Deterministic tooling is what makes it trustworthy

<div class="glass-card text-left max-w-4xl mx-auto">

The system needs deterministic tooling for:
- explicit states and transitions
- draft / ready / review / approval / merge transitions
- live ownership through waits
- visible PR-side state updates
- durable local state and closeout artifacts
- stop versus resume decisions after merge
- mid-flight steering

<div class="soft-note">
Without that, the process may look autonomous while staying unreliable.
</div>
</div>

---
layout: section
---

# Why this matters in a company
## The win is latency compression at scale

---

# Company impact

<div class="grid grid-cols-2 gap-8 pt-4 text-left">
<div class="glass-card">
<div class="kicker">Costs reduced</div>

- idle PR time
- dropped handoffs
- delayed resumes after reviews and CI
- context reload overhead
- manual status polling

</div>
<div class="glass-card">
<div class="kicker">Expected gains</div>

- shorter cycle time
- higher throughput
- faster review response
- better developer focus
- more predictable delivery

</div>
</div>

---

# Tracker-first hybrid model

<div class="grid grid-cols-2 gap-8 pt-4 text-left">
<div class="glass-card">
<div class="kicker">Tracker side</div>

- planning truth
- status truth
- priority and dependency context
- next bounded slice

</div>
<div class="glass-card">
<div class="kicker">Execution side</div>

- local worktrees handle implementation
- PRs handle review and merge
- merge updates tracker state
- the process resumes from tracker state

</div>
</div>

<div class="soft-note text-left pt-3">
That keeps planning, execution, and review connected.
</div>

---

# Why this differs from generic AI automation

<div class="glass-card text-left max-w-4xl mx-auto">

The real target is the dead time around judgment.

Judgment stays with people. The process removes the waiting around those decisions.

That means:
- humans spend more time deciding
- less time polling, nudging, and babysitting
- the process keeps work moving between meaningful decisions

</div>

---

# Practical rollout

<div class="glass-card text-left max-w-4xl mx-auto">

Start with bounded slices on real work.

- one conductor
- bounded workers
- explicit loops and review gates
- visible PR-side state comments
- manual approval retained
- deterministic closeout artifacts

<div class="soft-note">
The first goal is trustworthy flow through the loops. Magic autonomy can wait.
</div>
</div>

---
layout: end
---

# Bottom line

<div class="glass-card max-w-4xl mx-auto">
<div class="kicker">Bottom line</div>

## cut the dead time between one state change and the next action

<div class="pt-4 text-lg text-slate-300">
That gives people more time for architecture, requirements, validation, and judgment.
</div>
</div>

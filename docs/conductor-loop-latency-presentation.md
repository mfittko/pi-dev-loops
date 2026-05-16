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

<div class="hero-shell text-left">
  <div class="hero-grid">
    <div class="hero-main">
      <div class="kicker">Stakeholder presentation</div>
      <h1>A state-machine-driven shipping process</h1>
      <h2>Reduce delivery latency by owning the work between steps</h2>
      <div class="pt-5 text-lg opacity-90 max-w-2xl leading-7 text-slate-300">
        The biggest waste in software delivery is often the gap between one state change and the next action.
      </div>
      <div class="chip-row pt-7">
        <span class="pill">state machine</span>
        <span class="pill">owned waiting states</span>
        <span class="pill">review loops</span>
        <span class="pill">human approval gates</span>
      </div>
    </div>
    <div class="hero-side">
      <div class="mini-stat">
        <div class="mini-stat-label">Main claim</div>
        <div class="mini-stat-value">Compress the delay between state change and next action.</div>
      </div>
      <div class="mini-stat">
        <div class="mini-stat-label">Operating model</div>
        <div class="mini-stat-value">A conductor-linked chain of loops from intake through merge.</div>
      </div>
    </div>
  </div>
</div>

<style>
:root {
  --slidev-theme-primary: #8b5cf6;
}

.slidev-layout {
  background:
    radial-gradient(circle at 85% 12%, rgba(139, 92, 246, 0.24), transparent 24%),
    radial-gradient(circle at 15% 8%, rgba(59, 130, 246, 0.18), transparent 20%),
    radial-gradient(circle at 50% 100%, rgba(34, 197, 94, 0.08), transparent 26%),
    linear-gradient(180deg, #08101f 0%, #0b1220 42%, #0f172a 100%);
  color: #e5e7eb;
  position: relative;
  overflow: hidden;
}

.slidev-layout::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(180deg, rgba(255,255,255,0.28), transparent 72%);
}

.slidev-layout::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.035) 44%, transparent 58%);
  opacity: 0.65;
}

.slidev-layout > * {
  position: relative;
  z-index: 1;
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
  padding: 0.4rem 0.85rem;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(167, 139, 250, 0.35);
  color: #ddd6fe;
  font-size: 0.9rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(15, 23, 42, 0.18);
}

.chip-row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.glass-card {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.76), rgba(15, 23, 42, 0.64));
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 22px;
  padding: 1.15rem 1.25rem;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(10px);
}

.hero-shell {
  padding-top: 1.6rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.5fr 0.9fr;
  gap: 1.2rem;
  align-items: stretch;
}

.hero-main,
.hero-side,
.section-panel,
.diagram-card {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.62));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
}

.hero-main {
  border-radius: 28px;
  padding: 1.9rem 2rem;
}

.hero-side {
  border-radius: 28px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hero-main h1 {
  font-size: 2.55rem;
  line-height: 1.02;
  margin-top: 0.1rem;
}

.hero-main h2 {
  margin-top: 0.7rem;
  color: #cbd5e1;
  font-size: 1.25rem;
  font-weight: 500;
}

.mini-stat {
  border-radius: 20px;
  padding: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.72));
  border: 1px solid rgba(96, 165, 250, 0.16);
  text-align: left;
}

.mini-stat-label {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.72rem;
  color: #93c5fd;
  margin-bottom: 0.45rem;
}

.mini-stat-value {
  color: #e2e8f0;
  font-size: 1.02rem;
  line-height: 1.45;
}

.section-panel {
  max-width: 44rem;
  margin: 4.2rem auto 0;
  border-radius: 30px;
  padding: 2.1rem 2.4rem;
  text-align: left;
}

.section-panel h1 {
  margin-bottom: 0.55rem;
}

.section-panel p {
  color: #cbd5e1;
  font-size: 1.08rem;
}

.diagram-card {
  max-width: 52rem;
  margin: 0.9rem auto 0;
  border-radius: 26px;
  padding: 1rem 1.2rem 0.5rem;
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

<div class="section-panel">
  <div class="kicker">Opening case</div>
  <h1>Why this matters</h1>
  <p>Faster shipping through owned waiting states.</p>
</div>

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

<div class="section-panel">
  <div class="kicker">Operating model</div>
  <h1>The required loops</h1>
  <p>Shipping work means guiding it through the right loops at the right time.</p>
</div>

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

<div class="diagram-card">

```mermaid {scale: 0.76}
flowchart TD
    A[Intake] --> B[Refinement]
    B --> C[Slice plan]
    C --> D[Local implementation]
    D --> E[Draft PR]
```

</div>

<div class="soft-note">
This first half turns raw work into a bounded slice that is ready for formal review.
</div>

---

# Flow 2: from draft PR to shipped work

<div class="diagram-card">

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

</div>

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

<div class="section-panel">
  <div class="kicker">Business view</div>
  <h1>Why this matters in a company</h1>
  <p>The win is latency compression at scale.</p>
</div>

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

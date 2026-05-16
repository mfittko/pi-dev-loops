---
theme: default
colorSchema: dark
title: The conductor — owning the work between states
info: |
  Stakeholder presentation on reducing delivery latency with a conductor-led shipping process.
class: text-center
transition: slide-left
mdc: true
layout: cover
---

<div class="hero-shell text-left">
  <div class="hero-grid">
    <div class="hero-main">
      <div class="eyebrow">pi-dev-loops · leadership brief</div>
      <h1>Notice <em>latency</em>.</h1>
      <h2>The slow edge in delivery often starts after the work is already done.</h2>
      <p class="hero-copy">
        A PR changes state. A review arrives. CI turns green. Approval lands. Then the work waits for someone to notice.
      </p>
      <div class="chip-row">
        <span class="pill">state machine</span>
        <span class="pill">owned waiting states</span>
        <span class="pill">review loops</span>
        <span class="pill">human approval</span>
      </div>
    </div>
    <div class="hero-side">
      <div class="mini-stat">
        <div class="mini-stat-label">Core claim</div>
        <div class="mini-stat-value">Calendar time disappears in the gap between a signal firing and the next action.</div>
      </div>
      <div class="mini-stat accent-blue">
        <div class="mini-stat-label">Proposal</div>
        <div class="mini-stat-value">Let a conductor process carry work between states while people keep the decisions.</div>
      </div>
    </div>
  </div>
</div>

<style>
@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=Manrope:wght@400;500;600;700&display=swap');

:root {
  --slidev-theme-primary: #8b5cf6;
  --paper: #08101f;
  --paper-2: #0b1326;
  --panel: rgba(10, 17, 33, 0.78);
  --panel-2: rgba(14, 23, 42, 0.86);
  --ink: #f8fafc;
  --ink-2: #cbd5e1;
  --ink-3: #94a3b8;
  --line: rgba(148, 163, 184, 0.18);
  --line-soft: rgba(148, 163, 184, 0.10);
  --violet: #c4b5fd;
  --blue: #93c5fd;
  --green: #86efac;
  --rose: #fda4af;
}

.slidev-layout {
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background:
    radial-gradient(circle at 12% 10%, rgba(59, 130, 246, 0.16), transparent 20%),
    radial-gradient(circle at 85% 12%, rgba(139, 92, 246, 0.22), transparent 24%),
    radial-gradient(circle at 80% 88%, rgba(16, 185, 129, 0.10), transparent 22%),
    linear-gradient(180deg, #060b16 0%, #0a1224 50%, #0d152a 100%);
  color: var(--ink);
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
  background-size: 44px 44px;
  mask-image: linear-gradient(180deg, rgba(255,255,255,0.26), transparent 72%);
}

.slidev-layout > * {
  position: relative;
  z-index: 1;
}

.slidev-layout h1,
.slidev-layout h2,
.slidev-layout h3,
.slidev-layout .serif {
  font-family: 'Crimson Pro', Georgia, serif;
  color: var(--ink);
  letter-spacing: -0.02em;
}

.slidev-layout h1 {
  font-weight: 500;
}

.slidev-layout h2 {
  font-weight: 400;
}

.slidev-layout strong {
  color: var(--violet);
}

.slidev-layout p,
.slidev-layout li {
  line-height: 1.55;
}

.slidev-layout ul {
  margin-top: 0.6rem;
}

.slidev-layout em {
  color: var(--blue);
}

.eyebrow,
.kicker {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  color: var(--blue);
  font-weight: 700;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.42rem 0.9rem;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.74);
  border: 1px solid rgba(167, 139, 250, 0.34);
  color: #ddd6fe;
  font-size: 0.88rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 28px rgba(0, 0, 0, 0.18);
}

.chip-row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-top: 1.65rem;
}

.hero-shell {
  padding-top: 1.5rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.45fr 0.85fr;
  gap: 1.2rem;
  align-items: stretch;
}

.hero-main,
.hero-side,
.glass-card,
.diagram-card,
.quote-card,
.section-panel {
  background: linear-gradient(180deg, rgba(12, 19, 35, 0.80), rgba(9, 16, 30, 0.68));
  border: 1px solid var(--line);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.30);
  backdrop-filter: blur(14px);
}

.hero-main {
  border-radius: 30px;
  padding: 2rem 2rem 1.9rem;
}

.hero-main h1 {
  font-size: 3.6rem;
  line-height: 0.98;
  margin: 0.5rem 0 0;
}

.hero-main h2 {
  margin: 0.9rem 0 0;
  color: var(--ink-2);
  font-size: 1.35rem;
  max-width: 23ch;
}

.hero-copy {
  margin-top: 1.2rem;
  max-width: 32ch;
  color: var(--ink-2);
  font-size: 1.03rem;
}

.hero-side {
  border-radius: 30px;
  padding: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.mini-stat {
  border-radius: 22px;
  padding: 1rem 1rem 1.05rem;
  background: linear-gradient(180deg, rgba(18, 28, 48, 0.92), rgba(11, 19, 35, 0.82));
  border: 1px solid rgba(196, 181, 253, 0.18);
  text-align: left;
}

.mini-stat.accent-blue {
  border-color: rgba(147, 197, 253, 0.22);
}

.mini-stat-label {
  text-transform: uppercase;
  letter-spacing: 0.13em;
  font-size: 0.72rem;
  color: var(--blue);
  margin-bottom: 0.45rem;
  font-weight: 700;
}

.mini-stat-value {
  color: var(--ink);
  font-size: 1rem;
  line-height: 1.45;
}

.section-panel {
  max-width: 46rem;
  margin: 4rem auto 0;
  border-radius: 30px;
  padding: 2rem 2.35rem;
  text-align: left;
}

.section-panel h1 {
  margin: 0.45rem 0 0;
  font-size: 2.4rem;
}

.section-panel p {
  color: var(--ink-2);
  margin-top: 0.7rem;
  font-size: 1.08rem;
}

.glass-card {
  border-radius: 24px;
  padding: 1.15rem 1.25rem;
}

.quote-card {
  max-width: 48rem;
  margin: 1rem auto 0;
  border-radius: 28px;
  padding: 1.7rem 1.8rem;
  text-align: left;
}

.quote-card blockquote {
  margin: 0;
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 2rem;
  line-height: 1.15;
  color: var(--ink);
}

.quote-card .attribution {
  margin-top: 0.95rem;
  color: var(--ink-3);
  font-size: 0.88rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.diagram-card {
  max-width: 52rem;
  margin: 0.9rem auto 0;
  border-radius: 26px;
  padding: 1rem 1.2rem 0.5rem;
}

.diagram-caption,
.soft-note {
  color: var(--ink-2);
  margin-top: 1rem;
}

.diagram-caption {
  max-width: 50rem;
  margin-left: auto;
  margin-right: auto;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.9rem;
  align-items: start;
  text-align: left;
  padding-top: 0.8rem;
}

.diagram-caption .num {
  color: var(--blue);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.7rem;
  font-weight: 700;
}

.diagram-caption .cap {
  color: var(--ink-2);
  font-size: 0.92rem;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
}

.twocol {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  text-align: left;
  margin-top: 0.9rem;
}

.twocol .glass-card {
  min-height: 100%;
}

.twocol h3 {
  margin: 0 0 0.6rem;
  font-size: 1.45rem;
}

.rule-note {
  margin-top: 0.9rem;
  color: var(--ink-2);
  text-align: left;
}

.pull-line {
  width: 84px;
  height: 1px;
  background: linear-gradient(90deg, var(--blue), transparent);
  margin-bottom: 1rem;
}

.tight-list li {
  margin-bottom: 0.2rem;
}
</style>

---
layout: section
---

<div class="section-panel">
  <div class="eyebrow">Opening case</div>
  <h1>Where delivery time goes</h1>
  <p>Most calendar time disappears after a state change and before the next human action.</p>
</div>

---

# A normal PR burns time in the gaps

<div class="glass-card text-left max-w-4xl mx-auto">
  <p class="serif text-2xl leading-8 m-0 text-slate-100">
    An engineer opens a PR at 10:00. A review lands at 11:14. The author sees it at 14:28.
  </p>
  <p class="pt-4 text-slate-300">
    None of that delay came from architecture, implementation, or review quality. The work sat in a notification queue.
  </p>
</div>

<div class="twocol pt-5">
  <div class="glass-card">
    <div class="kicker">Signals</div>
    <ul class="tight-list">
      <li>review posted</li>
      <li>CI passed</li>
      <li>approval granted</li>
      <li>merge possible</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">Observed delay</div>
    <ul class="tight-list">
      <li>waiting for the author to notice</li>
      <li>waiting for CI to be checked</li>
      <li>waiting for somebody to merge</li>
      <li>waiting for tracker closeout</li>
    </ul>
  </div>
</div>

---

<div class="quote-card">
  <div class="pull-line"></div>
  <blockquote>Humans don’t subscribe to events. We poll.</blockquote>
  <div class="attribution">Why latency shows up in every queue</div>
</div>

<div class="soft-note max-w-3xl mx-auto text-left pt-6">
  A pipeline can be event-driven. The consumer of those events is still a person checking tabs, notifications, and CI dashboards in batches.
</div>

---

# What is pi-dev-loops?

<div class="glass-card text-left max-w-4xl mx-auto">
  <div class="kicker">Repository framing</div>
  <p class="serif text-2xl leading-8 mt-2 mb-4 text-slate-100">A repository for reusable development loops.</p>
  <ul>
    <li>deterministic tooling</li>
    <li>workflow skills</li>
    <li>review and control surfaces</li>
    <li>conductor-led orchestration</li>
  </ul>
  <div class="soft-note">
    The repo turns delivery loops into something visible, resumable, and improvable.
  </div>
</div>

---
layout: section
---

<div class="section-panel">
  <div class="eyebrow">Operating model</div>
  <h1>The conductor carries work between decisions</h1>
  <p>Judgment stays with people. Coordination follows the state machine.</p>
</div>

---

# Coordination belongs in the middle lane

<div class="twocol pt-3">
  <div class="glass-card">
    <div class="kicker">Conductor lane</div>
    <h3>Mechanical work</h3>
    <ul>
      <li>listen for state transitions</li>
      <li>own the review, CI, and approval waits</li>
      <li>post visible status updates</li>
      <li>route the next loop</li>
      <li>advance tracker state after merge</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">Human lane</div>
    <h3>Judgment work</h3>
    <ul>
      <li>requirements and acceptance criteria</li>
      <li>architecture and tradeoffs</li>
      <li>review comments and approval</li>
      <li>manual validation</li>
      <li>final merge decision</li>
    </ul>
  </div>
</div>

<div class="rule-note">
  Ambiguity at that line is a design bug.
</div>

---

# The loop set

<div class="glass-card text-left max-w-4xl mx-auto">
  <div class="kicker">Loop architecture</div>
  <ul class="tight-list">
    <li>refinement</li>
    <li>slice shaping</li>
    <li>local implementation</li>
    <li>draft review</li>
    <li>Copilot review and fix</li>
    <li>final local approval</li>
    <li>closeout or resume</li>
  </ul>
  <div class="soft-note">
    Each loop solves one delivery problem. The conductor keeps the chain moving.
  </div>
</div>

---

# Figure 1 · intake to draft PR

<div class="diagram-card">

```mermaid {scale: 0.76}
flowchart TD
    A[Intake] --> B[Refinement]
    B --> C[Slice plan]
    C --> D[Local implementation]
    D --> E[Draft PR]
```

</div>

<div class="diagram-caption">
  <span class="num">Figure 1</span>
  <span class="cap">The first half turns raw work into a bounded slice that can enter formal review.</span>
</div>

---

# Figure 2 · draft PR to shipped work

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

<div class="diagram-caption">
  <span class="num">Figure 2</span>
  <span class="cap">The second half carries work across the waits that usually vanish into calendar time.</span>
</div>

---

# Review gates answer different questions

<div class="twocol pt-3">
  <div class="glass-card">
    <div class="kicker">Early gate</div>
    <h3>Should this PR exist?</h3>
    <ul>
      <li>scope fit</li>
      <li>SRP and boundaries</li>
      <li>AC and DoD coverage</li>
      <li>architecture fit</li>
      <li>test adequacy</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">Final gate</div>
    <h3>Should this ship now?</h3>
    <ul>
      <li>DRY</li>
      <li>KISS</li>
      <li>YAGNI</li>
    </ul>
  </div>
</div>

---

# Deterministic tooling keeps the loop trustworthy

<div class="glass-card text-left max-w-4xl mx-auto">
  <div class="kicker">Required capabilities</div>
  <ul>
    <li>explicit states and transitions</li>
    <li>live ownership through waits</li>
    <li>visible PR-side state updates</li>
    <li>durable local state and closeout artifacts</li>
    <li>stop versus resume rules after merge</li>
    <li>mid-flight operator steering</li>
  </ul>
</div>

---
layout: section
---

<div class="section-panel">
  <div class="eyebrow">Business view</div>
  <h1>Leadership gets time back at scale</h1>
  <p>The win shows up as lower queueing cost, cleaner handoffs, and faster cycle time.</p>
</div>

---

# Company impact

<div class="twocol pt-3">
  <div class="glass-card">
    <div class="kicker">Costs reduced</div>
    <ul>
      <li>idle PR time</li>
      <li>dropped handoffs</li>
      <li>delayed resumes after reviews and CI</li>
      <li>manual status polling</li>
      <li>context reload overhead</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">Expected gains</div>
    <ul>
      <li>shorter cycle time</li>
      <li>higher throughput</li>
      <li>faster review response</li>
      <li>better developer focus</li>
      <li>more predictable delivery</li>
    </ul>
  </div>
</div>

---

# Tracker-first hybrid loop

<div class="twocol pt-3">
  <div class="glass-card">
    <div class="kicker">Tracker side</div>
    <h3>Planning truth</h3>
    <ul>
      <li>priority and dependency context</li>
      <li>status truth</li>
      <li>next bounded slice</li>
      <li>portfolio visibility</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">Execution side</div>
    <h3>Shipping loop</h3>
    <ul>
      <li>local worktrees handle implementation</li>
      <li>PRs handle review and merge</li>
      <li>merge updates tracker state</li>
      <li>the process resumes from the next tracker state</li>
    </ul>
  </div>
</div>

---

# Non-goals keep the design credible

<div class="twocol pt-3">
  <div class="glass-card">
    <div class="kicker">Out of scope</div>
    <ul>
      <li>removing humans from review</li>
      <li>merging without approval</li>
      <li>pretending judgment can be automated away</li>
      <li>selling velocity claims before the data exists</li>
    </ul>
  </div>
  <div class="glass-card">
    <div class="kicker">In scope</div>
    <ul>
      <li>own the waits</li>
      <li>advance work the moment a state ends</li>
      <li>leave a visible audit trail</li>
      <li>keep a clean kill switch</li>
    </ul>
  </div>
</div>

---

<div class="quote-card">
  <div class="pull-line"></div>
  <blockquote>Tooling that hears state transitions for us gives people back the time they came to spend on judgment.</blockquote>
  <div class="attribution">What the investment buys</div>
</div>

---
layout: end
---

<div class="section-panel">
  <div class="eyebrow">Bottom line</div>
  <h1>Cut the dead time between one state change and the next action.</h1>
  <p>Spend the recovered time on requirements, architecture, validation, and decisions that still need a person.</p>
</div>

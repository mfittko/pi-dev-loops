# Copilot instructions for `pi-dev-loops`

This repository is **declutter-first** and **canonical-over-compatibility**.

Treat the following as non-negotiable unless the user explicitly approves an exception in the current conversation or issue/PR scope.

## Core posture

- Prefer **removing** outdated, duplicate, or compatibility-only surface area over keeping it around.
- Do **not** preserve legacy names, aliases, wrappers, shims, duplicate docs, or duplicate tests by default.
- When choosing between a clean canonical replacement and legacy support, choose the clean canonical replacement.
- `dev-loop` is the single public workflow entrypoint; do not grow parallel workflow surfaces when routing, parameters, or thinner internal layers can express the same behavior.

## Main design principles

Apply these principles across code, scripts, workflow surfaces, prompts, and documentation:

- **KISS** — prefer the simplest design that honestly covers the current need
- **SRP** — each module, helper, script, or doc should have one clear job and one clear owner
- **YAGNI** — do not add speculative flexibility, extra layers, future-proofing seams, or optionality without current evidence
- **DRY** — avoid repeated logic, repeated workflow prose, repeated state vocabulary, and repeated authority statements
- **Canonical ownership** — one clear source of truth per behavior, contract, or rule; callers should import/reference the owner instead of copying it
- **Thin glue** — keep runtime wrappers, CLI entrypoints, and adapter layers small; push durable logic into the real owner
- **Deterministic behavior** — prefer explicit, testable, machine-checkable logic over ambiguous prompt-only branching or duplicated narrative guidance
- **Strict boundaries** — separate pure state/contract logic from operational adapters such as GitHub calls, process spawning, or presentation formatting
- **Documentation discipline** — durable docs should capture lasting truth, not temporary reasoning or PR-local analysis
- **Net simplification** — each change should make the repo easier to understand, maintain, or operate; if it adds more surface area than it removes, reconsider it

## Compatibility guidance

- The phrase **"compatibility"**, **"compatibility shim"**, or **"keep it for compatibility"** is **not** sufficient justification by itself.
- Keep an extra seam only when there is a **concrete active present-day consumer** that still requires it.
- If a seam is kept, name the exact current consumers and keep the seam as thin as possible.
- If the justification is only precautionary, speculative, historical, or "just in case", remove/collapse it instead.

## Code and documentation efficiency

Treat both code efficiency and documentation efficiency as required constraints:

- avoid adding a new layer, wrapper, helper, export, adapter, or module unless it removes more complexity than it adds
- avoid adding durable documentation that mainly records temporary analysis, PR-local reasoning, or issue-local evaluation
- keep contract docs focused on lasting contract truth, not transient cleanup rationale
- prefer putting temporary evaluation detail in the issue, PR description, or review comments rather than expanding durable contract docs
- when a small code change is enough, do not pad the slice with broad explanatory doc additions

## Declutter / YAGNI review rules

When working on delete-first, declutter, seam-reduction, or architecture-cleanup issues:

- prefer net-negative changes in file count, seam count, and duplicated logic
- challenge additions that preserve extra vocabulary layers, translation layers, or compatibility projections without active need
- if a reviewer or issue comment flags something as YAGNI/overreach, respond by **narrowing** the change, not by defending extra surface area unless there is clear active-consumer evidence
- do not keep "useful" explanatory text in durable docs unless it is part of the lasting contract readers will need after the PR is merged

## Durable docs authority

- Keep one concise canonical owner for each lasting rule.
- Do not restate the same authority across multiple docs just because it is convenient in the current PR.
- If a durable doc must change, make the smallest lasting update needed for accuracy.

## Preferred shape of solutions

Favor:
- smaller pure modules
- clearer ownership boundaries
- thin adapters and runtime glue
- explicit active-consumer justification for anything retained

Avoid:
- broad compatibility retention
- parallel prompt/workflow surfaces
- oversized contract prose added to justify a small code change
- speculative abstractions or helper buckets

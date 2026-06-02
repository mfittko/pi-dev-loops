---
name: issue-intake
description: >-
  Internal routed strategy behind `dev-loop` for issue-first intake.
  Merged into copilot-pr-followup; this file is a thin redirect.
compatibility: Pi skill for git+GitHub repositories.
allowed-tools: read bash edit write subagent review_loop
user-invocable: false
---

# Issue Intake (redirect)

This skill has been merged into [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md).

The public `dev-loop` router still maps `issue_intake` to this skill name, but all
issue-first intake procedure now lives in `copilot-pr-followup` under the
**Issue-first intake and durable-auto overlays** section.

When this skill is loaded, immediately redirect to [Copilot PR Follow-up Skill](../copilot-pr-followup/SKILL.md)
and follow its procedure. For issue-refinement work on the redirected `issue_intake`
route, invoke the `refiner` agent directly for both the parallel fan-out steps and
the consolidation/fan-in step; do not route those review-only refinement steps
through `dev-loop` + `local_implementation`. The `issue_intake` routing still
differentiates from `copilot_pr_followup` in the public router; this redirect
preserves that contract while keeping the procedure text canonical in one file.

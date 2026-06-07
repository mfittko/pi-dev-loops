# Entrypoint briefing: Issue intake

State vocabulary: `waiting_for_initial_copilot_implementation`, `needs_refinement`, `ready_needs_assignment_confirmation`, `ready_assign_now`, `assigned_to_copilot`

Next-action sentence: "Resolve issue readiness, handle assignment seam, then bootstrap PR creation or wait for Copilot implementation."

Helpers to run first:
1. `dev-loops loop linked-issue-pr --repo <owner/name> --issue <N>` — resolve issue↔PR linkage
2. `dev-loops loop startup` — resolve routing

Required reading:
- [Public Dev Loop Contract](public-dev-loop-contract.md)
- [Issue Intake Procedure](issue-intake-procedure.md)
- [Confirmation rules](confirmation-rules.md)
- [Stop conditions](stop-conditions.md)

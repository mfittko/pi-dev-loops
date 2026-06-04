# Entrypoint briefing: Copilot PR follow-up

State vocabulary: `waiting_for_initial_copilot_implementation`, `waiting_for_copilot_review`, `review_feedback_received`, `linked_pr_ready_for_followup`, `blocked_needs_user_decision`

Next-action sentence: "Load PR state from `detect-copilot-loop-state.mjs`, resolve gate coordination, then execute the appropriate follow-up action (fix, review, wait, or escalate)."

Helpers to run first:
1. `node scripts/loop/detect-copilot-loop-state.mjs --repo <owner/name> --pr <N>` — resolve loop state
2. `node scripts/loop/detect-pr-gate-coordination-state.mjs --repo <owner/name> --pr <N>` — resolve gate state
3. `node scripts/github/upsert-checkpoint-verdict.mjs` — post/update gate comments

Required reading:
- [Public Dev Loop Contract](public-dev-loop-contract.md)
- [Copilot Loop Operations](copilot-loop-operations.md)
- [Confirmation rules](confirmation-rules.md)
- [Stop conditions](stop-conditions.md)
- [Validation policy](validation-policy.md)

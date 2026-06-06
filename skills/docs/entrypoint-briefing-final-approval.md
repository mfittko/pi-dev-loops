# Entrypoint briefing: Final approval

State vocabulary: `approval_ready`, `merge_ready`, `waiting_for_merge_authorization`

Next-action sentence: "Verify pre_approval_gate evidence, confirm CI green + resolved threads, then request explicit merge authorization."

Helpers to run first:
1. `dev-loops gate detect-evidence --repo <owner/name> --pr <N>` — verify gate evidence
2. `dev-loops gate upsert-verdict` — post pre_approval_gate

Required reading:
- [Public Dev Loop Contract](public-dev-loop-contract.md)
- [Final Approval SKILL](../final-approval/SKILL.md)
- [Merge preconditions](merge-preconditions.md)
- [Confirmation rules](confirmation-rules.md)

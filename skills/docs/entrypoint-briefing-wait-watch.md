# Entrypoint briefing: Wait / watch

State vocabulary: `waiting`, `waiting_for_initial_copilot_implementation`, `waiting_for_copilot_review`

Next-action sentence: "Enter healthy-watch mode with configured timeout; escalate only on genuine blocked/authorization/reconcile states."

Helpers to run first:
1. `dev-loops loop watch-initial --repo <owner/name> --issue <N>` — bootstrap watcher
2. `dev-loops loop watch-cycle --repo <owner/name> --pr <N>` — cycle watcher

Required reading:
- [Public Dev Loop Contract](public-dev-loop-contract.md)
- [Copilot Loop Operations](copilot-loop-operations.md)
- [Stop conditions](stop-conditions.md)

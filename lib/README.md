# Shared library area

This directory is reserved for deterministic shared modules used by multiple dev-loop skills and scripts.

It also now houses the shared deterministic `dev-loops` command core used by both:
- the Pi extension `/dev-loops ...`
- the shell CLI `pi-dev-loops ...`

Planned areas:

- `github/` — PR, issue, review, checks, and Copilot state helpers
- `loop/` — timeout policy, artifact layout, restart state, and cleanup helpers
- `agents/` — shared prompt fragments or agent-support helpers only if they prove necessary

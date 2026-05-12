# Shared script area

This directory is reserved for deterministic workflow entrypoints.

Scripts here should prefer:

1. native `gh ... watch` support when it matches the exact wait condition,
2. shared `lib/` helpers for state parsing and decision logic,
3. stable machine-readable output for skills and async workflows.

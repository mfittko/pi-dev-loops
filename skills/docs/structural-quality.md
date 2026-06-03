# Structural quality

Canonical owner for structural quality standards across all workflow families.

## Core principles

- **KISS**: Keep implementations simple; prefer thin glue over thick abstraction
- **SRP**: Single Responsibility Principle — one reason to change per module
- **YAGNI**: Don't add speculative features, compatibility shims, or unused abstractions
- **Strict TypeScript**: No `any`, no implicit coercion, explicit return types

## Deep review standards

Apply these during implementation (not just review):

1. **Cohesion**: Related functionality lives together; unrelated functionality is separated
2. **Coupling**: Minimize dependencies between modules; prefer explicit injection over globals
3. **Error handling**: All error paths are explicit and tested; no silent failures
4. **Testability**: Every public function is independently testable; no hidden state
5. **Naming**: Names describe what, not how; consistent vocabulary across codebase

## Anti-patterns to avoid

- Over-engineering: adding abstraction layers "just in case"
- Copy-paste duplication: extracting shared logic too late
- Magic values: undocumented constants or configuration
- God modules: single file doing too many unrelated things

## Cross-references

- [Anti-patterns](anti-patterns.md)
- [Validation policy](validation-policy.md)

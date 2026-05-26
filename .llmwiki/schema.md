# LLM Wiki Schema

This file defines how this repository is compiled into GitHub Wiki pages by repo-wiki.

## Source of truth

The repository at the pinned Git commit is authoritative. Generated wiki pages are derived artifacts.

## Required generated pages

- Home.md
- _Sidebar.md
- Index.md
- Log.md
- Agent-Context-Pack.md
- Repository-Overview.md
- Architecture.md
- Build-Test-and-Run.md
- Open-Questions.md
- Documentation-Debt-Report.md

## Source traversal

- `source.exclude` is a path-oriented filter, not a full glob engine.
- Exact paths and directory-style patterns such as `tmp/**` are supported.
- Nested Git repository/worktree roots are suppressed by default and can be re-enabled with `source.suppress_nested_repositories=false`.

## Documentation ingestion

Markdown documentation is ingested as secondary evidence by default. It can reveal intent and terminology, but operational or behavioral claims should be validated against code, tests, CI, configuration, or generated schemas. Stale or contradicted markdown is reported by `repo-wiki lint-docs`.

## Rules

- Prefer updating existing pages over creating new pages.
- Preserve marked human-maintained sections.
- Add uncertain claims to Open-Questions.md.
- Cite source paths for material claims.
- Do not copy secrets, tokens, private keys, or .env values.

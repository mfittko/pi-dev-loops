# Audit Copilot Comments

Script: `scripts/github/audit-copilot-comments.mjs`

## Purpose

Scan all pull-request review comments in a repository via the GitHub REST API, filter to Copilot-authored comments, classify them into workflow-category buckets, and produce a JSON summary and a Markdown report. The output is designed to inform draft-gate persona decisions: which recurring comment categories should be caught by a deterministic gate review rather than consuming Copilot review budget.

## Usage

```bash
node scripts/github/audit-copilot-comments.mjs --repo <owner/name> [--output-dir <path>] [--sleep-ms <ms>] [--checkpoint-file <path>] [--resume] [--save-uncategorized]
```

### Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `--repo` | yes | — | Repository slug (e.g. `mfittko/pi-dev-loops`) |
| `--output-dir` | no | `tmp/investigation` | Directory for JSON and Markdown output files |
| `--sleep-ms` | no | `0` | Sleep this many ms between top-level fetches (non-negative int) |
| `--checkpoint-file` | no | — | Save/load coarse-grain checkpoint for resume |
| `--resume` | no | `false` | Resume from checkpoint (requires `--checkpoint-file`) |
| `--save-uncategorized` | no | `false` | Also write `uncategorized-comments.json` containing only comments where `primaryCategoryId === null` |
| `--help`, `-h` | no | — | Print usage and exit |

### Checkpoint stages

| Stage | What's saved | Resume behavior |
|---|---|---|
| `after-comments` | Comments fetched, saved | Re-fetch only PRs, then complete |
| `after-prs` | Both fetched, saved | Skip both fetches, rebuild summary from checkpoint |

Checkpoint corruption (missing file, invalid JSON, missing stage): `--resume` falls back to a fresh fetch.

### Resilience

- **403 (rate limit)** and **429 (secondary rate limit)** responses trigger exponential backoff: up to 5 retries, 1 s base delay.
- **401 (authentication)** fails immediately with no retry.
- **`gh` not authenticated**: fails immediately.

## Output

Default run writes two files to `--output-dir`:

| File | Description |
|---|---|
| `copilot-comment-summary.json` | Full structured JSON with totals, categories, recommendations, and per-comment classifications |
| `copilot-comment-categories.md` | Human-readable Markdown report with top-category table, priority-ranked recommendations, and category details |

With `--save-uncategorized`, the audit also writes:

| File | Description |
|---|---|
| `uncategorized-comments.json` | Array of only uncategorized comments, preserving `body`, `prNumber`, `path`, `line`, `htmlUrl`, and `excerpt` |

Stdout also emits the same JSON summary.

## LLM classification of uncategorized comments

Script: `scripts/github/classify-uncategorized-comments.mjs`

Use this one-off follow-up after `--save-uncategorized` to cluster uncategorized Copilot review comments with an LLM:

```bash
node scripts/github/classify-uncategorized-comments.mjs --model <model> [--provider openai-compatible|anthropic] [--api-key <key>] [--base-url <url>] [--input <path>] [--output-dir <path>] [--use-full-body] [--no-dedup]
```

Key behavior:

- `--model` is required; no default model is inferred.
- API key comes from `--api-key`, `LLM_API_KEY`, or provider-specific `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
- `--base-url` may point OpenAI-compatible or Anthropic requests at another valid `http(s)` endpoint.
- Default input is `tmp/investigation/uncategorized-comments.json`; if absent, the script falls back to `tmp/investigation/copilot-comment-summary.json` and filters `primaryCategoryId === null`.
- Default prompt mode sends `excerpt`; `--use-full-body` sends full `body`.
- Deduplication by comment body/excerpt is on by default; `--no-dedup` disables it.
- 429/5xx LLM responses retry with exponential backoff. Malformed LLM JSON retries once with stricter JSON-only instructions.
- Output files are `uncategorized-clusters.json` and `uncategorized-clusters.md`; the Markdown report includes cluster summaries, persona candidates in `.pi/dev-loop/defaults.yaml`-compatible shape, and a "Left unclustered" section.

## Taxonomy table

12 classification categories, each with pattern-matching rules, recommended lens/linter, automation fit, and priority weight:

| ID | Label | Priority | Fit | Recommended lens |
|---|---|---|---|---|
| `placeholder_404` | 404 placeholders | 3 | strong | link validator |
| `broken_paths` | Broken relative paths | 3 | strong | link validator |
| `stale_commands` | Stale commands | 3 | hybrid | docs angle |
| `gate_evidence` | Gate evidence | 5 | strong | gate evidence lens |
| `ci_guard` | CI guard | 5 | hybrid | correctness / CI lens |
| `unused_imports` | Unused imports | 2 | strong | ESLint / dead-code linter |
| `incomplete_coverage` | Incomplete coverage | 5 | hybrid | coverage angle |
| `misleading_tests` | Misleading tests | 4 | copilot | coverage / test-quality angle |
| `config_conflicts` | Config conflicts | 4 | copilot | config drift lens |
| `duplicate_content` | Duplicate content | 2 | hybrid | docs angle |
| `no_op_tool_usage` | No-op tool usage | 3 | hybrid | workflow enforcement lens |
| `grammar` | Grammar / wording | 1 | copilot | docs angle |

## Recommendation lens mapping

The audit groups categories into recommendations ranked by `score = Σ(count × priorityWeight)`:

| Recommendation key | Categories | Owner |
|---|---|---|
| `coverage-angle` | incomplete_coverage, misleading_tests | review angle |
| `docs-angle` | stale_commands, grammar, duplicate_content | review angle |
| `link-validator` | broken_paths, placeholder_404 | validator |
| `gate-evidence-lens` | gate_evidence | workflow gate |
| `ci-guard-lens` | ci_guard | review angle |
| `dead-code-lint` | unused_imports | linter |
| `config-drift-lens` | config_conflicts | review angle |
| `workflow-noop-lens` | no_op_tool_usage | review angle |

## Draft-gate persona derivation

Audit findings are the primary input for deciding which personas to add to `.pi/dev-loop/defaults.yaml` and which draft gate angles to enable. The canonical derived personas from this repo's audit:

| Persona | Gate wiring | Priority | Source category |
|---|---|---|---|
| `ci-guard` | Default draft gate | 1 | ci_guard (67 comments) |
| `link-check` | Opt-in draft gate | 4 | placeholder_404 + broken_paths (36) |
| `config-drift` | Opt-in draft gate | 5 | config_conflicts (27) |
| `gate-evidence` | Opt-in draft gate | 6 | gate_evidence (13) |
| `no-op` | Opt-in draft gate | 7 | no_op_tool_usage (11) |

## Edge cases

| Case | Behavior |
|---|---|
| Empty repo (no PRs) | Empty comments/prs arrays, totals all zero, exit 0 |
| Repo with only non-Copilot comments | `copilotComments: 0`, all category counts zero |
| Checkpoint file corruption | `--resume` falls back to fresh fetch |
| 403/429 mid-fetch | Exponential backoff, max 5 retries |
| `gh` not authenticated (401) | Fail immediately, no retry |
| `--resume` without `--checkpoint-file` | CLI validation error |
| audit `--save-uncategorized` with no uncategorized comments | Writes `[]` to `uncategorized-comments.json` |
| classifier missing `--model` | CLI validation error |
| classifier missing API key | Clear non-zero API-key error |
| LLM returns malformed JSON | Retry once with stricter JSON-only prompt, then fail clearly |

## See also

- [Public Dev Loop Contract](../skills/docs/public-dev-loop-contract.md) — canonical routing contract
- [.pi/dev-loop/defaults.yaml](../.pi/dev-loop/defaults.yaml) — persona and gate angle registry
- [Gate Review Comment Contract](./gate-review-comment-contract.md) — gate comment format contract

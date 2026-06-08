# Debt remediation contract

Canonical authority for the debt remediation pipeline and its integration with the `dev-loop` execution path.

## Pipeline

```
debt_signals → cluster → score → shape → remediation_item → GitHub issue → dev-loop
```

Each stage is a deterministic, pure-function module under `packages/core/src/debt/`:

| Module | Role |
|---|---|
| `debt-signal.mjs` | Signal schema and validation |
| `cluster.mjs` | Group signals into findings by file, module, theme |
| `score.mjs` | 0-100 score from frequency, severity, impact |
| `shape.mjs` | Classify findings: remediation_item, debt_epic, defer, watch, dismiss |
| `remediation-to-issue.mjs` | Convert remediation_item to GitHub issue payload; create via `gh issue create` |

## CLI entrypoint

`scripts/loop/debt-remediate.mjs` is the single CLI entrypoint routed under `dev-loops loop debt-remediate`.

```
dev-loops loop debt-remediate --input <signals.json> [--repo <owner/name>] [--dry-run]
```

### Contract

- **Input**: JSON array of `debt_signal` objects (validated against `DebtSignalSchema`)
- **Pipeline**: capture → cluster → score → shape
- **Issue creation**: calls `gh issue create --assignee @me` for each `remediation_item`
- **Output**: JSON report with counts, issue URLs, and summary
- **Exit codes**: 0 (success), 1 (error)
- **Dry run**: `--dry-run` runs the full pipeline and validates but skips issue creation

### Output shape

```json
{
  "ok": true,
  "dryRun": false,
  "repo": "owner/name",
  "signals": 5,
  "findings": 2,
  "remediationItems": 1,
  "debtEpics": 0,
  "deferred": 1,
  "watching": 0,
  "dismissed": 0,
  "issues": [
    {
      "findingId": "uuid",
      "title": "...",
      "created": true,
      "issueNumber": 123,
      "issueUrl": "https://github.com/owner/name/issues/123",
      "error": null
    }
  ],
  "summary": "5 signals → 2 findings; 1 remediation items (1 issues created, 0 failed); ..."
}
```

## Integration with dev-loop

Once a remediation issue is created, it is a standard GitHub issue that feeds into the existing `dev-loop` execution path:

1. `dev-loop startup --issue <n>` resolves the issue
2. Standard `copilot-pr-followup` or `issue_intake` strategy takes over
3. PR → review → merge as normal

This closes the remediation execution loop: `remediation_item → issue → dev-loop → PR → merge`.

## Shape thresholds

Thresholds are hardcoded constants in `shape.mjs`:

| Threshold | Value | Outcome |
|---|---|---|
| `ITEM_THRESHOLD` | 65 | remediation_item or debt_epic (if actionable file paths) |
| `DEFER_THRESHOLD` | 50 | defer |
| `WATCH_THRESHOLD` | 30 | watch |
| (below) | <30 | dismiss |

## Scoring model

Three dimensions, weighted:

| Dimension | Weight | Description |
|---|---|---|
| Frequency | 0.35 | Signal count, logarithmic cap |
| Severity | 0.40 | Average severity hint (info=1..critical=5) |
| Impact | 0.25 | File presence, confidence, category diversity |

Clamped to 0-100.

## Labels

Created issues receive the `workflow` label by default. This keeps them discoverable in the standard dev-loop issue tracking surface.

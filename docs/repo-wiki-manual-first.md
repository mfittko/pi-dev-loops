# repo-wiki manual-first readiness note

## Status

This repository is **not** shipping a checked-in `repo-wiki` integration yet.

The issue's stop rule applies here: fail closed if `repo-wiki` is not usable enough for repeatable external consumption. During this bounded attempt, that viability check failed before a repo-local config, compile run, or GitHub Wiki publish could be justified.

Source files in this repository remain authoritative. A generated wiki is still intended only as a navigation aid.

## Viability probes run for this slice

### 1. External install/run probe

Command:

```bash
npx repo-wiki@0.2.0 --help
```

Observed result:

- npm returned `404 Not Found` for `repo-wiki@0.2.0`
- there is no repeatable public npm install path yet for this repository to consume

### 2. GitHub Wiki remote probe

Command:

```bash
git ls-remote https://github.com/mfittko/pi-dev-loops.wiki.git
```

Observed result:

- GitHub returned `Repository not found`
- the GitHub Wiki publish target was not reachable as a git remote during this attempt

## Decision for this issue slice

Stop here.

Do **not** partially ship:

- `.llmwiki/config.json`
- `.llmwiki/schema.md`
- compile helper scripts
- CI automation
- fallback publish machinery

Those would create repo-local integration surface without a verified external tool install path or a reachable GitHub Wiki target.

## Intended first compilation boundary once the blockers are cleared

Keep the first publish intentionally narrow:

Included:

- `README.md`
- `AGENTS.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `docs/public-dev-loop-contract.md`
- `docs/conductor-routing-contract.md`
- `scripts/README.md`
- `skills/dev-loop/SKILL.md`
- a bounded helper subset under `scripts/` and `packages/core/` only where source grounding is needed for the public `dev-loop` workflow contract

Intentionally excluded from the first publish:

- `tmp/**`
- phase-local planning artifacts under `docs/phases/`
- broad repo-wide ingestion of every skill, agent, script, test, or implementation detail
- CI/scheduled sync automation
- any attempt to make the wiki authoritative over source docs, code, tests, or contracts

## Manual rerun path after the blockers are resolved

Prerequisites:

- Node.js 20+ (matches the repository engine requirement until `repo-wiki` documents a stricter runtime floor)
- a released or otherwise documented repeatable `repo-wiki` install path
- GitHub Wiki enabled and reachable at `https://github.com/mfittko/pi-dev-loops.wiki.git`
- authenticated git/GitHub credentials that are allowed to publish the wiki

Suggested rerun sequence:

```bash
npx repo-wiki init --repo .
```

Then tighten the generated `.llmwiki/config.json` to the bounded scope above and run:

```bash
npx repo-wiki run \
  --mode bootstrap \
  --repo . \
  --scan .llmwiki/run \
  --plan .llmwiki/bootstrap-plan.json \
  --wiki .llmwiki/wiki
```

Inspect generated output before publish:

```bash
find .llmwiki/wiki -maxdepth 1 -type f | sort
```

Publish only after the local compile output looks correct:

```bash
npx repo-wiki publish \
  --target github-wiki \
  --wiki .llmwiki/wiki \
  --remote https://github.com/mfittko/pi-dev-loops.wiki.git
```

## Explicit non-goals for the blocked state

- no checked-in partial integration surface
- no scheduled refresh
- no GitHub Actions publish wiring
- no repo-specific workaround for an unpublished external tool
- no ad hoc wiki patching outside the documented rerun path

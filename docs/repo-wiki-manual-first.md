# repo-wiki manual-first local export

## Status

This repository now has a **local runnable `repo-wiki` export path**.

This slice is intentionally limited to local export. It does **not** claim that `repo-wiki` is ready for npm-based external consumption, GitHub Wiki publication, or CI automation from this repository yet.

Source files in this repository remain authoritative. Generated wiki output is a navigation aid, not the source of truth.

## Why the install path is script-backed instead of a normal devDependency

A plain GitHub-sourced npm install is not sufficient right now.

Observed probe:

```bash
npm install github:mfittko/repo-wiki#d7e772e3d702a75896a6f4eec574a4e4e5bfa6dd
```

Observed result:
- npm can fetch the package metadata from GitHub
- but the installed package does **not** include a built `dist/` CLI payload
- there is no checked-in build artifact in the GitHub source snapshot to execute directly after install

Because of that, this repository uses a pinned local helper that:
- clones `mfittko/repo-wiki` at a fixed commit
- runs `npm install` in that checkout
- builds the CLI locally
- then proxies the requested `repo-wiki` command against this repository

Pinned source ref used by the helper:
- `d7e772e3d702a75896a6f4eec574a4e4e5bfa6dd`

Helper entrypoint:
- `scripts/repo-wiki-local.mjs`

## Local prerequisites

- Node.js 24+ (matches the current `repo-wiki` engine requirement)
- git access to `https://github.com/mfittko/repo-wiki.git`
- npm available locally

## Checked-in local config

This repository now checks in the minimal local repo-wiki config needed for a bounded export:
- `.llmwiki/config.json`
- `.llmwiki/schema.md`

Generated outputs remain untracked via `.gitignore`, including:
- `.llmwiki/run/`
- `.llmwiki/wiki/`
- `.llmwiki/search/`
- `.llmwiki/bootstrap-plan.json`
- `.llmwiki/incremental-plan.json`
- `.tmp/repo-wiki/`

## Bounded first export boundary

The initial local export remains intentionally narrow.

Included documentation inputs:
- `README.md`
- `AGENTS.md`
- `docs/IMPLEMENTATION_WORKFLOW.md`
- `docs/public-dev-loop-contract.md`
- `docs/conductor-routing-contract.md`
- `docs/repo-wiki-manual-first.md`
- `scripts/README.md`
- `skills/dev-loop/SKILL.md`

Still intentionally excluded from this first local path:
- `tmp/**`
- `docs/phases/**`
- broad ingestion of every skill, agent, script, test, or implementation detail
- GitHub Wiki publish automation
- scheduled sync
- any attempt to make generated wiki output authoritative over source docs, code, tests, or contracts

## Local commands that work

Prepare the pinned local helper checkout:

```bash
npm run repo-wiki:prepare
```

Run the local bootstrap export:

```bash
npm run repo-wiki:bootstrap
```

That script expands to a bounded local sequence that avoids the current `repo-wiki run` lint-docs gate while the repository still has known contradicted-doc warnings outside this slice:

```bash
npm run repo-wiki:scan
npm run repo-wiki:plan
npm run repo-wiki:compile
```

If you want to inspect the documentation lint output separately, run:

```bash
npm run repo-wiki:lint-docs
```

Search the generated local wiki output:

```bash
npm run repo-wiki:search -- "dev-loop"
```

If you need to regenerate `.llmwiki/config.json` and `.llmwiki/schema.md` from the helper instead of using the checked-in versions:

```bash
npm run repo-wiki:init
```

## What the helper does

`npm run repo-wiki:prepare` creates a pinned local source checkout under:

```text
.tmp/repo-wiki/d7e772e3d702a75896a6f4eec574a4e4e5bfa6dd/source/
```

Then it:
1. clones `mfittko/repo-wiki`
2. checks out the pinned commit
3. runs `npm install`
4. runs `npm run build`
5. uses `dist/bin/repo-wiki.js` from that prepared checkout for later commands

This keeps the local path reproducible without pretending a normal npm consumption path already exists.

## Local verification performed for this slice

The following commands were run successfully for this repository:

```bash
npm run repo-wiki:prepare
npm run repo-wiki:scan
npm run repo-wiki:plan
npm run repo-wiki:compile
find .llmwiki/wiki -maxdepth 1 -type f | sort
```

Standard changed-scope repo validation was also run:

```bash
git diff --check
node --test test/imported-assets-normalization.test.mjs test/loop/repo-wiki-local.test.mjs
npm test
```

## Deferred work

Still deferred from this slice:
- npm publication/readiness for `repo-wiki`
- GitHub Wiki publish from this repository
- CI automation for wiki export/publish
- scheduled sync

Those should come back as separate follow-up work once the local manual-first path is stable enough and the publish target/packaging story is intentionally chosen.

# Issue 173 audit — install / update / skill-discovery contract

## Scope and verification surfaces

Primary audited docs:
- `README.md` (`/dev-loops` extension surface; install/update contract)
- `PLAN.md` (repo contract bullets; extension/CLI surface)
- `docs/phases/phase-7.md` (Phase 7 durable decisions)
- `extension/README.md` (current extension/package-install contract)

Verification surfaces used for current behavior:
- `package.json` (`pi.skills`, `pi.extensions`)
- `extension/index.ts`
- `extension/presentation.ts`
- `lib/dev-loops-core.mjs`
- `cli/index.mjs`
- `test/extension-command-contract.test.mjs`
- `test/extension-package-contract.test.mjs`
- `test/dev-loops-cli.test.mjs`

## Questions answered

1. **Are `/dev-loops install` and `/dev-loops update` still part of the supported operator contract?**
   - No. They are removed from the current extension and CLI command surfaces.
2. **Does package install itself make packaged skills discoverable, or is a separate step required?**
   - Package install is the current operator contract. The package exposes `.pi/skills` through `package.json` `pi.skills`; the audited docs should not tell operators to run a separate `/dev-loops install` or `/dev-loops update` skill-copy step.
3. **Which current docs can be corrected immediately without reopening broader product decisions?**
   - `README.md`, `PLAN.md`, and `docs/phases/phase-7.md`.
   - `extension/README.md` already matches the current contract and does not need a fix for this issue.

## Actual mismatches

### Finding 1 — README still described removed `/dev-loops install` / `update` commands as part of the current surface

- **Documented claim**
  - `README.md` under ``## `/dev-loops` extension surface`` listed `/dev-loops install` / `/dev-loops update` in the command list and described them as deprecated compatibility commands.
  - `README.md` under `Important install/update contract` said those commands were compatibility commands that no longer copied skills.
- **Behavior evidence**
  - `extension/presentation.ts` `buildHelpLines()` exposes only `/dev-loops status`, `/dev-loops doctor`, and `/dev-loops hide`.
  - `lib/dev-loops-core.mjs` `parseDevLoopsCommand()` accepts `help`, `status`, `doctor`, and `hide`; unknown or legacy `install` / `update` input falls back to help on the extension surface.
  - `test/extension-command-contract.test.mjs` (`help is the default action and removed install/update commands fall back to help`) verifies `install` and `update` no longer have their own command behavior.
- **Operator impact**
  - Operators could infer that `/dev-loops install` or `/dev-loops update` are still supported commands instead of removed legacy names.
  - That also suggests a separate post-install skill step that current behavior no longer exposes.
- **Disposition**
  - `fix docs now`

### Finding 2 — PLAN claimed package install does not auto-expose packaged skills

- **Documented claim**
  - `PLAN.md` under `## Current repo posture` said packaged skills are installed explicitly through `/dev-loops install ...` / `/dev-loops update ...` and that package install alone does not auto-install skills.
  - `PLAN.md` under `### 3. Extension and CLI surface` listed explicit skill install/update flows as part of the package-level UX.
- **Behavior evidence**
  - `package.json` exposes `.pi/skills` through `pi.skills` and `./index.ts` through `pi.extensions`.
  - `extension/README.md` under `## Package install contract for this phase` says `pi install git:github.com/mfittko/pi-dev-loops` is the distribution mechanism for the extension, skills, scripts, and packaged agents.
  - `test/extension-package-contract.test.mjs` verifies `packageJson.pi.skills === [".pi/skills"]` and asserts the extension README documents `package.json` `pi.skills` plus direct `pi install` / `pi update` guidance.
- **Operator impact**
  - PLAN would send maintainers and downstream pilot work toward an obsolete skill-copy mental model.
  - That distorts readiness interpretation and portability expectations for installed use.
- **Disposition**
  - `fix docs now`

### Finding 3 — Phase 7 durable decisions still anchored portability work to the removed skill-copy flow

- **Documented claim**
  - `docs/phases/phase-7.md` under `## Scope for this phase` said package installation should stay separate from skill installation through `/dev-loops install ...` / `/dev-loops update ...`.
  - `docs/phases/phase-7.md` under `## Durable decisions and constraints` said package install should expose only the extension surface and that packaged skills should be copied into repo-local or system-wide skill directories through those commands.
- **Behavior evidence**
  - `extension/README.md` under `## Runtime / build / test contract` says the package exposes `.pi/skills` through `package.json` `pi.skills` for install-based global skill loading and that `/dev-loops install ...` / `/dev-loops update ...` are not part of the command surface.
  - `extension/presentation.ts` help/status guidance points operators to `pi install git:github.com/mfittko/pi-dev-loops` / `pi update git:github.com/mfittko/pi-dev-loops`, not to a separate skill-copy command.
  - `test/dev-loops-cli.test.mjs` and `test/extension-command-contract.test.mjs` both assert help/status copy points to `pi install` and does not surface install/update subcommands as part of the current command flow.
- **Operator impact**
  - Phase 7 portability decisions would be framed around a stale installation/discovery boundary.
  - That can mis-route follow-up work and produce the wrong acceptance story for downstream pilot verification.
- **Disposition**
  - `fix docs now`

## Audited surface with no actual mismatch

### `extension/README.md`

- `extension/README.md` already states that `pi install git:github.com/mfittko/pi-dev-loops` is the package-install path, that packaged skills are exposed through `package.json` `pi.skills`, and that `/dev-loops install ...` / `/dev-loops update ...` are removed.
- `test/extension-package-contract.test.mjs` already verifies those claims.
- **Disposition**
  - No doc fix needed in this issue.

## Safe doc-only corrections applied now

- `README.md`
  - remove the removed legacy install/update names from the current command list
  - keep the install/update contract aligned with `pi install` / `pi update`
- `PLAN.md`
  - replace the stale explicit skill-copy contract with the package-install + `pi.skills` contract
  - remove explicit skill-install/update flows from the extension/CLI surface list
- `docs/phases/phase-7.md`
  - remove the stale skill-copy install assumption from scope/durable decisions
  - replace it with the current package-install + `pi.skills` contract

## Overlap routed elsewhere

- `#2` owns broader Phase 7 pilot-path / target-repo decisions. This audit does **not** redefine that wider portability strategy.
- `#105` and `#118` own broader public-entrypoint / internal-name cleanup. This audit does **not** reopen those naming decisions beyond citing current operator-facing behavior.

## Bounded conclusion

The actual evidence-backed mismatches in scope are documentation mismatches, not a runtime need for a second install/update command family. The current operator contract is:
- install/update through `pi install` / `pi update`
- packaged skills exposed through `package.json` `pi.skills`
- `/dev-loops install` / `/dev-loops update` removed from the supported command surface

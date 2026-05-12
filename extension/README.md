# Extension scaffold

`pi-dev-loops` ships a lightweight package extension.

Current responsibilities:

- register doctor/setup commands
- expose a small readiness widget below the editor
- surface whether key prerequisites are available

Current command surface:

- `/dev-loops doctor`
- `/dev-loops setup`
- `/dev-loops status`
- `/dev-loops hide`

If no subcommand is given, `/dev-loops` defaults to `status`.

Design rule:

The extension should stay thin. Shared workflow mechanics should live in deterministic `lib/` modules and `scripts/`, not in extension-only event logic.

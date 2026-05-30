#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  describeReadiness,
  executeDevLoopsCommand,
  renderCheckLines,
  summarizeChecks,
  DEV_LOOP_CHECK_IDS,
} from "../lib/dev-loops-core.mjs";

const CLI_SETUP_GUIDANCE = {
  "gh-installed": "Install GitHub CLI to enable remote GitHub/Copilot workflows.",
  "gh-auth": "Run `gh auth login` so remote GitHub/Copilot workflows can use your GitHub session.",
  "subagent-tool": "Install or enable `pi-subagents`; the shared loop workflows assume subagent support.",
  "git-repo": "Run the command from a git repository checkout before using repo-scoped workflows.",
};

function spawnResult(command, args, options = {}) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      ...options,
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

function executableCandidates(command, platform, pathExt) {
  if (platform !== "win32") {
    return [command];
  }

  if (path.extname(command)) {
    return [command];
  }

  const extensions = [...new Set(pathExt.split(";").map((entry) => entry.trim()).filter(Boolean))];
  return extensions.map((extension) => `${command}${extension}`);
}

async function commandExists(
  command,
  {
    searchPath = process.env.PATH ?? "",
    platform = process.platform,
    pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
  } = {},
) {
  if (/[\\/]/.test(command)) {
    return false;
  }

  const accessMode = platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;

  for (const entry of searchPath.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    for (const candidateName of executableCandidates(command, platform, pathExt)) {
      const candidate = path.join(entry, candidateName);

      try {
        await access(candidate, accessMode);
        return true;
      } catch {
        // Keep searching PATH entries.
      }
    }
  }

  return false;
}

function buildCliHelpLines() {
  return [
    "pi-dev-loops help",
    "Workflow entry:",
    "- /skill:dev-loop (in Pi) or `subagent dev-loop` — single public entrypoint; routing handles the rest",
    "Commands:",
    "- pi-dev-loops status",
    "- pi-dev-loops doctor",
    "`/dev-loops hide` remains an extension-only Pi command.",
    "Use `pi install git:github.com/mfittko/pi-dev-loops` to install skills and agents, or `pi update git:github.com/mfittko/pi-dev-loops` to refresh the package.",
  ];
}

function buildCliUsageLines(action) {
  switch (action) {
    case "help":
    case "status":
    case "doctor":
      return ["Usage:", `- pi-dev-loops ${action}`];
    case "hide":
      return [
        "Usage:",
        "- pi-dev-loops hide",
        "`hide` is only supported without extra arguments, and only inside the Pi extension.",
      ];
    default:
      throw new Error(`Unknown CLI usage action: ${action}`);
  }
}

function orderedCliSetupSteps(checks) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const steps = [...new Set(DEV_LOOP_CHECK_IDS.filter((id) => byId.get(id)?.ok === false).map((id) => CLI_SETUP_GUIDANCE[id]))].map(
    (step, index) => `${index + 1}. ${step}`,
  );

  if (steps.length > 0) {
    return steps;
  }

  return [
    "1. Use `/skill:dev-loop` (in Pi) or `subagent dev-loop` to start or continue a dev loop — the single public entry.",
    "2. Run `pi-dev-loops status` whenever you want a concise readiness snapshot.",
    "3. Use `pi install git:github.com/mfittko/pi-dev-loops` to install the package, or `pi update git:github.com/mfittko/pi-dev-loops` to refresh it.",
  ];
}

function writeLines(stream, lines) {
  stream.write(`${lines.join("\n")}\n`);
}

export function createCliRuntime({
  cwd = process.cwd(),
  searchPath = process.env.PATH ?? "",
  platform = process.platform,
  pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
} = {}) {
  return {
    surface: "cli",
    cwd,
    async commandExists(command) {
      return commandExists(command, { searchPath, platform, pathExt });
    },
    async ghAuthOk() {
      return spawnResult("gh", ["auth", "status"], { cwd }).ok;
    },
    async insideGitRepo() {
      return spawnResult("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).ok;
    },
    async getSubagentAvailability() {
      const ok = await commandExists("pi-subagents", { searchPath, platform, pathExt });
      return {
        ok,
        availableDetail: "`pi-subagents` is available on PATH.",
        unavailableDetail: "Install or enable `pi-subagents`; current loops assume subagent support.",
      };
    },
  };
}

/**
 * Run the shell CLI and return the intended process exit code.
 *
 * Callers are responsible for forwarding the returned code to
 * `process.exitCode` or `process.exit()`; this helper does not mutate
 * process exit state on its own.
 */
export async function runCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  runtime,
  cwd = process.cwd(),
} = {}) {
  const activeRuntime = runtime ?? createCliRuntime({ cwd });
  const result = await executeDevLoopsCommand({
    input: argv,
    surface: "cli",
    runtime: activeRuntime,
  });

  switch (result.kind) {
    case "help":
      writeLines(stdout, buildCliHelpLines());
      return 0;
    case "checks": {
      const summary = summarizeChecks(result.checks);
      const readiness = describeReadiness(result.checks);
      const lines = [
        `pi-dev-loops ${result.action}: ${summary.ok}/${summary.total} checks passed`,
        `Local loop readiness: ${readiness.localReady ? "ready" : "needs setup"}`,
        `Remote GitHub/Copilot readiness: ${readiness.remoteReady ? "ready" : "needs setup"}`,
      ];

      if (result.action === "status") {
        lines.push("Suggested next steps:", ...orderedCliSetupSteps(result.checks));
      } else {
        lines.push(...renderCheckLines(result.checks));
        lines.push("Skills load via `pi install git:github.com/mfittko/pi-dev-loops`; packaged agents sync into `~/.agents/` on session start.");
      }

      writeLines(stdout, lines);
      return 0;
    }
    case "unsupported":
      writeLines(stderr, [result.message]);
      return 1;
    case "malformed": {
      const lines = [result.message, ...buildCliHelpLines()];
      if (result.usageAction) {
        lines.splice(1, 0, ...buildCliUsageLines(result.usageAction));
      }
      writeLines(stderr, lines);
      return 1;
    }
    default:
      throw new Error(`Unhandled CLI result: ${result.kind}`);
  }
}

const invokedAsScript = (() => {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(path.resolve(process.argv[1])));
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  process.exitCode = await runCli();
}

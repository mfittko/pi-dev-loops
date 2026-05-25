import { spawnSync } from "node:child_process";
import { access, constants as fsConstants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  describeReadiness,
  executeDevLoopsCommand,
  renderCheckLines,
  summarizeChecks,
  DEV_LOOP_CHECK_IDS,
} from "../lib/dev-loops-core.mjs";
import { resolveSystemSkillsRoot } from "../lib/dev-loops-installer.mjs";

const CLI_SETUP_GUIDANCE = {
  "gh-installed": "Install GitHub CLI to enable remote GitHub/Copilot workflows.",
  "gh-auth": "Run `gh auth login` so remote GitHub/Copilot workflows can use your GitHub session.",
  "subagent-tool": "Install or enable `pi-subagents`; the shared loop workflows assume subagent support.",
  "git-repo": "Run the command from a git repository checkout before using repo-scoped workflows.",
  "local-dev-loop-skill": "Run `pi-dev-loops install repo` for this repository or `pi-dev-loops install system` for `~/.pi/agent/skills`.",
  "copilot-dev-loop-skill": "Run `pi-dev-loops install repo` for this repository or `pi-dev-loops install system` for `~/.pi/agent/skills`.",
  "copilot-autopilot-skill": "Run `pi-dev-loops install repo` for this repository or `pi-dev-loops install system` for `~/.pi/agent/skills`.",
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

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function formatInstallStatus(status) {
  switch (status) {
    case "installed":
      return "installed";
    case "updated":
      return "updated";
    case "already-installed":
      return "already installed";
    case "missing":
      return "not installed";
    default:
      throw new Error(`Unknown install status: ${status}`);
  }
}

function buildCliHelpLines() {
  return [
    "pi-dev-loops help",
    "Workflow entry:",
    "- /skill:dev-loop (in Pi) or `subagent dev-loop` — single public entrypoint; routing handles the rest",
    "Commands:",
    "- pi-dev-loops status",
    "- pi-dev-loops doctor",
    "- pi-dev-loops install repo",
    "- pi-dev-loops install system",
    "- pi-dev-loops update repo",
    "- pi-dev-loops update system",
    "`/dev-loops hide` remains an extension-only Pi command.",
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
    case "install":
    case "update":
      return [
        `pi-dev-loops ${action}: choose a target`,
        "Usage:",
        `- pi-dev-loops ${action} repo`,
        `- pi-dev-loops ${action} system`,
      ];
    default:
      throw new Error(`Unknown CLI usage action: ${action}`);
  }
}

function buildCliBlockedLines(action, message) {
  return [
    message,
    `Run the command from a git worktree, or use \`pi-dev-loops ${action} system\` for the system-wide target.`,
  ];
}

function buildCliFailureLines(action, scope, detail) {
  return [
    `pi-dev-loops ${action} ${scope}: failed`,
    detail,
  ];
}

function buildCliInstallResultLines(result) {
  const changedCount = result.results.filter((entry) => entry.status !== "already-installed" && entry.status !== "missing").length;
  const lines = [
    `pi-dev-loops ${result.mode} ${result.scope}: ${changedCount}/${result.results.length} skill directories changed`,
    `Target: ${result.targetRoot}`,
    ...result.results.map((entry) => `- ${entry.skillName}: ${formatInstallStatus(entry.status)} (${entry.targetPath})`),
  ];

  if (result.mode === "update" && result.results.some((entry) => entry.status === "missing")) {
    lines.push("Some packaged skills were not installed in this target yet; use `pi-dev-loops install repo|system` for first-time setup.");
  }

  lines.push("Newly installed or updated skills will be available the next time Pi starts; if Pi is already running, refresh skill discovery in that session first.");
  if (result.results.some((entry) => entry.status === "missing")) {
    lines.push("A missing skill will not appear after refresh alone; run `pi-dev-loops install repo|system` first for any packaged skill reported as not installed.");
  }
  return lines;
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
    "3. Use `pi-dev-loops update repo` or `pi-dev-loops update system` to refresh installed skills when the package changes.",
  ];
}

function writeLines(stream, lines) {
  stream.write(`${lines.join("\n")}\n`);
}

export function createCliRuntime({
  cwd = process.cwd(),
  homeDirectory = os.homedir(),
  searchPath = process.env.PATH ?? "",
  platform = process.platform,
  pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
} = {}) {
  let repoRootPromise;

  async function resolveRepoRoot() {
    if (!repoRootPromise) {
      repoRootPromise = Promise.resolve().then(() => {
        const result = spawnResult("git", ["rev-parse", "--show-toplevel"], { cwd });
        return result.ok ? result.stdout.trim() || undefined : undefined;
      });
    }

    return repoRootPromise;
  }

  return {
    surface: "cli",
    cwd,
    homeDirectory,
    async commandExists(command) {
      return commandExists(command, { searchPath, platform, pathExt });
    },
    async ghAuthOk() {
      return spawnResult("gh", ["auth", "status"], { cwd }).ok;
    },
    async insideGitRepo() {
      return spawnResult("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).ok;
    },
    resolveRepoRoot,
    async getSubagentAvailability() {
      const ok = await commandExists("pi-subagents", { searchPath, platform, pathExt });
      return {
        ok,
        availableDetail: "`pi-subagents` is available on PATH.",
        unavailableDetail: "Install or enable `pi-subagents`; current loops assume subagent support.",
      };
    },
    async getSkillAvailability(skillName) {
      const repoRoot = await resolveRepoRoot();
      const repoSkillPath = repoRoot ? path.join(repoRoot, ".pi", "skills", skillName, "SKILL.md") : undefined;
      const systemSkillPath = path.join(resolveSystemSkillsRoot(homeDirectory), skillName, "SKILL.md");
      const repoInstalled = repoSkillPath ? await pathExists(repoSkillPath) : false;
      const systemInstalled = await pathExists(systemSkillPath);
      const ok = repoInstalled || systemInstalled;

      const installDetail = `Install the packaged skill under ${repoRoot ? "`.pi/skills` or " : ""}\`${resolveSystemSkillsRoot(homeDirectory)}\` to make it discoverable.`;

      if (repoInstalled && repoSkillPath) {
        return {
          ok,
          availableDetail: `Packaged skill is installed in this repository (${repoSkillPath}).`,
          unavailableDetail: `Packaged skill is already installed in this repository (${repoSkillPath}).`,
        };
      }

      if (systemInstalled) {
        return {
          ok,
          availableDetail: `Packaged skill is installed in the system skill root (${systemSkillPath}).`,
          unavailableDetail: `Packaged skill is already installed in the system skill root (${systemSkillPath}).`,
        };
      }

      return {
        ok: false,
        availableDetail: "Packaged skill is not installed yet.",
        unavailableDetail: installDetail,
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
  homeDirectory = os.homedir(),
} = {}) {
  if (runtime && runtime.homeDirectory !== undefined && runtime.homeDirectory !== homeDirectory) {
    throw new Error(
      `runCli received mismatched homeDirectory values: runtime.homeDirectory=${runtime.homeDirectory} option.homeDirectory=${homeDirectory}`,
    );
  }

  const activeRuntime = runtime ?? createCliRuntime({ cwd, homeDirectory });
  const result = await executeDevLoopsCommand({
    input: argv,
    surface: "cli",
    runtime: activeRuntime,
    homeDirectory,
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
        lines.push("Use `pi-dev-loops install repo|system` to install packaged skills, or `pi-dev-loops update repo|system` to refresh them.");
      }

      writeLines(stdout, lines);
      return 0;
    }
    case "missing-target":
      writeLines(stderr, buildCliUsageLines(result.action));
      return 1;
    case "blocked":
      writeLines(stderr, buildCliBlockedLines(result.action, result.message));
      return 1;
    case "install-result":
      writeLines(stdout, buildCliInstallResultLines(result.result));
      return 0;
    case "failed":
      writeLines(stderr, buildCliFailureLines(result.action, result.scope, result.detail));
      return 1;
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

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
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

function shellResult(command) {
  try {
    const result = spawnSync("bash", ["-lc", command], { encoding: "utf8" });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
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
  return [
    `pi-dev-loops ${action}: choose a target`,
    "Usage:",
    `- pi-dev-loops ${action} repo`,
    `- pi-dev-loops ${action} system`,
  ];
}

function buildCliBlockedLines(action) {
  return [
    `pi-dev-loops ${action} repo: not inside a git repository`,
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

  lines.push("Restart Pi or refresh skill discovery before expecting newly installed or updated skills to appear in this session.");
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
    "1. Run `pi-dev-loops status` whenever you want a concise readiness snapshot.",
    "2. Use `pi-dev-loops update repo` or `pi-dev-loops update system` to refresh installed skills when the package changes.",
  ];
}

function writeLines(stream, lines) {
  stream.write(`${lines.join("\n")}\n`);
}

export function createCliRuntime({ cwd = process.cwd(), homeDirectory = os.homedir() } = {}) {
  let repoRootPromise;

  async function resolveRepoRoot() {
    if (!repoRootPromise) {
      repoRootPromise = Promise.resolve().then(() => {
        const result = shellResult(`cd ${JSON.stringify(cwd)} && git rev-parse --show-toplevel`);
        return result.ok ? result.stdout.trim() || undefined : undefined;
      });
    }

    return repoRootPromise;
  }

  return {
    async commandExists(command) {
      return shellResult(`cd ${JSON.stringify(cwd)} && command -v ${command} >/dev/null 2>&1`).ok;
    },
    async ghAuthOk() {
      return shellResult(`cd ${JSON.stringify(cwd)} && gh auth status >/dev/null 2>&1`).ok;
    },
    async insideGitRepo() {
      return shellResult(`cd ${JSON.stringify(cwd)} && git rev-parse --is-inside-work-tree >/dev/null 2>&1`).ok;
    },
    resolveRepoRoot,
    async getSubagentAvailability() {
      const ok = await this.commandExists("pi-subagents");
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

      if (repoInstalled && repoSkillPath) {
        return {
          ok,
          availableDetail: `Packaged skill is installed in this repository (${repoSkillPath}).`,
          unavailableDetail: "",
        };
      }

      if (systemInstalled) {
        return {
          ok,
          availableDetail: `Packaged skill is installed in the system skill root (${systemSkillPath}).`,
          unavailableDetail: "",
        };
      }

      return {
        ok: false,
        availableDetail: "",
        unavailableDetail: `Install the packaged skill under ${repoRoot ? "`.pi/skills` or " : ""}\`${resolveSystemSkillsRoot(homeDirectory)}\` to make it discoverable.`,
      };
    },
  };
}

export async function runCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  runtime = createCliRuntime(),
  homeDirectory = os.homedir(),
} = {}) {
  const result = await executeDevLoopsCommand({
    input: argv,
    surface: "cli",
    runtime,
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
      writeLines(stderr, buildCliBlockedLines(result.action));
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

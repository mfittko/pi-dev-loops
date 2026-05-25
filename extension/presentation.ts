import type { DevLoopCheck, DevLoopCheckId } from "./checks.ts";
import type { InstallResult, InstallStatus } from "./installer.ts";
import { DEV_LOOP_CHECK_IDS, summarizeChecks, renderCheckLines } from "./checks.ts";
import { describeReadiness } from "../lib/dev-loops-core.mjs";

export type DevLoopsAction = "doctor" | "help" | "install" | "status" | "update" | "hide";

const INSTALL_GUIDANCE = "Run `/dev-loops install repo` for this repository or `/dev-loops install system` for `~/.pi/agent/skills`.";

const SETUP_GUIDANCE: Record<(typeof DEV_LOOP_CHECK_IDS)[number], string> = {
  "gh-installed": "Install GitHub CLI to enable remote GitHub/Copilot workflows.",
  "gh-auth": "Run `gh auth login` so remote GitHub/Copilot workflows can use your GitHub session.",
  "subagent-tool": "Install or enable `pi-subagents`; the shared loop workflows assume subagent support.",
  "git-repo": "Open Pi inside a git repository checkout before using the shared loops.",
  "local-dev-loop-skill": INSTALL_GUIDANCE,
};

function readinessLabel(ready: boolean): string {
  return ready ? "ready" : "needs setup";
}

function checkMap(checks: DevLoopCheck[]): Map<DevLoopCheckId, DevLoopCheck> {
  return new Map(checks.map((check) => [check.id, check]));
}

function formatInstallStatus(status: InstallStatus): string {
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

export function orderedSetupSteps(checks: DevLoopCheck[]): string[] {
  const byId = checkMap(checks);
  const uniqueSteps = [...new Set(DEV_LOOP_CHECK_IDS.filter((id) => byId.get(id)?.ok === false).map((id) => SETUP_GUIDANCE[id]))];
  const steps = uniqueSteps.map((step, index) => `${index + 1}. ${step}`);

  if (steps.length > 0) {
    return steps;
  }

  return [
    "1. Use `/skill:dev-loop` to start or continue a dev loop — the single public entry; routing handles the rest.",
    "2. Run `/dev-loops status` whenever you want a concise readiness snapshot.",
    "3. Use `/dev-loops update repo` or `/dev-loops update system` to refresh installed skills when the package changes.",
  ];
}

export function buildHelpLines(): string[] {
  return [
    "pi-dev-loops help",
    "Workflow entry:",
    "- /skill:dev-loop — single public entrypoint; routing handles the rest",
    "Commands:",
    "- /dev-loops status",
    "- /dev-loops doctor",
    "- /dev-loops install",
    "  prompts for `repo` or `system` when no target is provided",
    "- /dev-loops update",
    "  prompts for `repo` or `system` when no target is provided",
    "- /dev-loops hide",
    "The package install exposes `/dev-loops` in Pi and `pi-dev-loops` in the shell; skills are installed explicitly through the install/update commands.",
  ];
}

export function buildWidgetLines(action: Extract<DevLoopsAction, "doctor" | "status">, checks: DevLoopCheck[]): string[] {
  const summary = summarizeChecks(checks);
  const readiness = describeReadiness(checks);
  const lines = [
    `pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`,
    `Local loop readiness: ${readinessLabel(readiness.localReady)}`,
    `Remote GitHub/Copilot readiness: ${readinessLabel(readiness.remoteReady)}`,
  ];

  if (action === "status") {
    return [
      ...lines,
      "Suggested next steps:",
      ...orderedSetupSteps(checks),
    ];
  }

  return [
    ...lines,
    ...renderCheckLines(checks),
    "Use `/dev-loops install repo|system` to install packaged skills, or `/dev-loops update repo|system` to refresh them.",
  ];
}

export function buildNotificationMessage(action: Extract<DevLoopsAction, "doctor" | "status">, checks: DevLoopCheck[]): string {
  const summary = summarizeChecks(checks);
  return `pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`;
}

export function buildInstallUsageLines(action: Extract<DevLoopsAction, "install" | "update">): string[] {
  const actionVerb = action === "install" ? "installs" : "updates";

  return [
    `pi-dev-loops ${action}: choose a target`,
    "Usage:",
    `- /dev-loops ${action} repo`,
    `- /dev-loops ${action} system`,
    `\`repo\` ${actionVerb} skills in the current git repository under \`.pi/skills\`.`,
    `\`system\` ${actionVerb} skills in \`~/.pi/agent/skills\`.`,
  ];
}

export function buildInstallResultLines(result: InstallResult): string[] {
  const changedCount = result.results.filter((entry) => entry.status !== "already-installed" && entry.status !== "missing").length;

  const lines = [
    `pi-dev-loops ${result.mode} ${result.scope}: ${changedCount}/${result.results.length} skill directories changed`,
    `Target: ${result.targetRoot}`,
    ...result.results.map((entry) => `- ${entry.skillName}: ${formatInstallStatus(entry.status)} (${entry.targetPath})`),
  ];

  if (result.mode === "update" && result.results.some((entry) => entry.status === "missing")) {
    lines.push("Some packaged skills were not installed in this target yet; use `/dev-loops install repo|system` for first-time setup.");
  }

  lines.push("Restart Pi or refresh skill discovery before expecting newly installed or updated skills to appear in this session.");
  if (result.results.some((entry) => entry.status === "missing")) {
    lines.push("A missing skill will not appear after refresh alone; run `/dev-loops install repo|system` first for any packaged skill reported as not installed.");
  }

  return lines;
}

export function buildInstallNotificationMessage(result: InstallResult): string {
  const changedCount = result.results.filter((entry) => entry.status !== "already-installed" && entry.status !== "missing").length;
  const missingCount = result.results.filter((entry) => entry.status === "missing").length;

  if (result.mode === "update" && missingCount > 0) {
    return `pi-dev-loops ${result.mode} ${result.scope}: ${changedCount}/${result.results.length} skill directories changed, ${missingCount} not installed yet`;
  }

  return `pi-dev-loops ${result.mode} ${result.scope}: ${changedCount}/${result.results.length} skill directories changed`;
}

export function buildRepoInstallErrorLines(action: Extract<DevLoopsAction, "install" | "update">, message: string): string[] {
  return [
    message,
    `Run the command from a git worktree, or use \`/dev-loops ${action} system\` for the system-wide target.`,
  ];
}

export function buildInstallFailureLines(
  action: Extract<DevLoopsAction, "install" | "update">,
  scope: "repo" | "system",
  error: unknown,
): string[] {
  const detail = error instanceof Error ? error.message : String(error);

  return [
    `pi-dev-loops ${action} ${scope}: failed`,
    detail,
  ];
}

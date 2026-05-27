import type { DevLoopCheck, DevLoopCheckId } from "./checks.ts";
import { DEV_LOOP_CHECK_IDS, summarizeChecks, renderCheckLines } from "./checks.ts";
import { describeReadiness } from "../lib/dev-loops-core.mjs";

export type DevLoopsAction = "doctor" | "help" | "install" | "status" | "update" | "hide";

const SETUP_GUIDANCE: Record<(typeof DEV_LOOP_CHECK_IDS)[number], string> = {
  "gh-installed": "Install GitHub CLI to enable remote GitHub/Copilot workflows.",
  "gh-auth": "Run `gh auth login` so remote GitHub/Copilot workflows can use your GitHub session.",
  "subagent-tool": "Install or enable `pi-subagents`; the shared loop workflows assume subagent support.",
  "git-repo": "Open Pi inside a git repository checkout before using the shared loops.",
};

function readinessLabel(ready: boolean): string {
  return ready ? "ready" : "needs setup";
}

function checkMap(checks: DevLoopCheck[]): Map<DevLoopCheckId, DevLoopCheck> {
  return new Map(checks.map((check) => [check.id, check]));
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
    "3. Use `pi install git:github.com/mfittko/pi-dev-loops` to install the package, or `pi update git:github.com/mfittko/pi-dev-loops` to refresh it.",
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
    "- /dev-loops hide",
    "Deprecated compatibility commands:",
    "- /dev-loops install",
    "- /dev-loops update",
    "Use `pi install git:github.com/mfittko/pi-dev-loops` to install skills and agents; packaged agents sync into `~/.agents/` on session start.",
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
    "Skills load via `pi install git:github.com/mfittko/pi-dev-loops`; packaged agents sync into `~/.agents/` on session start.",
  ];
}

export function buildNotificationMessage(action: Extract<DevLoopsAction, "doctor" | "status">, checks: DevLoopCheck[]): string {
  const summary = summarizeChecks(checks);
  return `pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`;
}

import type { DevLoopCheck, DevLoopCheckId } from "./checks.ts";
import { DEV_LOOP_CHECK_IDS, summarizeChecks, renderCheckLines } from "./checks.ts";

export type DevLoopsAction = "doctor" | "setup" | "status" | "hide";

const SETUP_GUIDANCE: Record<(typeof DEV_LOOP_CHECK_IDS)[number], string> = {
  "gh-installed": "Install GitHub CLI to enable remote GitHub/Copilot workflows.",
  "gh-auth": "Run `gh auth login` so remote GitHub/Copilot workflows can use your GitHub session.",
  "subagent-tool": "Install or enable `pi-subagents`; the shared loop workflows assume subagent support.",
  "git-repo": "Open Pi inside a git repository checkout before using the shared loops.",
  "local-dev-loop-skill": "Make sure `/skill:dev-loop` is discoverable before starting local phase-based work.",
  "copilot-dev-loop-skill": "Make sure `/skill:copilot-dev-loop` is discoverable before starting remote GitHub/Copilot workflows.",
};

function readinessLabel(ready: boolean): string {
  return ready ? "ready" : "needs setup";
}

function checkMap(checks: DevLoopCheck[]): Map<DevLoopCheckId, DevLoopCheck> {
  return new Map(checks.map((check) => [check.id, check]));
}

const LOCAL_READINESS_IDS: DevLoopCheckId[] = ["subagent-tool", "git-repo", "local-dev-loop-skill"];
const REMOTE_READINESS_IDS: DevLoopCheckId[] = [
  "gh-installed",
  "gh-auth",
  "subagent-tool",
  "git-repo",
  "copilot-dev-loop-skill",
];

export function describeReadiness(checks: DevLoopCheck[]) {
  const byId = checkMap(checks);
  const localReady = LOCAL_READINESS_IDS.every((id) => byId.get(id)?.ok);
  const remoteReady = REMOTE_READINESS_IDS.every((id) => byId.get(id)?.ok);

  return {
    localReady,
    remoteReady,
  };
}

export function orderedSetupSteps(checks: DevLoopCheck[]): string[] {
  const byId = checkMap(checks);
  const steps = DEV_LOOP_CHECK_IDS.filter((id) => byId.get(id)?.ok === false).map(
    (id, index) => `${index + 1}. ${SETUP_GUIDANCE[id]}`,
  );

  if (steps.length > 0) {
    return steps;
  }

  return [
    "1. Run `/dev-loops status` whenever you want a concise readiness snapshot.",
    "2. Use `/skill:dev-loop` for local phase-based work or `/skill:copilot-dev-loop` for remote GitHub/Copilot workflows.",
  ];
}

export function buildWidgetLines(action: Exclude<DevLoopsAction, "hide">, checks: DevLoopCheck[]): string[] {
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

  const detailedLines = renderCheckLines(checks);

  if (action === "doctor") {
    return [
      ...lines,
      ...detailedLines,
      "Use `/dev-loops setup` for ordered first-time setup guidance.",
    ];
  }

  return [
    ...lines,
    ...detailedLines,
    "Ordered setup steps:",
    ...orderedSetupSteps(checks),
  ];
}

export function buildNotificationMessage(action: Exclude<DevLoopsAction, "hide">, checks: DevLoopCheck[]): string {
  const summary = summarizeChecks(checks);
  return `pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`;
}

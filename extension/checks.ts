import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const DEV_LOOP_CHECK_IDS = [
  "gh-installed",
  "gh-auth",
  "subagent-tool",
  "git-repo",
  "local-dev-loop-skill",
  "copilot-dev-loop-skill",
] as const;

export type DevLoopCheckId = (typeof DEV_LOOP_CHECK_IDS)[number];

export type DevLoopCheck = {
  id: DevLoopCheckId;
  label: string;
  ok: boolean;
  detail: string;
};

async function commandExists(pi: ExtensionAPI, command: string): Promise<boolean> {
  try {
    const result = await pi.exec("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
      timeout: 5_000,
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function ghAuthOk(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec("bash", ["-lc", "gh auth status >/dev/null 2>&1"], {
      timeout: 10_000,
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function insideGitRepo(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec(
      "bash",
      ["-lc", "git rev-parse --is-inside-work-tree >/dev/null 2>&1"],
      { timeout: 5_000 },
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function collectDevLoopChecks(pi: ExtensionAPI): Promise<DevLoopCheck[]> {
  const [ghInstalled, ghAuthenticated, inGitRepo] = await Promise.all([
    commandExists(pi, "gh"),
    ghAuthOk(pi),
    insideGitRepo(pi),
  ]);

  const tools = pi.getAllTools();
  const commands = pi.getCommands();
  const subagentAvailable = tools.some((tool) => tool.name === "subagent");
  const localDevLoopAvailable = commands.some((command) => command.name === "skill:dev-loop");
  const copilotDevLoopAvailable = commands.some(
    (command) => command.name === "skill:copilot-dev-loop",
  );

  return [
    {
      id: "gh-installed",
      label: "GitHub CLI installed",
      ok: ghInstalled,
      detail: ghInstalled ? "`gh` is available." : "Install GitHub CLI to use remote GitHub/Copilot loops.",
    },
    {
      id: "gh-auth",
      label: "GitHub CLI authenticated",
      ok: ghInstalled && ghAuthenticated,
      detail:
        ghInstalled && ghAuthenticated
          ? "`gh auth status` succeeded."
          : ghInstalled
            ? "Run `gh auth login` before using remote GitHub/Copilot loops."
            : "GitHub CLI is not installed yet.",
    },
    {
      id: "subagent-tool",
      label: "pi-subagents available",
      ok: subagentAvailable,
      detail: subagentAvailable
        ? "`subagent` tool is available."
        : "Install/enable `pi-subagents`; current loops assume subagent support.",
    },
    {
      id: "git-repo",
      label: "Inside a git repository",
      ok: inGitRepo,
      detail: inGitRepo
        ? "Current working directory is inside a git repo."
        : "Local and GitHub loops work best inside a git repository checkout.",
    },
    {
      id: "local-dev-loop-skill",
      label: "Local dev-loop skill discoverable",
      ok: localDevLoopAvailable,
      detail: localDevLoopAvailable
        ? "`/skill:dev-loop` is available."
        : "Run `/dev-loops install repo` or `/dev-loops install system` to make `/skill:dev-loop` discoverable.",
    },
    {
      id: "copilot-dev-loop-skill",
      label: "Copilot dev-loop skill discoverable",
      ok: copilotDevLoopAvailable,
      detail: copilotDevLoopAvailable
        ? "`/skill:copilot-dev-loop` is available."
        : "Run `/dev-loops install repo` or `/dev-loops install system` to make `/skill:copilot-dev-loop` discoverable.",
    },
  ];
}

export function summarizeChecks(checks: DevLoopCheck[]): { ok: number; total: number } {
  return {
    ok: checks.filter((check) => check.ok).length,
    total: checks.length,
  };
}

export function renderCheckLines(checks: DevLoopCheck[]): string[] {
  return checks.flatMap((check) => {
    const marker = check.ok ? "✅" : "⚠️";
    return [`${marker} ${check.label}`, `   ${check.detail}`];
  });
}

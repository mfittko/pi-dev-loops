import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  collectDevLoopChecks as collectSharedDevLoopChecks,
  DEV_LOOP_CHECK_IDS,
  renderCheckLines,
  summarizeChecks,
} from "../lib/dev-loops-core.mjs";

export { DEV_LOOP_CHECK_IDS, renderCheckLines, summarizeChecks };

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

export function createExtensionCoreRuntime(pi: ExtensionAPI) {
  return {
    surface: "extension" as const,
    commandExists: (command: string) => commandExists(pi, command),
    ghAuthOk: () => ghAuthOk(pi),
    insideGitRepo: () => insideGitRepo(pi),
    async getSubagentAvailability() {
      const tools = pi.getAllTools();
      const ok = tools.some((tool) => tool.name === "subagent");
      return {
        ok,
        availableDetail: "`subagent` tool is available.",
        unavailableDetail: "Install/enable `pi-subagents`; current loops assume subagent support.",
      };
    },
    async getSkillAvailability(skillName: "dev-loop" | "copilot-dev-loop" | "copilot-autopilot") {
      const commands = pi.getCommands();
      const ok = commands.some((command) => command.name === `skill:${skillName}`);
      return {
        ok,
        availableDetail: ok ? `\`/skill:${skillName}\` is available.` : "",
        unavailableDetail: `Run \`/dev-loops install repo\` or \`/dev-loops install system\` to make \`/skill:${skillName}\` discoverable.`,
      };
    },
    async resolveRepoRoot() {
      try {
        const result = await pi.exec("bash", ["-lc", "git rev-parse --show-toplevel"], {
          timeout: 5_000,
        });

        if (result.code !== 0) {
          return undefined;
        }

        return result.stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export async function collectDevLoopChecks(pi: ExtensionAPI): Promise<DevLoopCheck[]> {
  return collectSharedDevLoopChecks(createExtensionCoreRuntime(pi));
}

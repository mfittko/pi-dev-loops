import path from "node:path";

import { resolveSystemSkillsRoot, syncPackagedSkills } from "./dev-loops-installer.mjs";

export const DEV_LOOP_CHECK_IDS = [
  "gh-installed",
  "gh-auth",
  "subagent-tool",
  "git-repo",
  "local-dev-loop-skill",
  "copilot-dev-loop-skill",
  "copilot-autopilot-skill",
];

const LOCAL_READINESS_IDS = ["subagent-tool", "git-repo", "local-dev-loop-skill"];
const REMOTE_READINESS_IDS = ["gh-installed", "gh-auth", "subagent-tool", "git-repo", "copilot-dev-loop-skill"];

function installGuidanceForSurface(surface) {
  return surface === "cli"
    ? "Run `pi-dev-loops install repo` or `pi-dev-loops install system` to install the packaged skills."
    : "Run `/dev-loops install repo` or `/dev-loops install system` to install the packaged skills.";
}

function buildSkillMetadata(surface = "extension") {
  const installGuidance = installGuidanceForSurface(surface);
  return {
    "dev-loop": {
      id: "local-dev-loop-skill",
      label: "Local dev-loop skill discoverable",
      unavailableDetail: `${installGuidance.replace('install the packaged skills.', 'make `/skill:dev-loop` discoverable.')}`,
    },
    "copilot-dev-loop": {
      id: "copilot-dev-loop-skill",
      label: "Copilot PR follow-up compatibility seam discoverable (internal/runtime)",
      availableDetail: "Internal Copilot PR follow-up compatibility seam is available.",
      unavailableDetail: `${installGuidance.replace('install the packaged skills.', 'install the internal routed compatibility seams used by GitHub-first follow-up paths.')}`,
    },
    "copilot-autopilot": {
      id: "copilot-autopilot-skill",
      label: "Copilot issue-intake compatibility seam discoverable (internal/runtime)",
      availableDetail: "Internal Copilot issue-intake compatibility seam is available.",
      unavailableDetail: `${installGuidance.replace('install the packaged skills.', 'install the internal routed compatibility seams used by GitHub-first intake paths.')}`,
    },
  };
}

function normalizeInput(input) {
  if (Array.isArray(input)) {
    return input.map((part) => `${part}`.trim()).filter(Boolean);
  }

  return `${input ?? ""}`.trim().split(/\s+/).filter(Boolean);
}

function normalizeProbe(probe, availableDetail, unavailableDetail) {
  if (typeof probe === "boolean") {
    return {
      ok: probe,
      detail: probe ? availableDetail : unavailableDetail,
    };
  }

  const ok = probe?.ok === true;
  return {
    ok,
    detail: ok
      ? availableDetail ?? probe?.availableDetail
      : unavailableDetail ?? probe?.unavailableDetail,
  };
}

function invalidCommand(message, usageAction, tokens) {
  return {
    kind: "malformed",
    message,
    usageAction,
    tokens,
  };
}

export function parseDevLoopsCommand(input, { surface = "extension" } = {}) {
  const tokens = normalizeInput(input);
  const [rawAction, rawScope, ...rest] = tokens;
  const action = rawAction?.toLowerCase();
  const extensionSurface = surface === "extension";

  switch (action) {
    case undefined:
    case "":
    case "help":
      return extensionSurface || (rest.length === 0 && rawScope === undefined)
        ? { kind: "action", action: "help", tokens }
        : invalidCommand("`help` does not accept additional arguments.", "help", tokens);
    case "status":
    case "doctor":
      return extensionSurface || (rest.length === 0 && rawScope === undefined)
        ? { kind: "action", action, tokens }
        : invalidCommand(`\`${action}\` does not accept additional arguments.`, action, tokens);
    case "hide":
      if (!extensionSurface && (rest.length > 0 || rawScope !== undefined)) {
        return invalidCommand("`hide` does not accept additional arguments.", "hide", tokens);
      }

      return extensionSurface
        ? { kind: "action", action: "hide", tokens }
        : {
            kind: "unsupported",
            action: "hide",
            message: "`pi-dev-loops hide` is not supported outside the Pi extension; use `/dev-loops hide` inside Pi instead.",
            tokens,
          };
    case "install":
    case "update": {
      const normalizedScope = rawScope?.toLowerCase();
      const scope = normalizedScope === "repo" || normalizedScope === "system" ? normalizedScope : undefined;

      if (rest.length > 0 || (rawScope !== undefined && scope === undefined)) {
        return invalidCommand(
          `\`${action}\` accepts only the optional target \`repo\` or \`system\`.`,
          action,
          tokens,
        );
      }

      return { kind: "action", action, scope, tokens };
    }
    default:
      return extensionSurface
        ? { kind: "action", action: "help", tokens }
        : invalidCommand(`Unrecognized command: ${rawAction}.`, undefined, tokens);
  }
}

export async function collectDevLoopChecks(runtime) {
  const skillMetadata = buildSkillMetadata(runtime?.surface);
  const [ghInstalled, ghAuthenticated, inGitRepo, subagentProbe, localSkillProbe, copilotSkillProbe, autopilotSkillProbe] =
    await Promise.all([
      runtime.commandExists("gh"),
      runtime.ghAuthOk(),
      runtime.insideGitRepo(),
      runtime.getSubagentAvailability(),
      runtime.getSkillAvailability("dev-loop"),
      runtime.getSkillAvailability("copilot-dev-loop"),
      runtime.getSkillAvailability("copilot-autopilot"),
    ]);

  const subagent = normalizeProbe(
    subagentProbe,
    "`subagent` tool is available.",
    "Install/enable `pi-subagents`; current loops assume subagent support.",
  );
  const localSkill = normalizeProbe(
    localSkillProbe,
    "`/skill:dev-loop` is available.",
    skillMetadata["dev-loop"].unavailableDetail,
  );
  const copilotSkill = normalizeProbe(
    copilotSkillProbe?.ok === true || copilotSkillProbe === true,
    skillMetadata["copilot-dev-loop"].availableDetail,
    skillMetadata["copilot-dev-loop"].unavailableDetail,
  );
  const autopilotSkill = normalizeProbe(
    autopilotSkillProbe?.ok === true || autopilotSkillProbe === true,
    skillMetadata["copilot-autopilot"].availableDetail,
    skillMetadata["copilot-autopilot"].unavailableDetail,
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
      ok: subagent.ok,
      detail: subagent.detail,
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
      id: skillMetadata["dev-loop"].id,
      label: skillMetadata["dev-loop"].label,
      ok: localSkill.ok,
      detail: localSkill.detail,
    },
    {
      id: skillMetadata["copilot-dev-loop"].id,
      label: skillMetadata["copilot-dev-loop"].label,
      ok: copilotSkill.ok,
      detail: copilotSkill.detail,
    },
    {
      id: skillMetadata["copilot-autopilot"].id,
      label: skillMetadata["copilot-autopilot"].label,
      ok: autopilotSkill.ok,
      detail: autopilotSkill.detail,
    },
  ];
}

export function summarizeChecks(checks) {
  return {
    ok: checks.filter((check) => check.ok).length,
    total: checks.length,
  };
}

export function renderCheckLines(checks) {
  return checks.flatMap((check) => {
    const marker = check.ok ? "✅" : "⚠️";
    return [`${marker} ${check.label}`, `   ${check.detail}`];
  });
}

function checkMap(checks) {
  return new Map(checks.map((check) => [check.id, check]));
}

export function describeReadiness(checks) {
  const byId = checkMap(checks);
  return {
    localReady: LOCAL_READINESS_IDS.every((id) => byId.get(id)?.ok),
    remoteReady: REMOTE_READINESS_IDS.every((id) => byId.get(id)?.ok),
  };
}

export async function executeDevLoopsCommand({ input, surface = "extension", runtime, homeDirectory }) {
  const parsed = parseDevLoopsCommand(input, { surface });

  if (parsed.kind !== "action") {
    return parsed;
  }

  switch (parsed.action) {
    case "help":
      return { kind: "help" };
    case "hide":
      return { kind: "hide" };
    case "status":
    case "doctor": {
      const checks = await collectDevLoopChecks(runtime);
      return {
        kind: "checks",
        action: parsed.action,
        checks,
      };
    }
    case "install":
    case "update": {
      if (!parsed.scope) {
        return {
          kind: "missing-target",
          action: parsed.action,
        };
      }

      let targetRoot = resolveSystemSkillsRoot(homeDirectory);

      if (parsed.scope === "repo") {
        const repoRoot = await runtime.resolveRepoRoot();

        if (!repoRoot) {
          return {
            kind: "blocked",
            action: parsed.action,
            scope: parsed.scope,
            message: `pi-dev-loops ${parsed.action} repo: not inside a git repository`,
          };
        }

        targetRoot = path.join(repoRoot, ".pi", "skills");
      }

      try {
        const result = await syncPackagedSkills({
          mode: parsed.action,
          scope: parsed.scope,
          targetRoot,
        });

        return {
          kind: "install-result",
          action: parsed.action,
          scope: parsed.scope,
          result,
        };
      } catch (error) {
        return {
          kind: "failed",
          action: parsed.action,
          scope: parsed.scope,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
    default:
      throw new Error(`Unhandled action: ${parsed.action}`);
  }
}

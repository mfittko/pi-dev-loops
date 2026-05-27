export const DEV_LOOP_CHECK_IDS = [
  "gh-installed",
  "gh-auth",
  "subagent-tool",
  "git-repo",
];

const LOCAL_READINESS_IDS = ["subagent-tool", "git-repo"];
const REMOTE_READINESS_IDS = ["gh-installed", "gh-auth", "subagent-tool", "git-repo"];

const PACKAGE_INSTALL_GUIDANCE =
  "Skills and agents are now installed automatically via `pi install git:github.com/mfittko/pi-dev-loops`. No manual install step is needed.";
const PACKAGE_LOCAL_INSTALL_GUIDANCE =
  "For a project-local install, use `pi install -l git:github.com/mfittko/pi-dev-loops` instead.";
const PACKAGE_UPDATE_GUIDANCE =
  "To refresh an existing package install, use `pi update git:github.com/mfittko/pi-dev-loops`.";

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
    case "update":
      return {
        kind: "action",
        action,
        scope: rawScope?.toLowerCase() === "repo" || rawScope?.toLowerCase() === "system" ? rawScope.toLowerCase() : undefined,
        tokens,
      };
    default:
      return extensionSurface
        ? { kind: "action", action: "help", tokens }
        : invalidCommand(`Unrecognized command: ${rawAction}.`, undefined, tokens);
  }
}

export async function collectDevLoopChecks(runtime, { surface = runtime?.surface ?? "extension" } = {}) {
  const [ghInstalled, ghAuthenticated, inGitRepo, subagentProbe] = await Promise.all([
    runtime.commandExists("gh"),
    runtime.ghAuthOk(),
    runtime.insideGitRepo(),
    runtime.getSubagentAvailability(),
  ]);

  const subagent = normalizeProbe(
    subagentProbe,
    "`subagent` tool is available.",
    "Install/enable `pi-subagents`; current loops assume subagent support.",
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

export function buildDeprecatedActionLines(action, scope) {
  const lines = [PACKAGE_INSTALL_GUIDANCE];

  if (scope === "repo") {
    lines.push(PACKAGE_LOCAL_INSTALL_GUIDANCE);
  } else if (action === "update") {
    lines.push(PACKAGE_UPDATE_GUIDANCE);
  }

  return lines;
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
      const checks = await collectDevLoopChecks(runtime, { surface });
      return {
        kind: "checks",
        action: parsed.action,
        checks,
      };
    }
    case "install":
    case "update":
      return {
        kind: "deprecated",
        action: parsed.action,
        scope: parsed.scope,
        lines: buildDeprecatedActionLines(parsed.action, parsed.scope),
      };
    default:
      throw new Error(`Unhandled action: ${parsed.action}`);
  }
}

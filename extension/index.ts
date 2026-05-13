import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { collectDevLoopChecks } from "./checks.ts";
import { resolveSystemSkillsRoot, syncPackagedSkills, type InstallScope } from "./installer.ts";
import {
  buildHelpLines,
  buildInstallFailureLines,
  buildInstallNotificationMessage,
  buildInstallResultLines,
  buildInstallUsageLines,
  buildNotificationMessage,
  buildRepoInstallErrorLines,
  buildWidgetLines,
  type DevLoopsAction,
} from "./presentation.ts";

const STATUS_KEY = "pi-dev-loops";
const WIDGET_KEY = "pi-dev-loops.setup";

type ParsedCommand =
  | { action: "help" | "status" | "doctor" | "hide" }
  | { action: "install" | "update"; scope?: InstallScope; invalidArgs?: boolean };

function parseAction(args: string): ParsedCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const [rawAction, rawScope, ...rest] = parts;
  const action = rawAction?.toLowerCase();

  switch (action) {
    case undefined:
    case "":
    case "help":
      return { action: "help" };
    case "status":
      return { action: "status" };
    case "doctor":
      return { action: "doctor" };
    case "hide":
      return { action: "hide" };
    case "install":
    case "update": {
      const normalizedScope = rawScope?.toLowerCase();
      const scope = normalizedScope === "repo" || normalizedScope === "system" ? normalizedScope : undefined;

      return {
        action,
        scope,
        invalidArgs: rest.length > 0 || (rawScope !== undefined && scope === undefined),
      };
    }
    default:
      return { action: "help" };
  }
}

async function resolveRepoRoot(pi: ExtensionAPI): Promise<string | undefined> {
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
}

async function renderStatus(ctx: ExtensionCommandContext, pi: ExtensionAPI, action: Extract<DevLoopsAction, "doctor" | "status">) {
  const checks = await collectDevLoopChecks(pi);
  const lines = buildWidgetLines(action, checks);

  ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "belowEditor" });
  ctx.ui.notify(buildNotificationMessage(action, checks), "info");
}

async function renderInstall(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  action: Extract<DevLoopsAction, "install" | "update">,
  scope?: InstallScope,
) {
  if (!scope) {
    ctx.ui.setWidget(WIDGET_KEY, buildInstallUsageLines(action), { placement: "belowEditor" });
    ctx.ui.notify(`pi-dev-loops ${action}: choose repo or system`, "info");
    return;
  }

  let resolvedTargetRoot = resolveSystemSkillsRoot(os.homedir());

  if (scope === "repo") {
    const repoRoot = await resolveRepoRoot(pi);

    if (!repoRoot) {
      ctx.ui.setWidget(WIDGET_KEY, buildRepoInstallErrorLines(action), { placement: "belowEditor" });
      ctx.ui.notify(`pi-dev-loops ${action} repo: not inside a git repository`, "error");
      return;
    }

    resolvedTargetRoot = path.join(repoRoot, ".pi", "skills");
  }

  try {
    const result = await syncPackagedSkills({
      mode: action,
      scope,
      targetRoot: resolvedTargetRoot,
    });

    ctx.ui.setWidget(WIDGET_KEY, buildInstallResultLines(result), { placement: "belowEditor" });
    ctx.ui.notify(buildInstallNotificationMessage(result), "info");
  } catch (error) {
    ctx.ui.setWidget(WIDGET_KEY, buildInstallFailureLines(action, scope, error), { placement: "belowEditor" });
    ctx.ui.notify(`pi-dev-loops ${action} ${scope}: failed`, "error");
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, "pi-dev-loops");
  });

  pi.registerCommand("dev-loops", {
    description: "Manage pi-dev-loops readiness and explicit skill install/update flows: /dev-loops [help|status|doctor|install [repo|system]|update [repo|system]|hide]",
    handler: async (args, ctx) => {
      const command = parseAction(args);

      if (command.action === "hide") {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.notify("pi-dev-loops widget hidden", "info");
        return;
      }

      if (command.action === "help") {
        ctx.ui.setWidget(WIDGET_KEY, buildHelpLines(), { placement: "belowEditor" });
        ctx.ui.notify("pi-dev-loops help", "info");
        return;
      }

      if (command.action === "status" || command.action === "doctor") {
        await renderStatus(ctx, pi, command.action);
        return;
      }

      if (command.invalidArgs) {
        ctx.ui.setWidget(WIDGET_KEY, buildInstallUsageLines(command.action), { placement: "belowEditor" });
        ctx.ui.notify(`pi-dev-loops ${command.action}: invalid arguments`, "error");
        return;
      }

      await renderInstall(ctx, pi, command.action, command.scope);
    },
  });
}

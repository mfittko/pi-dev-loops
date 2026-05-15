import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { executeDevLoopsCommand } from "../lib/dev-loops-core.mjs";
import { createExtensionCoreRuntime } from "./checks.ts";
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

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerCommand("dev-loops", {
    description: "Manage pi-dev-loops readiness and explicit skill install/update flows: /dev-loops [help|status|doctor|install [repo|system]|update [repo|system]|hide]",
    handler: async (args, ctx) => {
      const result = await executeDevLoopsCommand({
        input: args,
        surface: "extension",
        runtime: {
          ...createExtensionCoreRuntime(pi),
          resolveRepoRoot: () => resolveRepoRoot(pi),
        },
        homeDirectory: os.homedir(),
      });

      switch (result.kind) {
        case "hide":
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.notify("pi-dev-loops widget hidden", "info");
          return;
        case "help":
          ctx.ui.setWidget(WIDGET_KEY, buildHelpLines(), { placement: "belowEditor" });
          ctx.ui.notify("pi-dev-loops help", "info");
          return;
        case "checks":
          ctx.ui.setWidget(WIDGET_KEY, buildWidgetLines(result.action as Extract<DevLoopsAction, "doctor" | "status">, result.checks), {
            placement: "belowEditor",
          });
          ctx.ui.notify(buildNotificationMessage(result.action as Extract<DevLoopsAction, "doctor" | "status">, result.checks), "info");
          return;
        case "missing-target":
          ctx.ui.setWidget(WIDGET_KEY, buildInstallUsageLines(result.action), { placement: "belowEditor" });
          ctx.ui.notify(`pi-dev-loops ${result.action}: choose repo or system`, "info");
          return;
        case "blocked":
          ctx.ui.setWidget(WIDGET_KEY, buildRepoInstallErrorLines(result.action), { placement: "belowEditor" });
          ctx.ui.notify(`pi-dev-loops ${result.action} repo: not inside a git repository`, "error");
          return;
        case "install-result":
          ctx.ui.setWidget(WIDGET_KEY, buildInstallResultLines(result.result), { placement: "belowEditor" });
          ctx.ui.notify(buildInstallNotificationMessage(result.result), "info");
          return;
        case "failed":
          ctx.ui.setWidget(WIDGET_KEY, buildInstallFailureLines(result.action, result.scope, result.detail), {
            placement: "belowEditor",
          });
          ctx.ui.notify(`pi-dev-loops ${result.action} ${result.scope}: failed`, "error");
          return;
        case "malformed":
          if (result.usageAction) {
            ctx.ui.setWidget(WIDGET_KEY, buildInstallUsageLines(result.usageAction), { placement: "belowEditor" });
            ctx.ui.notify(`pi-dev-loops ${result.usageAction}: invalid arguments`, "error");
            return;
          }

          ctx.ui.setWidget(WIDGET_KEY, buildHelpLines(), { placement: "belowEditor" });
          ctx.ui.notify("pi-dev-loops help", "info");
          return;
        default:
          throw new Error(`Unhandled extension result: ${result satisfies never}`);
      }
    },
  });
}

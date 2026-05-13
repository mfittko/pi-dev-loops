import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { collectDevLoopChecks } from "./checks.ts";
import { buildNotificationMessage, buildWidgetLines, type DevLoopsAction } from "./presentation.ts";

const STATUS_KEY = "pi-dev-loops";
const WIDGET_KEY = "pi-dev-loops.setup";


function parseAction(args: string): DevLoopsAction {
  const action = args.trim().split(/\s+/, 1)[0]?.toLowerCase();
  switch (action) {
    case "":
    case undefined:
    case "status":
      return "status";
    case "doctor":
    case "setup":
    case "hide":
      return action;
    default:
      return "status";
  }
}

async function renderStatus(ctx: ExtensionCommandContext, pi: ExtensionAPI, action: Exclude<DevLoopsAction, "hide">) {
  const checks = await collectDevLoopChecks(pi);
  const lines = buildWidgetLines(action, checks);

  ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "belowEditor" });
  ctx.ui.notify(buildNotificationMessage(action, checks), "info");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, "pi-dev-loops");
  });

  pi.registerCommand("dev-loops", {
    description: "Manage pi-dev-loops setup and diagnostics: /dev-loops [setup|doctor|status|hide]",
    handler: async (args, ctx) => {
      const action = parseAction(args);

      if (action === "hide") {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.notify("pi-dev-loops widget hidden", "info");
        return;
      }

      await renderStatus(ctx, pi, action);
    },
  });
}

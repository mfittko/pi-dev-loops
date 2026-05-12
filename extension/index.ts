import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { collectDevLoopChecks, renderCheckLines, summarizeChecks } from "./checks";

const STATUS_KEY = "pi-dev-loops";
const WIDGET_KEY = "pi-dev-loops.setup";

type DevLoopsAction = "doctor" | "setup" | "status" | "hide";

function setupHints(): string[] {
  return [
    "Suggested next steps:",
    "- run /dev-loops doctor for a fresh readiness check",
    "- use /skill:dev-loop for local phase-based work",
    "- use /skill:copilot-dev-loop for GitHub/Copilot workflows",
    "- install/enable pi-subagents for the shared loop workflows",
  ];
}

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

async function renderStatus(ctx: ExtensionCommandContext, pi: ExtensionAPI, action: DevLoopsAction) {
  const checks = await collectDevLoopChecks(pi);
  const summary = summarizeChecks(checks);
  const lines = [
    `pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`,
    ...renderCheckLines(checks),
    ...(action === "setup" || action === "status" ? setupHints() : []),
  ];

  ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "belowEditor" });
  ctx.ui.notify(`pi-dev-loops ${action}: ${summary.ok}/${summary.total} checks passed`, "info");
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

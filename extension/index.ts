import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

import { executeDevLoopsCommand } from '../lib/dev-loops-core.mjs';
import { createExtensionCoreRuntime } from './checks.ts';
import {
  buildHelpLines,
  buildInspectRunNotification,
  buildInspectRunUiLines,
  buildNotificationMessage,
  buildWidgetLines,
  type DevLoopsAction,
  type InspectRunUiAction,
} from './presentation.ts';

const STATUS_KEY = 'pi-dev-loops';
const WIDGET_KEY = 'pi-dev-loops.setup';
const PACKAGED_AGENTS_ROOT = new URL('../.pi/agents/', import.meta.url);

export function syncPackagedAgents({
  sourceRoot = fileURLToPath(PACKAGED_AGENTS_ROOT),
  targetRoot = path.join(os.homedir(), '.agents'),
} = {}) {
  if (!fs.existsSync(sourceRoot)) {
    return;
  }

  fs.mkdirSync(targetRoot, { recursive: true });

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.agent.md')) {
      continue;
    }

    fs.copyFileSync(path.join(sourceRoot, entry.name), path.join(targetRoot, entry.name));
  }
}

export default function (pi: ExtensionAPI, runtimeOverrides = {}) {
  pi.on('session_start', async (_event, ctx) => {
    try {
      syncPackagedAgents();
    } catch {
      // Best-effort agent sync — do not break session start
    }
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerCommand('dev-loops', {
    description: 'Manage pi-dev-loops readiness and inspect-run local UI lifecycle: /dev-loops [help|status|doctor|hide|ui inspect-run ...]',
    handler: async (args, ctx) => {
      const result = await executeDevLoopsCommand({
        input: args,
        surface: 'extension',
        runtime: createExtensionCoreRuntime(pi, runtimeOverrides),
      });

      switch (result.kind) {
        case 'hide':
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.notify('pi-dev-loops widget hidden', 'info');
          return;
        case 'help':
          ctx.ui.setWidget(WIDGET_KEY, buildHelpLines(), { placement: 'belowEditor' });
          ctx.ui.notify('pi-dev-loops help', 'info');
          return;
        case 'checks':
          ctx.ui.setWidget(WIDGET_KEY, buildWidgetLines(result.action as Extract<DevLoopsAction, 'doctor' | 'status'>, result.checks), {
            placement: 'belowEditor',
          });
          ctx.ui.notify(buildNotificationMessage(result.action as Extract<DevLoopsAction, 'doctor' | 'status'>, result.checks), 'info');
          return;
        case 'ui_inspect_run_result': {
          const notificationLevel = result.state === 'running' ? 'info' : 'error';
          ctx.ui.setWidget(WIDGET_KEY, buildInspectRunUiLines(result.action as InspectRunUiAction, result), {
            placement: 'belowEditor',
          });
          ctx.ui.notify(buildInspectRunNotification(result.action as InspectRunUiAction, result.state), notificationLevel);
          return;
        }
        case 'malformed':
          ctx.ui.setWidget(WIDGET_KEY, [result.message, ...buildHelpLines()], { placement: 'belowEditor' });
          ctx.ui.notify(`pi-dev-loops ${result.usageAction ?? 'help'}: invalid arguments`, 'error');
          return;
        case 'unsupported': {
          const message = result.message || 'This command is not supported here.';
          ctx.ui.setWidget(WIDGET_KEY, [message, ...buildHelpLines()], { placement: 'belowEditor' });
          ctx.ui.notify(message, 'error');
          return;
        }
        default: {
          const exhaustiveCheck: never = result;
          throw new Error(`Unhandled extension result: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    },
  });
}

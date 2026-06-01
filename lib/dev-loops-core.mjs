export const DEV_LOOP_CHECK_IDS = [
  'gh-installed',
  'gh-auth',
  'subagent-command',
  'git-repo',
];

const LOCAL_READINESS_IDS = ['subagent-command', 'git-repo'];
const REMOTE_READINESS_IDS = ['gh-installed', 'gh-auth', 'subagent-command', 'git-repo'];
const INSPECT_RUN_UI_ACTIONS = new Set(['open', 'resume', 'status', 'stop', 'restart']);

function normalizeInput(input) {
  if (Array.isArray(input)) {
    return input.map((part) => `${part}`.trim()).filter(Boolean);
  }

  return `${input ?? ''}`.trim().split(/\s+/).filter(Boolean);
}

function normalizeProbe(probe, availableDetail, unavailableDetail) {
  if (typeof probe === 'boolean') {
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
    kind: 'malformed',
    message,
    usageAction,
    tokens,
  };
}

function parseInspectRunUiCommand(tokens, { surface }) {
  if (surface !== 'extension') {
    return invalidCommand('Unrecognized command: ui.', undefined, tokens);
  }

  const [, family, rawAction, ...rawArgs] = tokens;
  if (family !== 'inspect-run') {
    return invalidCommand('`/dev-loops ui` currently supports only `inspect-run`.', 'ui inspect-run', tokens);
  }

  const action = rawAction?.toLowerCase();
  if (!INSPECT_RUN_UI_ACTIONS.has(action)) {
    return invalidCommand('`/dev-loops ui inspect-run` only supports: open, resume, status, stop, restart.', 'ui inspect-run', tokens);
  }

  let repo;
  while (rawArgs.length > 0) {
    const token = rawArgs.shift();
    if (token === '--repo') {
      const value = rawArgs.shift();
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
        return invalidCommand('`--repo` requires `<owner/name>`.', 'ui inspect-run', tokens);
      }
      repo = value;
      continue;
    }
    return invalidCommand(`Unrecognized inspect-run UI argument: ${token}.`, 'ui inspect-run', tokens);
  }

  return {
    kind: 'ui_inspect_run_action',
    action,
    repo,
    tokens,
  };
}

export function parseDevLoopsCommand(input, { surface = 'extension' } = {}) {
  const tokens = normalizeInput(input);
  const [rawAction, rawScope, ...rest] = tokens;
  const action = rawAction?.toLowerCase();
  const extensionSurface = surface === 'extension';

  if (action === 'ui') {
    return parseInspectRunUiCommand(tokens, { surface });
  }

  switch (action) {
    case undefined:
    case '':
    case 'help':
      return extensionSurface || (rest.length === 0 && rawScope === undefined)
        ? { kind: 'action', action: 'help', tokens }
        : invalidCommand('`help` does not accept additional arguments.', 'help', tokens);
    case 'status':
    case 'doctor':
      return extensionSurface || (rest.length === 0 && rawScope === undefined)
        ? { kind: 'action', action, tokens }
        : invalidCommand(`\`${action}\` does not accept additional arguments.`, action, tokens);
    case 'hide':
      if (!extensionSurface && (rest.length > 0 || rawScope !== undefined)) {
        return invalidCommand('`hide` does not accept additional arguments.', 'hide', tokens);
      }

      return extensionSurface
        ? { kind: 'action', action: 'hide', tokens }
        : {
            kind: 'unsupported',
            action: 'hide',
            message: '`pi-dev-loops hide` is not supported outside the Pi extension; use `/dev-loops hide` inside Pi instead.',
            tokens,
          };
    default:
      return extensionSurface
        ? { kind: 'action', action: 'help', tokens }
        : invalidCommand(`Unrecognized command: ${rawAction}.`, undefined, tokens);
  }
}

export async function collectDevLoopChecks(runtime) {
  const [ghInstalled, ghAuthenticated, inGitRepo, subagentProbe] = await Promise.all([
    runtime.commandExists('gh'),
    runtime.ghAuthOk(),
    runtime.insideGitRepo(),
    runtime.getSubagentAvailability(),
  ]);

  const subagent = normalizeProbe(
    subagentProbe,
    '`subagent` command is available.',
    'Install or enable subagent support so `subagent` is available.',
  );

  return [
    {
      id: 'gh-installed',
      label: 'GitHub CLI installed',
      ok: ghInstalled,
      detail: ghInstalled ? '`gh` is available.' : 'Install GitHub CLI to use remote GitHub/Copilot loops.',
    },
    {
      id: 'gh-auth',
      label: 'GitHub CLI authenticated',
      ok: ghInstalled && ghAuthenticated,
      detail:
        ghInstalled && ghAuthenticated
          ? '`gh auth status` succeeded.'
          : ghInstalled
            ? 'Run `gh auth login` before using remote GitHub/Copilot loops.'
            : 'GitHub CLI is not installed yet.',
    },
    {
      id: 'subagent-command',
      label: 'Subagent command available',
      ok: subagent.ok,
      detail: subagent.detail,
    },
    {
      id: 'git-repo',
      label: 'Inside a git repository',
      ok: inGitRepo,
      detail: inGitRepo
        ? 'Current working directory is inside a git repo.'
        : 'Local and GitHub loops work best inside a git repository checkout.',
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
    const marker = check.ok ? '✅' : '⚠️';
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

export async function executeDevLoopsCommand({ input, surface = 'extension', runtime }) {
  const parsed = parseDevLoopsCommand(input, { surface });

  if (parsed.kind === 'ui_inspect_run_action') {
    if (surface !== 'extension' || typeof runtime?.uiLifecycle?.[parsed.action] !== 'function') {
      return {
        kind: 'unsupported',
        message: 'Inspect-run UI lifecycle commands are only available inside the Pi extension.',
        tokens: parsed.tokens,
      };
    }
    let repoRoot = null;
    try {
      repoRoot = await runtime.getRepoRoot();
    } catch (error) {
      return {
        kind: 'ui_inspect_run_result',
        action: parsed.action,
        repo: parsed.repo ?? null,
        repoRoot: null,
        state: 'stopped',
        url: null,
        detail: error instanceof Error ? error.message : String(error),
        warning: null,
      };
    }
    try {
      const result = await runtime.uiLifecycle[parsed.action]({ repoRoot, repo: parsed.repo });
      return {
        kind: 'ui_inspect_run_result',
        action: parsed.action,
        repo: parsed.repo ?? null,
        repoRoot,
        ...result,
      };
    } catch (error) {
      return {
        kind: 'ui_inspect_run_result',
        action: parsed.action,
        repo: parsed.repo ?? null,
        repoRoot,
        state: 'stopped',
        url: null,
        detail: error instanceof Error ? error.message : String(error),
        warning: null,
      };
    }
  }

  if (parsed.kind !== 'action') {
    return parsed;
  }

  switch (parsed.action) {
    case 'help':
      return { kind: 'help' };
    case 'hide':
      return { kind: 'hide' };
    case 'status':
    case 'doctor': {
      const checks = await collectDevLoopChecks(runtime);
      return {
        kind: 'checks',
        action: parsed.action,
        checks,
      };
    }
    default:
      throw new Error(`Unhandled action: ${parsed.action}`);
  }
}

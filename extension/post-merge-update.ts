import type {
  AgentEndEvent,
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  UserBashEvent,
  UserBashEventResult,
} from '@mariozechner/pi-coding-agent';

export const TARGET_REPO_SLUG = 'mfittko/pi-dev-loops';
export const POST_MERGE_UPDATE_COMMAND = 'pi update git:github.com/mfittko/pi-dev-loops';

const MERGE_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const POST_MERGE_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const REPO_RESOLUTION_TIMEOUT_MS = 5_000;

type RepoContext = {
  repoRoot: string | null;
  repoSlug: string | null;
};

type RunCommandArgs = {
  command: string;
  cwd?: string;
  timeout?: number;
};

type RunCommandResult = ExecResult;

type PostMergeUpdateHookState = {
  pendingPostMergeUpdate: boolean;
  updateInFlight: boolean;
  lastTriggerToken: string | null;
  pendingRepoRoot: string | null;
};

type CreatePostMergeUpdateHookOptions = {
  resolveRepoContext?: (cwd: string) => Promise<RepoContext>;
  runCommand?: (args: RunCommandArgs) => Promise<RunCommandResult>;
};

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = `${value ?? ''}`.trim();
  return trimmed ? trimmed : null;
}

function buildMergeTriggerToken(command: string, repoRoot: string, repoSlug: string): string {
  return `${repoSlug}\n${repoRoot}\n${command.trim()}`;
}

function buildShellOutput(result: Pick<RunCommandResult, 'stdout' | 'stderr'>): string {
  const stdout = `${result.stdout ?? ''}`.trimEnd();
  const stderr = `${result.stderr ?? ''}`.trimEnd();
  if (stdout && stderr) {
    return `${stdout}\n${stderr}`;
  }
  return stdout || stderr;
}

function buildFailureSummary(result: Pick<RunCommandResult, 'stdout' | 'stderr' | 'code' | 'killed'>): string {
  return trimToNull(result.stderr)
    ?? trimToNull(result.stdout)
    ?? (result.killed
      ? 'command was killed before completing'
      : (typeof result.code === 'number' ? `exit code ${result.code}` : 'exit code unavailable'));
}

function getBashCommandFromToolResult(event: ToolResultEvent): string | null {
  if (event.toolName !== 'bash') {
    return null;
  }
  const command = event.input?.command;
  return typeof command === 'string' ? command : null;
}

function notify(ctx: ExtensionContext, message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

async function defaultResolveRepoContext(pi: ExtensionAPI, cwd: string): Promise<RepoContext> {
  const rootResult = await pi.exec('bash', ['-lc', 'git rev-parse --show-toplevel'], {
    cwd,
    timeout: REPO_RESOLUTION_TIMEOUT_MS,
  });
  if (rootResult.code !== 0) {
    return { repoRoot: null, repoSlug: null };
  }

  const repoRoot = trimToNull(rootResult.stdout);
  if (!repoRoot) {
    return { repoRoot: null, repoSlug: null };
  }

  const remoteResult = await pi.exec('bash', ['-lc', 'git config --get remote.origin.url'], {
    cwd: repoRoot,
    timeout: REPO_RESOLUTION_TIMEOUT_MS,
  });
  if (remoteResult.code !== 0) {
    return { repoRoot, repoSlug: null };
  }

  return {
    repoRoot,
    repoSlug: normalizeGitHubRepoSlug(remoteResult.stdout),
  };
}

async function defaultRunCommand(pi: ExtensionAPI, args: RunCommandArgs): Promise<RunCommandResult> {
  return pi.exec('bash', ['-lc', args.command], {
    cwd: args.cwd,
    timeout: args.timeout,
  });
}

function markPendingUpdate(state: PostMergeUpdateHookState, command: string, repoContext: RepoContext): void {
  if (!repoContext.repoRoot || repoContext.repoSlug !== TARGET_REPO_SLUG) {
    return;
  }

  const triggerToken = buildMergeTriggerToken(command, repoContext.repoRoot, repoContext.repoSlug);
  if (state.lastTriggerToken === triggerToken || state.pendingPostMergeUpdate) {
    state.lastTriggerToken = triggerToken;
    state.pendingRepoRoot ??= repoContext.repoRoot;
    return;
  }

  state.pendingPostMergeUpdate = true;
  state.pendingRepoRoot = repoContext.repoRoot;
  state.lastTriggerToken = triggerToken;
}

async function resolveRepoContextSafe(
  resolveRepoContext: (cwd: string) => Promise<RepoContext>,
  cwd: string,
): Promise<RepoContext | null> {
  try {
    return await resolveRepoContext(cwd);
  } catch {
    return null;
  }
}

async function queueIfEligible(
  state: PostMergeUpdateHookState,
  resolveRepoContext: (cwd: string) => Promise<RepoContext>,
  command: string,
  cwd: string,
): Promise<boolean> {
  if (!isMergeCapableCommand(command)) {
    return false;
  }

  const repoContext = await resolveRepoContextSafe(resolveRepoContext, cwd);
  if (!repoContext?.repoRoot || repoContext.repoSlug !== TARGET_REPO_SLUG) {
    return false;
  }

  markPendingUpdate(state, command, repoContext);
  return true;
}

export function normalizeGitHubRepoSlug(remoteUrl: string): string | null {
  const normalized = trimToNull(remoteUrl);
  if (!normalized) {
    return null;
  }

  const patterns = [
    /^git@github\.com:([^\s]+?)(?:\.git)?$/i,
    /^https:\/\/github\.com\/([^\s]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^\s]+?)(?:\.git)?$/i,
    /^git:github\.com\/([^\s]+?)(?:\.git)?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }
    return trimToNull(match[1])?.toLowerCase() ?? null;
  }

  return null;
}

function isGhPrMergeCommand(segment: string): boolean {
  if (!/^gh\s+pr\s+merge(?:\s|$)/i.test(segment)) {
    return false;
  }

  const remainder = segment.replace(/^gh\s+pr\s+merge(?:\s|$)/i, '').trim();
  if (!remainder) {
    return true;
  }

  const firstArg = remainder.match(/^(\S+)/)?.[1]?.toLowerCase() ?? '';
  return !['--help', '-h'].includes(firstArg);
}

function isGitMergeCompletionCommand(segment: string): boolean {
  if (!/^git\s+merge(?:\s|$)/i.test(segment)) {
    return false;
  }

  const remainder = segment.replace(/^git\s+merge(?:\s|$)/i, '').trim();
  if (!remainder) {
    return true;
  }

  const firstArg = remainder.match(/^(\S+)/)?.[1]?.toLowerCase() ?? '';
  return !['--abort', '--continue', '--quit', '--help', '-h'].includes(firstArg);
}

export function isMergeCapableCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }

  return normalized
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .some((segment) => isGhPrMergeCommand(segment) || isGitMergeCompletionCommand(segment));
}

export function createPostMergeUpdateHook(
  piOrOptions: ExtensionAPI | CreatePostMergeUpdateHookOptions,
  maybeOptions: CreatePostMergeUpdateHookOptions = {},
) {
  const hasPiExec = typeof (piOrOptions as ExtensionAPI)?.exec === 'function';
  const pi = hasPiExec ? piOrOptions as ExtensionAPI : null;
  const options = hasPiExec ? maybeOptions : (piOrOptions as CreatePostMergeUpdateHookOptions);

  const resolveRepoContext = options.resolveRepoContext
    ?? (pi ? ((cwd: string) => defaultResolveRepoContext(pi, cwd)) : null);
  const runCommand = options.runCommand
    ?? (pi ? ((args: RunCommandArgs) => defaultRunCommand(pi, args)) : null);

  if (!resolveRepoContext || !runCommand) {
    throw new Error('createPostMergeUpdateHook requires an ExtensionAPI or explicit resolveRepoContext/runCommand overrides.');
  }

  const state: PostMergeUpdateHookState = {
    pendingPostMergeUpdate: false,
    updateInFlight: false,
    lastTriggerToken: null,
    pendingRepoRoot: null,
  };

  function reset(): void {
    state.pendingPostMergeUpdate = false;
    state.updateInFlight = false;
    state.lastTriggerToken = null;
    state.pendingRepoRoot = null;
  }

  return {
    getState(): PostMergeUpdateHookState {
      return { ...state };
    },

    onSessionStart(): void {
      reset();
    },

    async onToolResult(event: Pick<ToolResultEvent, 'toolName' | 'input' | 'isError'>, ctx: Pick<ExtensionContext, 'cwd'>): Promise<void> {
      const command = getBashCommandFromToolResult(event as ToolResultEvent);
      if (!command || event.isError) {
        return;
      }
      await queueIfEligible(state, resolveRepoContext, command, ctx.cwd);
    },

    async onUserBash(event: Pick<UserBashEvent, 'command' | 'cwd'>, _ctx?: ExtensionContext): Promise<UserBashEventResult | undefined> {
      if (!isMergeCapableCommand(event.command)) {
        return undefined;
      }

      const repoContext = await resolveRepoContextSafe(resolveRepoContext, event.cwd);
      if (!repoContext?.repoRoot || repoContext.repoSlug !== TARGET_REPO_SLUG) {
        return undefined;
      }

      try {
        const result = await runCommand({
          command: event.command,
          cwd: event.cwd,
          timeout: MERGE_COMMAND_TIMEOUT_MS,
        });

        if (result.code === 0 && !result.killed) {
          markPendingUpdate(state, event.command, repoContext);
        }

        return {
          result: {
            output: buildShellOutput(result),
            exitCode: result.killed ? undefined : result.code,
            cancelled: Boolean(result.killed),
            truncated: false,
          },
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          result: {
            output: detail,
            exitCode: 1,
            cancelled: false,
            truncated: false,
          },
        };
      }
    },

    async onAgentEnd(_event: AgentEndEvent, ctx: Pick<ExtensionContext, 'cwd' | 'hasUI' | 'ui'>): Promise<void> {
      if (!state.pendingPostMergeUpdate || state.updateInFlight) {
        return;
      }

      state.updateInFlight = true;
      notify(ctx as ExtensionContext, `Post-merge update running: ${POST_MERGE_UPDATE_COMMAND}`, 'info');

      try {
        const result = await runCommand({
          command: POST_MERGE_UPDATE_COMMAND,
          cwd: state.pendingRepoRoot ?? ctx.cwd,
          timeout: POST_MERGE_UPDATE_TIMEOUT_MS,
        });

        if (result.code === 0 && !result.killed) {
          notify(ctx as ExtensionContext, `Post-merge update completed: ${POST_MERGE_UPDATE_COMMAND}`, 'info');
        } else {
          notify(
            ctx as ExtensionContext,
            `Post-merge update failed (warning only): ${buildFailureSummary(result)}`,
            'warning',
          );
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notify(ctx as ExtensionContext, `Post-merge update failed (warning only): ${detail}`, 'warning');
      } finally {
        reset();
      }
    },
  };
}

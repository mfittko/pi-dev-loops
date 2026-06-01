import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeCliRepoOption } from './cli.mjs';
import { DEFAULT_HOST, DEFAULT_PORT } from './constants.mjs';
import { formatInspectRunViewerUrl, listListeningPidsForPort } from './server.mjs';

export const INSPECT_RUN_VIEWER_SURFACE_ID = 'inspect-run-viewer';
export const INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH = '.pi/ui-servers/inspect-run-viewer.json';
const VIEWER_SCRIPT_PATH = fileURLToPath(new URL('../inspect-run-viewer.mjs', import.meta.url));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRequestedRepo(repo) {
  if (repo === undefined || repo === null || `${repo}`.trim() === '') {
    return null;
  }
  return normalizeCliRepoOption(`${repo}`);
}

function buildLaunchArgs(repo) {
  return {
    repo,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
  };
}

function buildArgsFingerprint(launchArgs) {
  return JSON.stringify({ repo: launchArgs.repo, host: launchArgs.host, port: launchArgs.port });
}

function buildRecordPayload({ repoRoot, launchArgs, pid, startedAt }) {
  return {
    schemaVersion: 1,
    surfaceId: INSPECT_RUN_VIEWER_SURFACE_ID,
    argsFingerprint: buildArgsFingerprint(launchArgs),
    launchArgs,
    host: launchArgs.host,
    port: launchArgs.port,
    url: formatInspectRunViewerUrl(launchArgs.host, launchArgs.port),
    pid,
    startedAt,
    cwd: repoRoot,
  };
}

function baseUrlForRecord(record) {
  const host = record?.host ?? DEFAULT_HOST;
  const port = record?.port ?? DEFAULT_PORT;
  return formatInspectRunViewerUrl(host, port);
}

function buildOperatorUrl(record, requestedRepo) {
  const baseUrl = baseUrlForRecord(record);
  const managedRepo = record?.launchArgs?.repo ?? null;
  if (requestedRepo === null || managedRepo !== null) {
    return baseUrl;
  }
  const url = new URL(baseUrl);
  url.searchParams.set('scope', requestedRepo);
  return url.toString().replace(/\/$/, '');
}

function canServeRequestedRepo(record, requestedRepo) {
  if (!record) {
    return false;
  }
  if (requestedRepo === null) {
    return true;
  }
  const managedRepo = record.launchArgs?.repo ?? null;
  return managedRepo === null || managedRepo === requestedRepo;
}

async function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

async function defaultHealthcheck(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function defaultLaunchManagedServer({ repoRoot, repo, host, port }) {
  const args = [VIEWER_SCRIPT_PATH, '--host', host, '--port', String(port)];
  if (repo !== null) {
    args.push('--repo', repo);
  }
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return { pid: child.pid };
}

async function defaultStopManagedProcess(pid) {
  process.kill(pid, 'SIGTERM');
}

async function defaultOpenBrowser(url) {
  let command;
  let args;
  let options = { detached: true, stdio: 'ignore' };
  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      options = { detached: true, stdio: 'ignore', windowsHide: true };
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }
  const child = spawn(command, args, options);
  child.on('error', () => {});
  child.unref();
}

async function readManagedRecord(recordPath) {
  try {
    return JSON.parse(await readFile(recordPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      return {
        invalidRecord: true,
        parseError: error.message,
      };
    }
    throw error;
  }
}

async function writeManagedRecord(recordPath, payload) {
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function removeManagedRecord(recordPath) {
  await rm(recordPath, { force: true });
}

async function waitForManagedExit(record, { isProcessAliveImpl, listListeningPidsImpl, waitImpl, timeoutMs = 3000, pollIntervalMs = 100 }) {
  if (!record?.pid) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [alive, listeners] = await Promise.all([
      isProcessAliveImpl(record.pid),
      listListeningPidsImpl(record.port ?? DEFAULT_PORT),
    ]);
    if (!alive && !listeners.includes(record.pid)) {
      return;
    }
    await waitImpl(pollIntervalMs);
  }
}

function summarizeRunning(record, requestedRepo) {
  return {
    state: 'running',
    url: buildOperatorUrl(record, requestedRepo),
    detail: 'Managed inspect-run viewer is running.',
  };
}

export function createInspectRunViewerLifecycleManager({
  listListeningPidsImpl = listListeningPidsForPort,
  isProcessAliveImpl = defaultIsProcessAlive,
  healthcheckUrlImpl = defaultHealthcheck,
  launchManagedServerImpl = defaultLaunchManagedServer,
  stopManagedProcessImpl = defaultStopManagedProcess,
  openBrowserImpl = defaultOpenBrowser,
  nowImpl = () => new Date().toISOString(),
  waitImpl = sleep,
} = {}) {
  async function inspectRecord({ repoRoot }) {
    const recordPath = path.join(repoRoot, INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH);
    const record = await readManagedRecord(recordPath);
    if (record?.invalidRecord === true) {
      return {
        recordPath,
        record: null,
        state: 'stale_record',
        url: formatInspectRunViewerUrl(DEFAULT_HOST, DEFAULT_PORT),
        detail: 'The managed inspect-run viewer record is unreadable; delete `.pi/ui-servers/inspect-run-viewer.json` and reopen the viewer.',
        listeners: await listListeningPidsImpl(DEFAULT_PORT),
      };
    }
    if (!record) {
      const listeners = await listListeningPidsImpl(DEFAULT_PORT);
      if (listeners.length > 0) {
        return {
          recordPath,
          record: null,
          state: 'conflict_unmanaged_listener',
          url: formatInspectRunViewerUrl(DEFAULT_HOST, DEFAULT_PORT),
          detail: 'Port 4311 is occupied by an unmanaged listener.',
          listeners,
        };
      }
      return {
        recordPath,
        record: null,
        state: 'stopped',
        url: null,
        detail: 'No managed inspect-run viewer is recorded.',
        listeners: [],
      };
    }

    const listeners = await listListeningPidsImpl(record.port ?? DEFAULT_PORT);
    const alive = typeof record.pid === 'number' && record.pid > 0
      ? await isProcessAliveImpl(record.pid)
      : false;
    const listening = alive && listeners.includes(record.pid);
    const healthy = listening ? await healthcheckUrlImpl(baseUrlForRecord(record)) : false;

    if (alive && listening && healthy) {
      return {
        recordPath,
        record,
        state: 'running',
        url: baseUrlForRecord(record),
        detail: 'Managed inspect-run viewer is running.',
        listeners,
      };
    }

    return {
      recordPath,
      record,
      state: 'stale_record',
      url: baseUrlForRecord(record),
      detail: 'The managed inspect-run viewer record is stale.',
      listeners,
    };
  }

  async function startFresh({ repoRoot, requestedRepo }) {
    const launchArgs = buildLaunchArgs(requestedRepo);
    const recordPath = path.join(repoRoot, INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH);
    const baseUrl = formatInspectRunViewerUrl(launchArgs.host, launchArgs.port);
    const listeners = await listListeningPidsImpl(launchArgs.port);
    if (listeners.length > 0) {
      return {
        state: 'conflict_unmanaged_listener',
        url: baseUrl,
        detail: 'Port 4311 is occupied by an unmanaged listener.',
        warning: null,
        recordPath,
      };
    }

    const { pid } = await launchManagedServerImpl({
      repoRoot,
      repo: requestedRepo,
      host: launchArgs.host,
      port: launchArgs.port,
      url: baseUrl,
    });
    const record = buildRecordPayload({ repoRoot, launchArgs, pid, startedAt: nowImpl() });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const [alive, healthy] = await Promise.all([
        isProcessAliveImpl(pid),
        healthcheckUrlImpl(baseUrl),
      ]);
      if (!alive) {
        throw new Error('inspect-run viewer exited before becoming healthy');
      }
      if (healthy) {
        await writeManagedRecord(recordPath, record);
        return {
          state: 'running',
          url: buildOperatorUrl(record, requestedRepo),
          detail: 'Started a managed inspect-run viewer.',
          warning: null,
          recordPath,
          record,
          startedFresh: true,
          reusedExisting: false,
          resumedExisting: false,
        };
      }
      await waitImpl(100);
    }

    throw new Error('inspect-run viewer did not become healthy before the startup timeout');
  }

  async function maybeOpenBrowser(result) {
    if (result.state !== 'running' || typeof result.url !== 'string' || result.url.length === 0) {
      return result;
    }
    try {
      await openBrowserImpl(result.url);
      return result;
    } catch (error) {
      return {
        ...result,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    async open({ repoRoot, repo } = {}) {
      const requestedRepo = normalizeRequestedRepo(repo);
      const snapshot = await inspectRecord({ repoRoot });
      if (snapshot.state === 'running' && canServeRequestedRepo(snapshot.record, requestedRepo)) {
        return maybeOpenBrowser({
          ...summarizeRunning(snapshot.record, requestedRepo),
          warning: null,
          recordPath: snapshot.recordPath,
          record: snapshot.record,
          startedFresh: false,
          reusedExisting: true,
          resumedExisting: false,
        });
      }

      if (snapshot.state === 'running' && snapshot.record) {
        await stopManagedProcessImpl(snapshot.record.pid);
        await waitForManagedExit(snapshot.record, {
          isProcessAliveImpl,
          listListeningPidsImpl,
          waitImpl,
        });
        await removeManagedRecord(snapshot.recordPath);
      } else if (snapshot.state === 'stale_record') {
        if (snapshot.record?.pid && await isProcessAliveImpl(snapshot.record.pid)) {
          await stopManagedProcessImpl(snapshot.record.pid);
          await waitForManagedExit(snapshot.record, {
            isProcessAliveImpl,
            listListeningPidsImpl,
            waitImpl,
          });
        }
        await removeManagedRecord(snapshot.recordPath);
      }

      return maybeOpenBrowser(await startFresh({ repoRoot, requestedRepo }));
    },

    async resume({ repoRoot, repo } = {}) {
      const requestedRepo = normalizeRequestedRepo(repo);
      const snapshot = await inspectRecord({ repoRoot });
      if (snapshot.state === 'running' && canServeRequestedRepo(snapshot.record, requestedRepo)) {
        return {
          ...summarizeRunning(snapshot.record, requestedRepo),
          warning: null,
          recordPath: snapshot.recordPath,
          record: snapshot.record,
          startedFresh: false,
          reusedExisting: false,
          resumedExisting: true,
        };
      }
      return {
        state: snapshot.state === 'conflict_unmanaged_listener' ? 'conflict_unmanaged_listener' : 'stopped',
        url: snapshot.state === 'conflict_unmanaged_listener' ? snapshot.url : null,
        detail: 'No managed inspect-run viewer is running; use `/dev-loops ui inspect-run open`.',
        warning: null,
        recordPath: snapshot.recordPath,
        record: snapshot.record,
        startedFresh: false,
        reusedExisting: false,
        resumedExisting: false,
      };
    },

    async status({ repoRoot, repo } = {}) {
      const requestedRepo = normalizeRequestedRepo(repo);
      const snapshot = await inspectRecord({ repoRoot });
      if (snapshot.state === 'running') {
        if (!canServeRequestedRepo(snapshot.record, requestedRepo)) {
          return {
            state: 'stopped',
            url: null,
            detail: 'A different managed inspect-run viewer is running; use `open` to replace it for this repo.',
            warning: null,
            recordPath: snapshot.recordPath,
            record: snapshot.record,
          };
        }
        return {
          ...summarizeRunning(snapshot.record, requestedRepo),
          warning: null,
          recordPath: snapshot.recordPath,
          record: snapshot.record,
        };
      }
      return {
        state: snapshot.state,
        url: snapshot.state === 'stopped' ? null : buildOperatorUrl(snapshot.record ?? undefined, requestedRepo),
        detail: snapshot.detail,
        warning: null,
        recordPath: snapshot.recordPath,
        record: snapshot.record,
      };
    },

    async stop({ repoRoot, repo } = {}) {
      const requestedRepo = normalizeRequestedRepo(repo);
      const snapshot = await inspectRecord({ repoRoot });
      if (snapshot.state === 'running' && snapshot.record && canServeRequestedRepo(snapshot.record, requestedRepo)) {
        await stopManagedProcessImpl(snapshot.record.pid);
        await waitForManagedExit(snapshot.record, {
          isProcessAliveImpl,
          listListeningPidsImpl,
          waitImpl,
        });
        await removeManagedRecord(snapshot.recordPath);
        const listeners = await listListeningPidsImpl(snapshot.record.port ?? DEFAULT_PORT);
        if (listeners.length > 0) {
          return {
            state: 'conflict_unmanaged_listener',
            url: baseUrlForRecord(snapshot.record),
            detail: 'Stopped the managed inspect-run viewer, but another listener is still using the port.',
            warning: null,
            recordPath: snapshot.recordPath,
            record: null,
          };
        }
        return {
          state: 'stopped',
          url: null,
          detail: 'Stopped the managed inspect-run viewer.',
          warning: null,
          recordPath: snapshot.recordPath,
          record: null,
        };
      }

      if (snapshot.state === 'running' && snapshot.record && !canServeRequestedRepo(snapshot.record, requestedRepo)) {
        return {
          state: 'stopped',
          url: null,
          detail: 'A different managed inspect-run viewer is running; stop without `--repo` or use `open` to replace it for this repo.',
          warning: null,
          recordPath: snapshot.recordPath,
          record: snapshot.record,
        };
      }

      if (snapshot.state === 'stale_record') {
        await removeManagedRecord(snapshot.recordPath);
        const listeners = await listListeningPidsImpl(snapshot.record?.port ?? DEFAULT_PORT);
        return {
          state: listeners.length > 0 ? 'conflict_unmanaged_listener' : 'stopped',
          url: listeners.length > 0 ? baseUrlForRecord(snapshot.record) : null,
          detail: listeners.length > 0
            ? 'Cleared the stale managed record, but the port is still occupied by an unmanaged listener.'
            : 'Cleared the stale managed inspect-run viewer record.',
          warning: null,
          recordPath: snapshot.recordPath,
          record: null,
        };
      }

      return {
        state: snapshot.state,
        url: snapshot.state === 'conflict_unmanaged_listener' ? snapshot.url : null,
        detail: snapshot.detail,
        warning: null,
        recordPath: snapshot.recordPath,
        record: null,
      };
    },

    async restart({ repoRoot, repo } = {}) {
      const requestedRepo = normalizeRequestedRepo(repo);
      const snapshot = await inspectRecord({ repoRoot });
      const restartRepo = snapshot.record?.launchArgs?.repo ?? requestedRepo;

      if (snapshot.state === 'running' && snapshot.record) {
        if (requestedRepo !== null && !canServeRequestedRepo(snapshot.record, requestedRepo)) {
          return {
            state: 'stopped',
            url: null,
            detail: 'Restart uses the managed instance arguments; stop/open to switch repos.',
            warning: null,
            recordPath: snapshot.recordPath,
            record: snapshot.record,
          };
        }
        await stopManagedProcessImpl(snapshot.record.pid);
        await waitForManagedExit(snapshot.record, {
          isProcessAliveImpl,
          listListeningPidsImpl,
          waitImpl,
        });
        await removeManagedRecord(snapshot.recordPath);
      } else if (snapshot.state === 'stale_record') {
        await removeManagedRecord(snapshot.recordPath);
      } else if (snapshot.state === 'conflict_unmanaged_listener') {
        return {
          state: 'conflict_unmanaged_listener',
          url: snapshot.url,
          detail: 'Restart refused to stop an unmanaged listener on the inspect-run viewer port.',
          warning: null,
          recordPath: snapshot.recordPath,
          record: snapshot.record,
        };
      }

      return {
        ...(await startFresh({ repoRoot, requestedRepo: restartRepo })),
        detail: 'Restarted the managed inspect-run viewer.',
      };
    },
  };
}

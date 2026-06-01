import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
  INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH,
  createInspectRunViewerLifecycleManager,
} from '../../scripts/loop/inspect-run-viewer/managed-instance.mjs';

function createManager(overrides = {}) {
  const listenersByPort = new Map();
  const processes = new Map();
  const browserOpens = [];
  const launches = [];
  const stopped = [];
  let nextPid = 4000;

  const manager = createInspectRunViewerLifecycleManager({
    nowImpl: () => '2026-06-01T12:00:00.000Z',
    async listListeningPidsImpl(port) {
      return [...(listenersByPort.get(port) ?? [])];
    },
    async isProcessAliveImpl(pid) {
      return processes.get(pid)?.alive === true;
    },
    async healthcheckUrlImpl(url) {
      return [...processes.values()].some((entry) => entry.url === url && entry.healthy === true);
    },
    async launchManagedServerImpl({ repoRoot, repo, host, port, url }) {
      const pid = nextPid++;
      launches.push({ repoRoot, repo, host, port, url, pid });
      processes.set(pid, { alive: true, healthy: true, port, url, repo });
      listenersByPort.set(port, [pid]);
      return { pid };
    },
    async stopManagedProcessImpl(pid) {
      stopped.push(pid);
      const processEntry = processes.get(pid);
      if (processEntry) {
        processEntry.alive = false;
        processEntry.healthy = false;
        listenersByPort.set(processEntry.port, (listenersByPort.get(processEntry.port) ?? []).filter((value) => value !== pid));
      }
    },
    async openBrowserImpl(url) {
      browserOpens.push(url);
    },
    ...overrides,
  });

  return {
    manager,
    listenersByPort,
    processes,
    browserOpens,
    launches,
    stopped,
  };
}

test('managed seam writes and reads the repo-local record on open/status', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-managed-'));
  const { manager, browserOpens, launches } = createManager();

  const opened = await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(opened.state, 'running');
  assert.equal(opened.startedFresh, true);
  assert.equal(opened.reusedExisting, false);
  assert.equal(opened.url, 'http://127.0.0.1:4311');
  assert.deepEqual(browserOpens, ['http://127.0.0.1:4311']);
  assert.equal(launches.length, 1);

  const recordPath = path.join(repoRoot, INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  assert.equal(record.surfaceId, 'inspect-run-viewer');
  assert.equal(record.launchArgs.repo, 'mfittko/pi-dev-loops');
  assert.equal(record.pid, launches[0].pid);
  assert.equal(record.cwd, repoRoot);

  const status = await manager.status({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(status.state, 'running');
  assert.equal(status.url, 'http://127.0.0.1:4311');
  assert.match(status.detail, /managed/i);
});

test('status reports stale_record when the saved pid is dead', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-stale-'));
  const { manager, processes, launches, listenersByPort } = createManager();

  await manager.open({ repoRoot });
  processes.get(launches[0].pid).alive = false;
  processes.get(launches[0].pid).healthy = false;
  listenersByPort.set(4311, []);

  const status = await manager.status({ repoRoot });
  assert.equal(status.state, 'stale_record');
  assert.equal(status.url, 'http://127.0.0.1:4311');
});

test('status reports conflict_unmanaged_listener when no managed record exists but the port is occupied', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-conflict-'));
  const { manager, listenersByPort, processes } = createManager();
  listenersByPort.set(4311, [9001]);
  processes.set(9001, { alive: true, healthy: true, port: 4311, url: 'http://127.0.0.1:4311' });

  const status = await manager.status({ repoRoot });
  assert.equal(status.state, 'conflict_unmanaged_listener');
  assert.equal(status.url, 'http://127.0.0.1:4311');
});

test('open reuses a matching live managed instance instead of relaunching', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-reuse-'));
  const { manager, launches, browserOpens } = createManager();

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const reopened = await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });

  assert.equal(reopened.state, 'running');
  assert.equal(reopened.reusedExisting, true);
  assert.equal(reopened.startedFresh, false);
  assert.equal(launches.length, 1);
  assert.equal(browserOpens.length, 2);
});

test('resume fails closed and does not auto-start when nothing live is managed', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-resume-'));
  const { manager, launches, browserOpens } = createManager();

  const resumed = await manager.resume({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(resumed.state, 'stopped');
  assert.equal(resumed.resumedExisting, false);
  assert.equal(resumed.url, null);
  assert.equal(resumed.detail.includes('open'), true);
  assert.equal(launches.length, 0);
  assert.equal(browserOpens.length, 0);
});

test('stop only terminates the recorded managed pid', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-stop-'));
  const { manager, listenersByPort, processes, stopped, launches } = createManager();

  await manager.open({ repoRoot });
  listenersByPort.set(4311, [launches[0].pid, 9002]);
  processes.set(9002, { alive: true, healthy: true, port: 4311, url: 'http://127.0.0.1:4311' });

  const stoppedResult = await manager.stop({ repoRoot });
  assert.equal(stoppedResult.state, 'conflict_unmanaged_listener');
  assert.deepEqual(stopped, [launches[0].pid]);
  assert.equal(processes.get(9002).alive, true);
});

test('restart only replaces managed ownership and fails closed on an unknown listener conflict', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-restart-'));
  const { manager, listenersByPort, processes, stopped, launches } = createManager();

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const managedPid = launches[0].pid;
  processes.get(managedPid).alive = false;
  processes.get(managedPid).healthy = false;
  listenersByPort.set(4311, [9111]);
  processes.set(9111, { alive: true, healthy: true, port: 4311, url: 'http://127.0.0.1:4311' });

  const restarted = await manager.restart({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(restarted.state, 'conflict_unmanaged_listener');
  assert.deepEqual(stopped, []);
  assert.equal(launches.length, 1);
});

test('open recovers from a stale record by replacing it with a fresh managed instance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-open-stale-'));
  const { manager, launches, processes, listenersByPort } = createManager();

  await manager.open({ repoRoot });
  processes.get(launches[0].pid).alive = false;
  processes.get(launches[0].pid).healthy = false;
  listenersByPort.set(4311, []);

  const reopened = await manager.open({ repoRoot });
  assert.equal(reopened.state, 'running');
  assert.equal(reopened.startedFresh, true);
  assert.equal(launches.length, 2);
});

test('open reports a warning instead of failing when browser auto-open errors', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-browser-warning-'));
  const { manager } = createManager({
    async openBrowserImpl() {
      throw new Error('browser unavailable');
    },
  });

  const opened = await manager.open({ repoRoot });
  assert.equal(opened.state, 'running');
  assert.equal(opened.warning, 'browser unavailable');
});

test('status treats an unreadable managed record as stale_record with delete guidance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-corrupt-record-'));
  await mkdir(path.join(repoRoot, '.pi', 'ui-servers'), { recursive: true });
  await writeFile(path.join(repoRoot, INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH), '{not json\n');
  const { manager } = createManager();

  const status = await manager.status({ repoRoot });
  assert.equal(status.state, 'stale_record');
  assert.match(status.detail, /delete/i);
});

test('stop fails closed with explicit guidance when --repo does not match the managed instance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-stop-mismatch-'));
  const { manager, launches, stopped } = createManager();

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const result = await manager.stop({ repoRoot, repo: 'other/repo' });

  assert.equal(result.state, 'stopped');
  assert.equal(result.url, null);
  assert.match(result.detail, /different managed inspect-run viewer/i);
  assert.equal(stopped.length, 0);
  assert.equal(launches.length, 1);
});

test('open does not attempt to auto-open a browser for conflict_unmanaged_listener results', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-open-conflict-'));
  const { manager, listenersByPort, processes, browserOpens } = createManager();
  listenersByPort.set(4311, [9555]);
  processes.set(9555, { alive: true, healthy: true, port: 4311, url: 'http://127.0.0.1:4311' });

  const result = await manager.open({ repoRoot });
  assert.equal(result.state, 'conflict_unmanaged_listener');
  assert.deepEqual(browserOpens, []);
});

test('status treats a record with the wrong surface identity as stale_record', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-wrong-surface-'));
  await mkdir(path.join(repoRoot, '.pi', 'ui-servers'), { recursive: true });
  await writeFile(path.join(repoRoot, INSPECT_RUN_VIEWER_MANAGED_RECORD_PATH), `${JSON.stringify({
    schemaVersion: 99,
    surfaceId: 'something-else',
    pid: 123,
    host: '127.0.0.1',
    port: 4311,
    url: 'http://127.0.0.1:4311',
    launchArgs: { repo: null, host: '127.0.0.1', port: 4311 },
  })}\n`);
  const { manager } = createManager();

  const status = await manager.status({ repoRoot });
  assert.equal(status.state, 'stale_record');
  assert.match(status.detail, /delete/i);
});

test('open does not kill a stale recorded pid when it is alive but not listening on the viewer port', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-stale-pid-reuse-'));
  const { manager, processes, launches, stopped, listenersByPort } = createManager();

  await manager.open({ repoRoot });
  const stalePid = launches[0].pid;
  processes.get(stalePid).healthy = false;
  processes.get(stalePid).port = 9999;
  listenersByPort.set(4311, []);

  const reopened = await manager.open({ repoRoot });
  assert.equal(reopened.state, 'running');
  assert.deepEqual(stopped, []);
});

test('open cleans up the spawned process when startup never becomes healthy', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-launch-timeout-'));
  const stopped = [];
  const manager = createInspectRunViewerLifecycleManager({
    async listListeningPidsImpl() {
      return [];
    },
    async isProcessAliveImpl(pid) {
      return pid === 7123;
    },
    async healthcheckUrlImpl() {
      return false;
    },
    async launchManagedServerImpl() {
      return { pid: 7123 };
    },
    async stopManagedProcessImpl(pid) {
      stopped.push(pid);
    },
    async waitImpl() {
      // keep the timeout loop fast
    },
    nowImpl: () => '2026-06-01T12:00:00.000Z',
    async openBrowserImpl() {},
  });

  await assert.rejects(manager.open({ repoRoot }), /startup timeout/i);
  assert.deepEqual(stopped, [7123]);
});

test('open tolerates ESRCH while replacing a managed instance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-open-esrch-'));
  let nextPid = 5000;
  let listenerPid = null;
  const alive = new Set();
  const stopCalls = [];
  const manager = createInspectRunViewerLifecycleManager({
    async listListeningPidsImpl() {
      return listenerPid === null ? [] : [listenerPid];
    },
    async isProcessAliveImpl(pid) {
      return alive.has(pid);
    },
    async healthcheckUrlImpl() {
      return listenerPid !== null && alive.has(listenerPid);
    },
    async launchManagedServerImpl() {
      const pid = nextPid++;
      listenerPid = pid;
      alive.add(pid);
      return { pid };
    },
    async stopManagedProcessImpl(pid) {
      stopCalls.push(pid);
      alive.delete(pid);
      listenerPid = null;
      const error = new Error('gone');
      error.code = 'ESRCH';
      throw error;
    },
    async waitImpl() {},
    nowImpl: () => '2026-06-01T12:00:00.000Z',
    async openBrowserImpl() {},
  });

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const reopened = await manager.open({ repoRoot, repo: 'other/repo' });
  assert.equal(reopened.state, 'running');
  assert.deepEqual(stopCalls, [5000]);
});

test('stop and restart treat ESRCH as already-stopped', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'inspect-run-viewer-stop-restart-esrch-'));
  let nextPid = 6000;
  let listenerPid = null;
  const alive = new Set();
  let stopCalls = 0;
  const manager = createInspectRunViewerLifecycleManager({
    async listListeningPidsImpl() {
      return listenerPid === null ? [] : [listenerPid];
    },
    async isProcessAliveImpl(pid) {
      return alive.has(pid);
    },
    async healthcheckUrlImpl() {
      return listenerPid !== null && alive.has(listenerPid);
    },
    async launchManagedServerImpl() {
      const pid = nextPid++;
      listenerPid = pid;
      alive.add(pid);
      return { pid };
    },
    async stopManagedProcessImpl(pid) {
      stopCalls += 1;
      alive.delete(pid);
      listenerPid = null;
      const error = new Error('gone');
      error.code = 'ESRCH';
      throw error;
    },
    async waitImpl() {},
    nowImpl: () => '2026-06-01T12:00:00.000Z',
    async openBrowserImpl() {},
  });

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const stopped = await manager.stop({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(stopped.state, 'stopped');

  await manager.open({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  const restarted = await manager.restart({ repoRoot, repo: 'mfittko/pi-dev-loops' });
  assert.equal(restarted.state, 'running');
  assert.equal(stopCalls, 2);
});

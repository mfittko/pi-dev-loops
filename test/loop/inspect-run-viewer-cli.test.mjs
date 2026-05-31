import assert from "node:assert/strict";
import test from "node:test";

import {
  formatInspectRunViewerUrl,
  listListeningPidsForPort,
  parseInspectRunViewerCliArgs,
  restartExistingPortListener,
  runCli,
} from "../../scripts/loop/inspect-run-viewer.mjs";
test("parseInspectRunViewerCliArgs normalizes repo values and rejects malformed input with usage", () => {
  const parsed = parseInspectRunViewerCliArgs(["--repo", "  owner/repo  "]);
  assert.equal(parsed.repo, "owner/repo");
  assert.equal("pr" in parsed, false);

  const unscoped = parseInspectRunViewerCliArgs([]);
  assert.equal(unscoped.repo, undefined);
  assert.equal("pr" in unscoped, false);

  const bracketedIpv6Host = parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "[::1]"]);
  assert.equal(bracketedIpv6Host.host, "::1");

  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "0.0.0.0"]),
    /--host must stay on localhost\/loopback unless --allow-non-localhost is set/i,
  );

  const nonLocalhostOptIn = parseInspectRunViewerCliArgs([
    "--repo",
    "owner/repo",
    "--host",
    "0.0.0.0",
    "--allow-non-localhost",
    "--restart",
  ]);
  assert.equal(nonLocalhostOptIn.host, "0.0.0.0");
  assert.equal(nonLocalhostOptIn.allowNonLocalhost, true);
  assert.equal(nonLocalhostOptIn.restart, true);

  let malformedTargetError;
  try {
    parseInspectRunViewerCliArgs(["--repo", "../../bad"]);
  } catch (error) {
    malformedTargetError = error;
  }
  assert.ok(malformedTargetError instanceof Error);
  assert.match(malformedTargetError.message, /Invalid repository slug|owner\/name|Repository slug/i);
  assert.equal(typeof malformedTargetError.usage, "string");
  assert.ok(malformedTargetError.usage.length > 0);
  assert.match(malformedTargetError.usage, /Usage: inspect-run-viewer\.mjs \[--repo <owner\/name>\]/);

  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55"]),
    /--pr is no longer supported on the CLI/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs([
      "--repo",
      "owner/repo",
      "--reviewer-login",
      "reviewer",
      "--reviewer-input",
      "tmp/reviewer.json",
    ]),
    /cannot be combined/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--reviewer-login", "   "]),
    /must not be empty/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--host", "   "]),
    /--host must not be empty/i,
  );
});

test("restartExistingPortListener is a no-op when nothing is listening", async () => {
  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => [],
  });

  assert.deepEqual(restarted, []);
});


test("listListeningPidsForPort only treats empty-stderr lsof exit 1 as no listeners", async () => {
  const emptyResult = await listListeningPidsForPort(4311, {
    execFileImpl: async () => {
      const error = new Error("no listeners");
      error.code = 1;
      error.stderr = "";
      throw error;
    },
  });

  assert.deepEqual(emptyResult, []);

  await assert.rejects(
    () => listListeningPidsForPort(4311, {
      execFileImpl: async () => {
        const error = new Error("unsupported flag");
        error.code = 1;
        error.stderr = "lsof: illegal option";
        throw error;
      },
    }),
    /unsupported flag/,
  );
});

test("restartExistingPortListener stops existing listeners on the chosen port", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111, 222] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111, 222]);
  assert.deepEqual(killed, [
    [111, "SIGTERM"],
    [222, "SIGTERM"],
  ]);
});


test("restartExistingPortListener tolerates listeners that exit before SIGTERM", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111, 222] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
      if (pid === 111) {
        const error = new Error("process already exited");
        error.code = "ESRCH";
        throw error;
      }
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111, 222]);
  assert.deepEqual(killed, [
    [111, "SIGTERM"],
    [222, "SIGTERM"],
  ]);
});


test("restartExistingPortListener waits for the port to become free, not for the process to exit", async () => {
  const killed = [];
  let pollCount = 0;

  const restarted = await restartExistingPortListener(4311, {
    listListeningPidsImpl: async () => {
      pollCount += 1;
      return pollCount === 1 ? [111] : [];
    },
    killProcessImpl: (pid, signal) => {
      killed.push([pid, signal]);
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(restarted, [111]);
  assert.deepEqual(killed, [[111, "SIGTERM"]]);
  assert.equal(pollCount, 2);
});

test("formatInspectRunViewerUrl formats IPv4 and IPv6 hosts for copy-pasteable output", () => {
  assert.equal(formatInspectRunViewerUrl("127.0.0.1", 4311), "http://127.0.0.1:4311");
  assert.equal(formatInspectRunViewerUrl("::1", 4311), "http://[::1]:4311");
  assert.equal(formatInspectRunViewerUrl("[::1]", 4311), "http://[::1]:4311");
  assert.equal(formatInspectRunViewerUrl("0.0.0.0", 4311), "http://0.0.0.0:4311");
});
test("runCli explains missing lsof when --restart is requested", async () => {
  await assert.rejects(
    () => runCli([
      "--repo",
      "owner/repo",
      "--restart",
    ], {
      stdout: { write() {} },
      restartExistingPortListenerImpl: async () => {
        const error = new Error("spawn lsof ENOENT");
        error.code = "ENOENT";
        error.path = "lsof";
        throw error;
      },
    }),
    (error) => {
      assert.match(error.message, /--restart requires lsof\/POSIX support/i);
      assert.equal(typeof error.usage, "string");
      assert.match(error.usage, /--restart/);
      return true;
    },
  );
});

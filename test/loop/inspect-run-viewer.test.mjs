import assert from "node:assert/strict";
import { once } from "node:events";
import { get, request } from "node:http";
import test from "node:test";

import {
  createInspectRunViewerServer,
  formatInspectRunViewerUrl,
  listListeningPidsForPort,
  parseInspectRunViewerCliArgs,
  renderInspectRunViewerHtml,
  restartExistingPortListener,
  runCli,
} from "../../scripts/loop/inspect-run-viewer.mjs";
import { createInspectionViewerAdapter } from "../../scripts/loop/_inspect-run-viewer-adapter.mjs";

function makeSnapshot(overrides = {}) {
  return {
    ok: true,
    schemaVersion: 1,
    target: { repo: "owner/repo", pr: 55 },
    runId: "pr-55",
    inspectedAt: "2026-05-21T00:00:00.000Z",
    activeStateFamily: "copilot-pr-outer-loop",
    outerAction: "continue_wait",
    activeFamilyState: "continue_wait",
    statusClass: "waiting",
    needsAttention: false,
    sourceMode: "live-detector-backed",
    trust: "authoritative",
    evidence: { summary: "Live detectors agree.", authoritative: ["live"], checkpoint: [] },
    markers: { missing: [], stale: [], conflicts: [] },
    layers: {
      copilot: { currentState: "waiting_for_copilot_review" },
      reviewer: { currentState: "waiting_for_author_followup", scope: { mode: "all_reviewers", reviewerLogin: null } },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
    ...overrides,
  };
}

function requestOnce(url, { method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("parseInspectRunViewerCliArgs normalizes target values and rejects malformed input with usage", () => {
  const parsed = parseInspectRunViewerCliArgs(["--repo", "  owner/repo  ", "--pr", "55"]);
  assert.equal(parsed.repo, "owner/repo");
  assert.equal(parsed.pr, 55);

  const bracketedIpv6Host = parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--host", "[::1]"]);
  assert.equal(bracketedIpv6Host.host, "::1");

  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--host", "0.0.0.0"]),
    /--host must stay on localhost\/loopback unless --allow-non-localhost is set/i,
  );

  const nonLocalhostOptIn = parseInspectRunViewerCliArgs([
    "--repo",
    "owner/repo",
    "--pr",
    "55",
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
    parseInspectRunViewerCliArgs(["--repo", "../../bad", "--pr", "55"]);
  } catch (error) {
    malformedTargetError = error;
  }
  assert.ok(malformedTargetError instanceof Error);
  assert.match(malformedTargetError.message, /Invalid repository slug|owner\/name|Repository slug/i);
  assert.equal(typeof malformedTargetError.usage, "string");
  assert.ok(malformedTargetError.usage.length > 0);

  assert.throws(
    () => parseInspectRunViewerCliArgs([
      "--repo",
      "owner/repo",
      "--pr",
      "55",
      "--reviewer-login",
      "reviewer",
      "--reviewer-input",
      "tmp/reviewer.json",
    ]),
    /cannot be combined/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--reviewer-login", "   "]),
    /must not be empty/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--host", "   "]),
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

test("renderInspectRunViewerHtml renders required top-level fields for authoritative snapshot and links to raw JSON", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
  });

  assert.match(html, /PR #55 inspection/);
  assert.match(html, /target\.repo/);
  assert.match(html, /owner\/repo/);
  assert.match(html, /target\.pr/);
  assert.match(html, /55/);
  assert.match(html, /runId/);
  assert.match(html, /pr-55/);
  assert.match(html, /inspectedAt/);
  assert.match(html, /activeStateFamily/);
  assert.match(html, /outerAction/);
  assert.match(html, /activeFamilyState/);
  assert.match(html, /statusClass/);
  assert.match(html, /needsAttention/);
  assert.match(html, /sourceMode/);
  assert.match(html, /trust/);
  assert.match(html, /evidence\.summary/);
  assert.match(html, /markers\.missing/);
  assert.match(html, /markers\.stale/);
  assert.match(html, /markers\.conflicts/);
  assert.match(html, /outer-loop summary/);
  assert.match(html, /copilot layer/);
  assert.match(html, /reviewer layer/);
  assert.match(html, /steering summary/);
  assert.match(html, /href="\/snapshot\.json"/);
  assert.match(html, /title="Reload snapshot"/);
  assert.match(html, /manual reload only/i);
  assert.doesNotMatch(html, /<pre>/);
  assert.doesNotMatch(html, /"schemaVersion": 1/);
  assert.doesNotMatch(html, /"ok": true/);
});

test("renderInspectRunViewerHtml renders checkpoint-only / degraded cues and absent sections", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      sourceMode: "checkpoint-only",
      trust: "checkpoint",
      needsAttention: true,
      outerAction: "unknown",
      activeFamilyState: "unknown",
      statusClass: "unknown",
      layers: {
        steering: { status: "unavailable", reason: "no_steering_file" },
      },
    }),
  });

  assert.match(html, /checkpoint-only/);
  assert.match(html, /not present \/ unavailable/);
  assert.match(html, /no_steering_file/);
});

test("renderInspectRunViewerHtml renders conflicting snapshot cues", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      needsAttention: true,
      markers: {
        missing: [],
        stale: [],
        conflicts: ["checkpoint outerAction 'continue_wait' differs from live-derived 'reenter_copilot_loop'"],
      },
    }),
  });

  assert.match(html, /Snapshot state:[\s\S]*conflicting/);
  assert.match(html, /checkpoint outerAction/);
});

test("renderInspectRunViewerHtml renders unavailable snapshot and malformed target load errors explicitly", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "bad target", pr: "x" },
    snapshot: null,
    error: new Error("target.pr must be a positive integer"),
  });

  assert.match(html, /Snapshot unavailable/);
  assert.match(html, /target\.pr must be a positive integer/);
  assert.match(html, /manual reload only/i);
  assert.match(html, /href="\/snapshot\.json"/);
});


test("renderInspectRunViewerHtml treats undefined snapshots as unavailable", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: undefined,
  });

  assert.match(html, /Snapshot unavailable/);
  assert.match(html, /Unable to load inspect-run snapshot/);
});

test("createInspectionViewerAdapter loadSnapshot validates target deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "owner/repo", pr: "nope" }),
    /positive integer/,
  );
  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "../../bad", pr: 55 }),
    /target\.repo must match <owner\/name>/,
  );
});

test("createInspectionViewerAdapter keeps normalized target authoritative over options", async () => {
  let inspectRunCall;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async (input) => {
      inspectRunCall = input;
      return { ok: true };
    },
  });

  await adapter.loadSnapshot(
    { repo: "owner/repo", pr: "55" },
    { repo: "other/repo", pr: 99, reviewerLogin: "reviewer" },
  );

  assert.deepEqual(inspectRunCall, {
    repo: "owner/repo",
    pr: 55,
    reviewerLogin: "reviewer",
  });
});

test("createInspectRunViewerServer serves browser html from adapter snapshot without inline full snapshot dump", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot({ sourceMode: "partial", trust: "degraded" });
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /PR #55 inspection/);
    assert.match(response.body, /owner\/repo/);
    assert.match(response.body, /degraded/);
    assert.match(response.body, /manual reload only/i);
    assert.match(response.body, /href="\/snapshot\.json"/);
    assert.doesNotMatch(response.body, /"schemaVersion": 1/);
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer serves authoritative snapshot JSON on /snapshot.json", async () => {
  let loadCount = 0;
  const snapshot = makeSnapshot({ sourceMode: "partial", trust: "degraded" });
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return snapshot;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), snapshot);
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer treats missing JSON snapshots as machine-readable failures", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return undefined;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);

    assert.equal(response.statusCode, 500);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "inspection snapshot unavailable" },
    });
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer keeps JSON failures machine-readable and HTML failures browser-friendly", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      throw new Error("inspection snapshot unavailable");
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    const htmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/`);
    assert.equal(htmlResponse.statusCode, 200);
    assert.equal(htmlResponse.headers["content-type"], "text/html; charset=utf-8");
    assert.match(htmlResponse.body, /Snapshot unavailable/);
    assert.match(htmlResponse.body, /inspection snapshot unavailable/);

    const jsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`);
    assert.equal(jsonResponse.statusCode, 500);
    assert.equal(jsonResponse.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(jsonResponse.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(jsonResponse.body), {
      ok: false,
      target: { repo: "owner/repo", pr: 55 },
      error: { message: "inspection snapshot unavailable" },
    });

    assert.equal(loadCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createInspectRunViewerServer keeps favicon, unsupported paths, and unsupported methods load-free", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return makeSnapshot();
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    const faviconResponse = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}/favicon.ico`, (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers }));
      }).on("error", reject);
    });
    assert.equal(faviconResponse.statusCode, 204);
    assert.equal(loadCount, 0);

    const missingResponse = await requestOnce(`http://127.0.0.1:${address.port}/nope`);
    assert.equal(missingResponse.statusCode, 404);
    assert.equal(missingResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);

    const postHtmlResponse = await requestOnce(`http://127.0.0.1:${address.port}/`, { method: "POST" });
    assert.equal(postHtmlResponse.statusCode, 405);
    assert.equal(postHtmlResponse.headers.allow, "GET");
    assert.equal(postHtmlResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);

    const postJsonResponse = await requestOnce(`http://127.0.0.1:${address.port}/snapshot.json`, { method: "POST" });
    assert.equal(postJsonResponse.statusCode, 405);
    assert.equal(postJsonResponse.headers.allow, "GET");
    assert.equal(postJsonResponse.headers["cache-control"], "no-store");

    const postMissingPathResponse = await requestOnce(`http://127.0.0.1:${address.port}/nope`, { method: "POST" });
    assert.equal(postMissingPathResponse.statusCode, 404);
    assert.equal(postMissingPathResponse.headers["cache-control"], "no-store");
    assert.equal(loadCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("createInspectRunViewerServer guards malformed request URLs and undefined snapshots", async () => {
  let loadCount = 0;
  const adapter = {
    async loadSnapshot() {
      loadCount += 1;
      return undefined;
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await requestOnce(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Snapshot unavailable/);
    assert.match(response.body, /href="\/snapshot\.json"/);
    assert.equal(loadCount, 1);

    const malformedResponse = await new Promise((resolve) => {
      const fakeRequest = Object.defineProperty({}, "url", {
        enumerable: true,
        get() {
          throw new Error("URI malformed");
        },
      });
      const result = {
        statusCode: undefined,
        headers: {},
        body: "",
      };
      const fakeResponse = {
        statusCode: undefined,
        setHeader(name, value) {
          result.headers[name] = value;
        },
        end(body = "") {
          result.statusCode = this.statusCode;
          result.body = String(body);
          resolve(result);
        },
      };

      server.emit("request", fakeRequest, fakeResponse);
    });

    assert.equal(malformedResponse.statusCode, 400);
    assert.equal(malformedResponse.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(malformedResponse.headers["cache-control"], "no-store");
    assert.equal(malformedResponse.body, "Bad Request");
    assert.equal(loadCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runCli explains missing lsof when --restart is requested", async () => {
  await assert.rejects(
    () => runCli([
      "--repo",
      "owner/repo",
      "--pr",
      "55",
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

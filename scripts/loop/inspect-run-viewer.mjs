#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { formatCliError } from "../_core-helpers.mjs";
import {
  createInspectionViewerAdapter,
  normalizeInspectionTarget,
} from "./_inspect-run-viewer-adapter.mjs";

const USAGE = `Usage: inspect-run-viewer.mjs --repo <owner/name> --pr <number>
  [--host <host>] [--port <port>] [--allow-non-localhost] [--restart]
  [--steering-state-file <path>] [--reviewer-login <login>]
  [--copilot-input <path>] [--reviewer-input <path>]

Single-run local browser viewer for the inspect-run read-only snapshot.

Required:
  --repo <owner/name>
  --pr <number>

Optional:
  --host <host>                         Bind host (default: 127.0.0.1)
  --port <port>                         Bind port (default: 4311)
  --allow-non-localhost                 Permit non-loopback binds
                                        (otherwise rejected)
  --restart                             Stop any existing listener on the
                                        chosen port before starting
                                        (requires lsof/POSIX; sends
                                        SIGTERM to all listeners)
  --steering-state-file <path>          Pass-through to inspect-run
  --reviewer-login <login>              Pass-through to inspect-run
  --copilot-input <path>                Pass-through to inspect-run
  --reviewer-input <path>               Pass-through to inspect-run
                                        (cannot be combined with
                                        --reviewer-login)`.trim();

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4311;
const execFile = promisify(execFileCallback);

function parseError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function requireOptionValue(args, flag) {
  const value = args.shift();
  const missing = typeof value !== "string" || value.length === 0 || value.startsWith("--");
  if (missing) {
    throw parseError(`Missing value for ${flag}`);
  }
  return value;
}

function parsePort(rawPort) {
  if (!/^\d+$/.test(rawPort)) {
    throw parseError("--port must be a positive integer");
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw parseError("--port must be between 1 and 65535");
  }
  return port;
}

function parseHost(rawHost) {
  const host = rawHost.trim();
  if (host.length === 0) {
    throw parseError("--host must not be empty");
  }
  if (/^\[[^\]]+\]$/.test(host)) {
    return host.slice(1, -1);
  }
  return host;
}

function isLoopbackHost(host) {
  return host === "localhost"
    || host === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function parseReviewerLogin(rawLogin) {
  const reviewerLogin = rawLogin.trim();
  if (reviewerLogin.length === 0) {
    throw parseError("--reviewer-login must not be empty");
  }
  return reviewerLogin;
}

function normalizeCliTargetOptions(options) {
  try {
    return normalizeInspectionTarget({ repo: options.repo, pr: options.pr });
  } catch (error) {
    throw parseError(error instanceof Error ? error.message : String(error));
  }
}

export function parseInspectRunViewerCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    pr: undefined,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    steeringStateFile: undefined,
    reviewerLogin: undefined,
    copilotInputPath: undefined,
    reviewerInputPath: undefined,
    allowNonLocalhost: false,
    restart: false,
  };

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }
    if (token === "--repo") {
      options.repo = requireOptionValue(args, "--repo");
      continue;
    }
    if (token === "--pr") {
      options.pr = requireOptionValue(args, "--pr");
      continue;
    }
    if (token === "--host") {
      options.host = parseHost(requireOptionValue(args, "--host"));
      continue;
    }
    if (token === "--port") {
      options.port = parsePort(requireOptionValue(args, "--port"));
      continue;
    }
    if (token === "--allow-non-localhost") {
      options.allowNonLocalhost = true;
      continue;
    }
    if (token === "--restart") {
      options.restart = true;
      continue;
    }
    if (token === "--steering-state-file") {
      options.steeringStateFile = requireOptionValue(args, "--steering-state-file");
      continue;
    }
    if (token === "--reviewer-login") {
      options.reviewerLogin = parseReviewerLogin(requireOptionValue(args, "--reviewer-login"));
      continue;
    }
    if (token === "--copilot-input") {
      options.copilotInputPath = requireOptionValue(args, "--copilot-input");
      continue;
    }
    if (token === "--reviewer-input") {
      options.reviewerInputPath = requireOptionValue(args, "--reviewer-input");
      continue;
    }
    throw parseError(`Unknown argument: ${token}`);
  }

  if (!options.help) {
    if (options.repo === undefined || options.pr === undefined) {
      throw parseError("inspect-run-viewer requires both --repo <owner/name> and --pr <number>");
    }
    if (options.reviewerInputPath !== undefined && options.reviewerLogin !== undefined) {
      throw parseError("--reviewer-input cannot be combined with --reviewer-login");
    }

    const normalizedTarget = normalizeCliTargetOptions(options);
    options.repo = normalizedTarget.repo;
    options.pr = normalizedTarget.pr;
    if (!options.allowNonLocalhost && !isLoopbackHost(options.host)) {
      throw parseError("--host must stay on localhost/loopback unless --allow-non-localhost is set");
    }
  }

  return options;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<p>none</p>";
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderDefinitionList(entries) {
  return `<dl>${entries.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function normalizeTransitions(transitions) {
  if (!Array.isArray(transitions)) {
    return [];
  }
  return transitions.filter((transition) => typeof transition === "string" && transition.trim().length > 0);
}

function renderStateGraph({ title, currentState, transitions }) {
  const normalizedCurrentState = typeof currentState === "string" && currentState.length > 0
    ? currentState
    : "not present";
  const normalizedTransitions = normalizeTransitions(transitions);
  const transitionNodes = normalizedTransitions.length === 0
    ? `<span class="state-node state-node-idle">no allowed transitions</span>`
    : normalizedTransitions
      .map((transition) => `<span class="state-arrow" aria-hidden="true">→</span><span class="state-node state-node-next">${escapeHtml(transition)}</span>`)
      .join("");

  return `<article class="state-graph-card">
    <h3>${escapeHtml(title)}</h3>
    <p class="state-graph-current-label">Current</p>
    <div class="state-flow" role="img" aria-label="${escapeHtml(`${title} state flow with current state ${normalizedCurrentState}`)}">
      <span class="state-node state-node-current">${escapeHtml(normalizedCurrentState)}</span>
      ${transitionNodes}
    </div>
    <p class="state-graph-meta"><strong>Allowed next transitions:</strong> ${normalizedTransitions.length === 0 ? "none" : normalizedTransitions.map((transition) => `<code>${escapeHtml(transition)}</code>`).join(", ")}</p>
  </article>`;
}

function renderStateVisualizationSection(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    return `<section>
      <h2>State visualization</h2>
      <p>Snapshot unavailable, so no state graph can be rendered yet.</p>
    </section>`;
  }

  return `<section>
    <h2>State visualization</h2>
    <p class="state-graph-intro">Graph-first view of the authoritative inspection snapshot.</p>
    <div class="state-graph-grid">
      ${renderStateGraph({
    title: "outer-loop family",
    currentState: snapshot.activeFamilyState,
    transitions: [],
  })}
      ${renderStateGraph({
    title: "copilot layer",
    currentState: snapshot.layers?.copilot?.currentState,
    transitions: snapshot.layers?.copilot?.allowedTransitions,
  })}
      ${renderStateGraph({
    title: "reviewer layer",
    currentState: snapshot.layers?.reviewer?.currentState,
    transitions: snapshot.layers?.reviewer?.allowedTransitions,
  })}
    </div>
  </section>`;
}

function renderCompactSection({ title, entries = [], lists = [] }) {
  if (entries.length === 0 && lists.length === 0) {
    return `<section><h2>${escapeHtml(title)}</h2><p>not present / unavailable</p></section>`;
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    ${entries.length > 0 ? renderDefinitionList(entries) : "<p>not present / unavailable</p>"}
    ${lists.map(({ title: listTitle, items }) => `
      <h3>${escapeHtml(listTitle)}</h3>
      ${renderList(items)}
    `).join("")}
  </section>`;
}

function renderOuterLoopSummarySection(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    return renderCompactSection({ title: "outer-loop summary" });
  }

  return renderCompactSection({
    title: "outer-loop summary",
    entries: [
      ["activeStateFamily", snapshot.activeStateFamily ?? "not present"],
      ["outerAction", snapshot.outerAction ?? "not present"],
      ["activeFamilyState", snapshot.activeFamilyState ?? "not present"],
      ["statusClass", snapshot.statusClass ?? "not present"],
      ["needsAttention", String(snapshot.needsAttention ?? "not present")],
      ["sourceMode", snapshot.sourceMode ?? "not present"],
      ["trust", snapshot.trust ?? "not present"],
      ["evidence.summary", snapshot.evidence?.summary ?? "not present"],
    ],
    lists: [
      { title: "evidence.authoritative", items: snapshot.evidence?.authoritative },
      { title: "evidence.checkpoint", items: snapshot.evidence?.checkpoint },
    ],
  });
}

function renderCopilotLayerSection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "copilot layer" });
  }

  return renderCompactSection({
    title: "copilot layer",
    entries: [
      ["currentState", layer.currentState ?? "not present"],
    ],
    lists: [
      { title: "allowedTransitions", items: layer.allowedTransitions },
    ],
  });
}

function renderCopilotLoopIterationsSection(snapshot) {
  const loopIterations = snapshot?.loopIterations;

  if (loopIterations === null || loopIterations === undefined) {
    return renderCompactSection({ title: "Copilot loop iterations" });
  }

  const humanSummary = loopIterations.available
    ? [
      `state: ${snapshot?.layers?.copilot?.currentState ?? "not present"}`,
      `iterations: ${loopIterations.completedCopilotReviewRounds} completed, ${loopIterations.pendingCopilotReviewRounds} pending`,
      `comments: ${loopIterations.copilotReviewComments} produced, ${loopIterations.unresolvedReviewThreads} unresolved`,
      `fix commits: ${loopIterations.fixCommitsAfterFeedback}`,
    ].join("; ")
    : "not present / unavailable";

  return renderCompactSection({
    title: "Copilot loop iterations",
    entries: [
      ["available", String(loopIterations.available)],
      ["source", loopIterations.source ?? "not present"],
      ["reason", loopIterations.reason ?? "not present"],
      ["completedCopilotReviewRounds", loopIterations.completedCopilotReviewRounds ?? "not present"],
      ["pendingCopilotReviewRounds", loopIterations.pendingCopilotReviewRounds ?? "not present"],
      ["copilotReviewRequests", loopIterations.copilotReviewRequests ?? "not present"],
      ["copilotReviewComments", loopIterations.copilotReviewComments ?? "not present"],
      ["resolvedReviewThreads", loopIterations.resolvedReviewThreads ?? "not present"],
      ["unresolvedReviewThreads", loopIterations.unresolvedReviewThreads ?? "not present"],
      ["fixCommitsAfterFeedback", loopIterations.fixCommitsAfterFeedback ?? "not present"],
      ["humanSummary", humanSummary],
    ],
  });
}

function renderReviewerLayerSection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "reviewer layer" });
  }

  return renderCompactSection({
    title: "reviewer layer",
    entries: [
      ["currentState", layer.currentState ?? "not present"],
      ["scope.mode", layer.scope?.mode ?? "not present"],
      ["scope.reviewerLogin", layer.scope?.reviewerLogin ?? "not present"],
    ],
    lists: [
      { title: "allowedTransitions", items: layer.allowedTransitions },
    ],
  });
}

function renderSteeringSummarySection(layer) {
  if (layer === null || layer === undefined) {
    return renderCompactSection({ title: "steering summary" });
  }

  return renderCompactSection({
    title: "steering summary",
    entries: [
      ["status", layer.status ?? "not present"],
      ["reason", layer.reason ?? "not present"],
    ],
  });
}

function renderSnapshotStateLabel(snapshot) {
  if (!snapshot) {
    return "unavailable";
  }
  if (Array.isArray(snapshot.markers?.conflicts) && snapshot.markers.conflicts.length > 0) {
    return "conflicting";
  }
  if (snapshot.sourceMode === "checkpoint-only") {
    return "checkpoint-only";
  }
  if (snapshot.sourceMode === "partial") {
    return "degraded";
  }
  if (snapshot.sourceMode === "unavailable") {
    return "unavailable";
  }
  return "authoritative";
}

export function renderInspectRunViewerHtml({
  target,
  snapshot = null,
  error = null,
}) {
  const normalizedSnapshot = snapshot ?? null;
  const stateLabel = renderSnapshotStateLabel(normalizedSnapshot);
  const title = `${target.repo}#${target.pr} inspection snapshot`;
  const pageHeading = `PR #${target.pr} inspection`;
  const runId = normalizedSnapshot?.runId ?? "not present";
  const topSummary = normalizedSnapshot === null
    ? `<section>
      <h2>Snapshot unavailable</h2>
      <p>${escapeHtml(error?.message ?? "Unable to load inspect-run snapshot.")}</p>
      <p>Manual reload only: use the reload button or browser refresh.</p>
    </section>`
    : `<section>
      <h2>Top summary</h2>
      ${renderDefinitionList([
        ["target.repo", normalizedSnapshot.target?.repo ?? target.repo],
        ["target.pr", normalizedSnapshot.target?.pr ?? target.pr],
        ["runId", runId],
        ["inspectedAt", normalizedSnapshot.inspectedAt ?? "not present"],
      ])}
      <h3>Markers</h3>
      <h4>markers.missing</h4>
      ${renderList(normalizedSnapshot.markers?.missing)}
      <h4>markers.stale</h4>
      ${renderList(normalizedSnapshot.markers?.stale)}
      <h4>markers.conflicts</h4>
      ${renderList(normalizedSnapshot.markers?.conflicts)}
    </section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: sans-serif; margin: 1rem auto; max-width: 70rem; line-height: 1.4; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
      .badge { display: inline-block; padding: 0.25rem 0.5rem; border: 1px solid #666; border-radius: 0.25rem; font-weight: 600; }
      .state-graph-intro { margin-top: 0; color: #333; }
      .state-graph-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 0.75rem; margin-top: 0.75rem; }
      .state-graph-card { border: 1px solid #cfd8dc; border-radius: 0.5rem; padding: 0.75rem; background: #fafcff; }
      .state-graph-card h3 { margin-top: 0; margin-bottom: 0.5rem; }
      .state-graph-current-label { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #455a64; text-transform: uppercase; letter-spacing: 0.03em; }
      .state-flow { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.75rem; }
      .state-node { display: inline-flex; align-items: center; border: 1px solid #90a4ae; border-radius: 999px; padding: 0.2rem 0.55rem; background: #fff; font-size: 0.9rem; }
      .state-node-current { border-color: #1565c0; background: #e3f2fd; font-weight: 700; }
      .state-node-next { border-color: #5c6bc0; background: #f3f4ff; }
      .state-node-idle { border-style: dashed; color: #546e7a; }
      .state-arrow { color: #607d8b; font-weight: 700; }
      .state-graph-meta { margin: 0; font-size: 0.9rem; }
      dl { display: grid; grid-template-columns: 14rem 1fr; gap: 0.35rem 0.75rem; }
      dt { font-weight: 600; }
      section { border: 1px solid #ddd; border-radius: 0.5rem; padding: 0.75rem; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(pageHeading)}</h1>
    <p><strong>Target:</strong> <code>${escapeHtml(target.repo)}</code></p>
    <p><strong>Snapshot state:</strong> <span class="badge">${escapeHtml(stateLabel)}</span> <button type="button" onclick="window.location.reload()" title="Reload snapshot" aria-label="Reload snapshot">🔄</button></p>
    <p><strong>Refresh:</strong> manual reload only.</p>
    <p><strong>Raw snapshot:</strong> <a href="/snapshot.json"><code>/snapshot.json</code></a></p>
    ${renderStateVisualizationSection(normalizedSnapshot)}
    ${topSummary}
    ${renderOuterLoopSummarySection(normalizedSnapshot)}
    ${renderCopilotLoopIterationsSection(normalizedSnapshot)}
    ${renderCopilotLayerSection(normalizedSnapshot?.layers?.copilot)}
    ${renderReviewerLayerSection(normalizedSnapshot?.layers?.reviewer)}
    ${renderSteeringSummarySection(normalizedSnapshot?.layers?.steering)}
  </body>
</html>`;
}

function makeAdapterOptions(options) {
  const adapterOptions = {};
  if (options.steeringStateFile !== undefined) {
    adapterOptions.steeringStateFile = options.steeringStateFile;
  }
  if (options.reviewerLogin !== undefined) {
    adapterOptions.reviewerLogin = options.reviewerLogin;
  }
  if (options.copilotInputPath !== undefined) {
    adapterOptions.copilotInputPath = options.copilotInputPath;
  }
  if (options.reviewerInputPath !== undefined) {
    adapterOptions.reviewerInputPath = options.reviewerInputPath;
  }
  return adapterOptions;
}

function setNoStore(response) {
  response.setHeader("cache-control", "no-store");
}

function writeText(response, statusCode, body, headers = {}) {
  setNoStore(response);
  response.statusCode = statusCode;
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.end(body);
}

function writeJson(response, statusCode, payload) {
  setNoStore(response);
  writeText(
    response,
    statusCode,
    `${JSON.stringify(payload, null, 2)}\n`,
    { "content-type": "application/json; charset=utf-8" },
  );
}

function writeHtml(response, html) {
  setNoStore(response);
  writeText(response, 200, html, { "content-type": "text/html; charset=utf-8" });
}

function jsonErrorPayload(target, error) {
  return {
    ok: false,
    target,
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function requireSnapshotForJson(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    throw new Error("inspection snapshot unavailable");
  }

  return snapshot;
}

export function formatInspectRunViewerUrl(host, port) {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return new URL(`http://${formattedHost}:${port}`).toString().replace(/\/$/, "");
}

function isLsofNoListenerResult(error) {
  if (!error || error.code !== 1) {
    return false;
  }

  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr.length === 0;
}

export async function listListeningPidsForPort(port, { execFileImpl = execFile } = {}) {
  try {
    const { stdout } = await execFileImpl("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (error) {
    if (isLsofNoListenerResult(error)) {
      return [];
    }
    throw error;
  }
}

export async function restartExistingPortListener(
  port,
  {
    listListeningPidsImpl = listListeningPidsForPort,
    killProcessImpl = (pid, signal) => process.kill(pid, signal),
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 1500,
    pollIntervalMs = 50,
  } = {},
) {
  const pids = (await listListeningPidsImpl(port)).filter((pid) => pid !== process.pid);
  if (pids.length === 0) {
    return [];
  }

  for (const pid of pids) {
    try {
      killProcessImpl(pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingListeners = (await listListeningPidsImpl(port)).filter((pid) => pid !== process.pid);
    if (remainingListeners.length === 0) {
      return pids;
    }
    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`--restart could not stop existing listener on port ${port}`);
}

export function createInspectRunViewerServer(options, deps = {}) {
  const adapter = deps.adapter ?? createInspectionViewerAdapter();
  const target = normalizeInspectionTarget({ repo: options.repo, pr: options.pr });
  const adapterOptions = makeAdapterOptions(options);

  return createServer(async (request, response) => {
    try {
      const requestPath = request.url ? new URL(request.url, "http://localhost").pathname : "/";
      const method = request.method ?? "GET";

      if (requestPath === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (requestPath !== "/" && requestPath !== "/snapshot.json") {
        writeText(response, 404, "Not Found", {
          "content-type": "text/plain; charset=utf-8",
        });
        return;
      }

      if (method !== "GET") {
        writeText(response, 405, "Method Not Allowed", {
          allow: "GET",
          "content-type": "text/plain; charset=utf-8",
        });
        return;
      }

      if (requestPath === "/snapshot.json") {
        try {
          const snapshot = requireSnapshotForJson(await adapter.loadSnapshot(target, adapterOptions));
          writeJson(response, 200, snapshot);
        } catch (error) {
          writeJson(response, 500, jsonErrorPayload(target, error));
        }
        return;
      }

      let snapshot = null;
      let error = null;
      try {
        snapshot = await adapter.loadSnapshot(target, adapterOptions);
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }

      const html = renderInspectRunViewerHtml({ target, snapshot: snapshot ?? null, error });
      writeHtml(response, html);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const malformedRequest = /invalid url|uri malformed/i.test(message);
      writeText(
        response,
        malformedRequest ? 400 : 500,
        malformedRequest ? "Bad Request" : "Internal Server Error",
        { "content-type": "text/plain; charset=utf-8" },
      );
    }
  });
}

function normalizeRestartCapabilityError(error) {
  const missingLsof = error?.code === "ENOENT"
    && (error?.path === "lsof" || /(^|\b)lsof(\b|$)/i.test(String(error?.message ?? "")));
  if (!missingLsof) {
    return error;
  }

  const parseFriendlyError = parseError(
    "--restart requires lsof/POSIX support; install lsof or rerun without --restart",
  );
  parseFriendlyError.cause = error;
  return parseFriendlyError;
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    restartExistingPortListenerImpl = restartExistingPortListener,
  } = {},
) {
  const options = parseInspectRunViewerCliArgs(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return null;
  }

  if (options.restart) {
    try {
      await restartExistingPortListenerImpl(options.port);
    } catch (error) {
      throw normalizeRestartCapabilityError(error);
    }
  }

  const server = createInspectRunViewerServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });

  stdout.write(
    `${JSON.stringify({
      ok: true,
      message: "read-only inspect-run viewer started",
      target: normalizeInspectionTarget({ repo: options.repo, pr: options.pr }),
      url: formatInspectRunViewerUrl(options.host, options.port),
      reload: "manual",
    })}\n`,
  );

  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

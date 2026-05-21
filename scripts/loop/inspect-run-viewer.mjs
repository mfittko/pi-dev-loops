#!/usr/bin/env node
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCliError } from "../_core-helpers.mjs";
import {
  createInspectionViewerAdapter,
  normalizeInspectionTarget,
} from "./_inspect-run-viewer-adapter.mjs";

const USAGE = `Usage: inspect-run-viewer.mjs --repo <owner/name> --pr <number>
  [--host <host>] [--port <port>]
  [--steering-state-file <path>] [--reviewer-login <login>]
  [--copilot-input <path>] [--reviewer-input <path>]

Single-run local browser viewer for the inspect-run read-only snapshot.

Required:
  --repo <owner/name>
  --pr <number>

Optional:
  --host <host>                         Bind host (default: 127.0.0.1)
  --port <port>                         Bind port (default: 4311)
  --steering-state-file <path>          Pass-through to inspect-run
  --reviewer-login <login>              Pass-through to inspect-run
  --copilot-input <path>                Pass-through to inspect-run
  --reviewer-input <path>               Pass-through to inspect-run
                                        (cannot be combined with
                                        --reviewer-login)`.trim();

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4311;

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

function renderLayerSection({ title, layer }) {
  if (layer === null || layer === undefined) {
    return `<section><h2>${escapeHtml(title)}</h2><p>not present / unavailable</p></section>`;
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <pre>${escapeHtml(JSON.stringify(layer, null, 2))}</pre>
  </section>`;
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
  const runId = normalizedSnapshot?.runId ?? "not present";
  const topSummary = normalizedSnapshot === null
    ? `<section>
      <h2>Snapshot unavailable</h2>
      <p>${escapeHtml(error?.message ?? "Unable to load inspect-run snapshot.")}</p>
      <p>Manual reload only: use the reload button or browser refresh.</p>
    </section>`
    : `<section>
      <h2>Top summary</h2>
      <dl>
        <dt>target.repo</dt><dd>${escapeHtml(normalizedSnapshot.target?.repo ?? target.repo)}</dd>
        <dt>target.pr</dt><dd>${escapeHtml(normalizedSnapshot.target?.pr ?? target.pr)}</dd>
        <dt>runId</dt><dd>${escapeHtml(runId)}</dd>
        <dt>inspectedAt</dt><dd>${escapeHtml(normalizedSnapshot.inspectedAt ?? "not present")}</dd>
        <dt>activeStateFamily</dt><dd>${escapeHtml(normalizedSnapshot.activeStateFamily ?? "not present")}</dd>
        <dt>outerAction</dt><dd>${escapeHtml(normalizedSnapshot.outerAction ?? "not present")}</dd>
        <dt>activeFamilyState</dt><dd>${escapeHtml(normalizedSnapshot.activeFamilyState ?? "not present")}</dd>
        <dt>statusClass</dt><dd>${escapeHtml(normalizedSnapshot.statusClass ?? "not present")}</dd>
        <dt>needsAttention</dt><dd>${escapeHtml(String(normalizedSnapshot.needsAttention ?? "not present"))}</dd>
        <dt>sourceMode</dt><dd>${escapeHtml(normalizedSnapshot.sourceMode ?? "not present")}</dd>
        <dt>trust</dt><dd>${escapeHtml(normalizedSnapshot.trust ?? "not present")}</dd>
        <dt>evidence.summary</dt><dd>${escapeHtml(normalizedSnapshot.evidence?.summary ?? "not present")}</dd>
      </dl>
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
      dl { display: grid; grid-template-columns: 14rem 1fr; gap: 0.35rem 0.75rem; }
      dt { font-weight: 600; }
      section { border: 1px solid #ddd; border-radius: 0.5rem; padding: 0.75rem; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>Read-only run viewer</h1>
    <p><strong>Target:</strong> <code>${escapeHtml(target.repo)}</code> PR <code>${escapeHtml(target.pr)}</code></p>
    <p><strong>Snapshot state:</strong> <span class="badge">${escapeHtml(stateLabel)}</span></p>
    <p><button type="button" onclick="window.location.reload()">Reload snapshot</button> (manual reload only)</p>
    ${topSummary}
    ${renderLayerSection({ title: "outer-loop summary", layer: normalizedSnapshot })}
    ${renderLayerSection({ title: "copilot layer", layer: normalizedSnapshot?.layers?.copilot })}
    ${renderLayerSection({ title: "reviewer layer", layer: normalizedSnapshot?.layers?.reviewer })}
    ${renderLayerSection({ title: "steering summary", layer: normalizedSnapshot?.layers?.steering })}
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

export function formatInspectRunViewerUrl(host, port) {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return new URL(`http://${formattedHost}:${port}`).toString().replace(/\/$/, "");
}

export function createInspectRunViewerServer(options, deps = {}) {
  const adapter = deps.adapter ?? createInspectionViewerAdapter();
  const target = normalizeInspectionTarget({ repo: options.repo, pr: options.pr });
  const adapterOptions = makeAdapterOptions(options);

  return createServer(async (request, response) => {
    try {
      const requestPath = request.url ? new URL(request.url, "http://localhost").pathname : "/";
      if (requestPath !== "/") {
        response.statusCode = requestPath === "/favicon.ico" ? 204 : 404;
        response.end();
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
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(html);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const malformedRequest = /invalid url|uri malformed/i.test(message);
      response.statusCode = malformedRequest ? 400 : 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(malformedRequest ? "Bad Request" : "Internal Server Error");
    }
  });
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
  } = {},
) {
  const options = parseInspectRunViewerCliArgs(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return null;
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

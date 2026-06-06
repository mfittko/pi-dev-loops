import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  USAGE,
} from "./constants.mjs";
import { requireOptionValue } from "../../_cli-primitives.mjs";
import { normalizeInspectionTarget } from "../_inspect-run-viewer-adapter.mjs";

export function parseInspectRunViewerCliError(message) {
  return Object.assign(new Error(message), { usage: USAGE });
}

function parsePort(rawPort) {
  if (!/^\d+$/.test(rawPort)) {
    throw parseInspectRunViewerCliError("--port must be a positive integer");
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw parseInspectRunViewerCliError("--port must be between 1 and 65535");
  }
  return port;
}

function parseHost(rawHost) {
  const host = rawHost.trim();
  if (host.length === 0) {
    throw parseInspectRunViewerCliError("--host must not be empty");
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

export function normalizeCliRepoOption(rawRepo) {
  try {
    return normalizeInspectionTarget({ repo: rawRepo, pr: 1 }).repo;
  } catch (error) {
    throw parseInspectRunViewerCliError(error instanceof Error ? error.message : String(error));
  }
}

export function parseInspectRunViewerCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    repo: undefined,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    steeringStateFile: undefined,
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
      options.repo = requireOptionValue(args, "--repo", parseInspectRunViewerCliError);
      continue;
    }
    if (token === "--pr") {
      throw parseInspectRunViewerCliError("--pr is no longer supported on the CLI; choose a PR with ?pr=<number> in the viewer URL");
    }
    if (token === "--host") {
      options.host = parseHost(requireOptionValue(args, "--host", parseInspectRunViewerCliError));
      continue;
    }
    if (token === "--port") {
      options.port = parsePort(requireOptionValue(args, "--port", parseInspectRunViewerCliError));
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
      options.steeringStateFile = requireOptionValue(args, "--steering-state-file", parseInspectRunViewerCliError);
      continue;
    }
    if (token === "--copilot-input") {
      options.copilotInputPath = requireOptionValue(args, "--copilot-input", parseInspectRunViewerCliError);
      continue;
    }
    if (token === "--reviewer-input") {
      options.reviewerInputPath = requireOptionValue(args, "--reviewer-input", parseInspectRunViewerCliError);
      continue;
    }
    throw parseInspectRunViewerCliError(`Unknown argument: ${token}`);
  }

  if (!options.help) {
    options.repo = options.repo === undefined ? undefined : normalizeCliRepoOption(options.repo);
    if (!options.allowNonLocalhost && !isLoopbackHost(options.host)) {
      throw parseInspectRunViewerCliError("--host must stay on localhost/loopback unless --allow-non-localhost is set");
    }
  }

  return options;
}

export { USAGE };

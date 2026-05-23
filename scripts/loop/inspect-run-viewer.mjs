#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { formatCliError } from "../_core-helpers.mjs";
import {
  STATE as COPILOT_STATE,
  TRANSITIONS as COPILOT_TRANSITIONS,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  REVIEWER_STATE,
  REVIEWER_TRANSITIONS,
} from "../../packages/core/src/loop/reviewer-loop-state.mjs";
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
const MERMAID_BROWSER_ASSET_ROUTE = "/assets/mermaid.min.js";
const require = createRequire(import.meta.url);

let mermaidBrowserScriptPromise = null;

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
    return null;
  }
  return [...new Set(
    transitions
      .filter((transition) => typeof transition === "string")
      .map((transition) => transition.trim())
      .filter((transition) => transition.length > 0),
  )];
}

function renderStateVisualizationIntro(snapshot) {
  const stateLabel = renderSnapshotStateLabel(snapshot);

  if (stateLabel === "authoritative") {
    return "Full authoritative Copilot and reviewer state machines, plus fail-closed outer-loop summary from the authoritative inspection snapshot.";
  }
  if (stateLabel === "degraded") {
    return "Full authoritative Copilot and reviewer state machines from a degraded inspection snapshot. Missing current-state or next-state highlights stay explicitly unavailable instead of being guessed.";
  }
  if (stateLabel === "checkpoint-only") {
    return "Full authoritative Copilot and reviewer state machines from a checkpoint-only inspection snapshot. Treat current-state and next-state highlights as advisory until live inspection is available.";
  }
  if (stateLabel === "conflicting") {
    return "Full authoritative Copilot and reviewer state machines from a conflicting inspection snapshot. Resolve the conflicting evidence before treating the highlights as authoritative.";
  }

  return "Full authoritative Copilot and reviewer state machines from the current inspection snapshot.";
}

const OUTER_LOOP_KNOWN_ACTIONS = Object.freeze([
  "continue_wait",
  "reenter_copilot_loop",
  "reenter_reviewer_loop",
  "stop",
  "done",
]);
const OUTER_LOOP_TERMINAL_STATES = new Set(["stop", "done"]);
const COPILOT_TERMINAL_STATES = new Set(
  Object.entries(COPILOT_TRANSITIONS)
    .filter(([, nextStates]) => Array.isArray(nextStates) && nextStates.length === 0)
    .map(([state]) => state),
);
const REVIEWER_TERMINAL_STATES = new Set(
  Object.entries(REVIEWER_TRANSITIONS)
    .filter(([, nextStates]) => Array.isArray(nextStates) && nextStates.length === 0)
    .map(([state]) => state),
);

function normalizeCurrentStateInfo(currentState, { knownStates = null, terminalStates = null } = {}) {
  if (typeof currentState === "string" && currentState.length > 0) {
    const normalized = currentState.trim();

    if (normalized.toLowerCase() === "unknown") {
      return { label: "current state unavailable", available: false, terminal: false };
    }
    if (knownStates instanceof Set && !knownStates.has(normalized)) {
      return { label: "current state unavailable", available: false, terminal: false };
    }

    return {
      label: normalized,
      available: true,
      terminal: terminalStates instanceof Set ? terminalStates.has(normalized) : false,
    };
  }

  return { label: "current state unavailable", available: false, terminal: false };
}

function summarizeTransitionAvailability(transitions) {
  const normalizedTransitions = normalizeTransitions(transitions);
  const unavailable = normalizedTransitions === null;
  const empty = !unavailable && normalizedTransitions.length === 0;
  const summary = unavailable
    ? "transition data unavailable in this snapshot"
    : empty
      ? "no allowed transitions"
      : normalizedTransitions.join(", ");

  return {
    unavailable,
    empty,
    summary,
    normalizedTransitions: unavailable ? [] : normalizedTransitions,
  };
}

export function resolveMermaidBrowserAssetPath(resolveImpl = require.resolve) {
  const mermaidPackageJsonPath = resolveImpl("mermaid/package.json");
  return path.join(path.dirname(mermaidPackageJsonPath), "dist", "mermaid.min.js");
}

export async function loadMermaidBrowserScript({
  readFileImpl = readFile,
  resolveMermaidBrowserAssetPathImpl = resolveMermaidBrowserAssetPath,
} = {}) {
  if (mermaidBrowserScriptPromise === null) {
    mermaidBrowserScriptPromise = Promise.resolve()
      .then(() => readFileImpl(resolveMermaidBrowserAssetPathImpl(), "utf8"))
      .catch((error) => {
        mermaidBrowserScriptPromise = null;
        throw error;
      });
  }
  return mermaidBrowserScriptPromise;
}

function escapeMermaidLabel(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

function renderMermaidNode(id, label, shape = "box") {
  const escapedLabel = escapeMermaidLabel(label);

  if (shape === "pill") {
    return `${id}(["${escapedLabel}"])`;
  }
  if (shape === "circle") {
    return `${id}(("${escapedLabel}"))`;
  }

  return `${id}["${escapedLabel}"]`;
}

function renderMermaidNodeId(laneKey, state) {
  return `${laneKey}_${String(state).replaceAll(/[^a-zA-Z0-9_]+/g, "_")}`;
}

function buildOuterLoopSummaryLane({ laneKey, title, currentState, transitions }) {
  const knownStates = new Set(OUTER_LOOP_KNOWN_ACTIONS);
  const currentInfo = normalizeCurrentStateInfo(currentState, {
    knownStates,
    terminalStates: OUTER_LOOP_TERMINAL_STATES,
  });
  const transitionInfo = summarizeTransitionAvailability(transitions);
  const classIds = {
    cue: [],
    current: [],
    currentTerminal: [],
    next: [],
    nextTerminal: [],
    terminal: [],
    inactive: [],
    unavailable: [],
    note: [],
  };
  const lines = [
    `  subgraph ${laneKey}["${escapeMermaidLabel(title)}"]`,
    "    direction LR",
  ];

  for (const state of OUTER_LOOP_KNOWN_ACTIONS) {
    const nodeId = renderMermaidNodeId(laneKey, state);
    const terminal = OUTER_LOOP_TERMINAL_STATES.has(state);
    lines.push(`    ${renderMermaidNode(nodeId, state)}`);

    if (currentInfo.available && currentInfo.label === state) {
      classIds[terminal ? "currentTerminal" : "current"].push(nodeId);
    } else if (terminal) {
      classIds.terminal.push(nodeId);
    } else {
      classIds.inactive.push(nodeId);
    }
  }

  const limitationId = `${laneKey}_limitation`;
  lines.push(`    ${renderMermaidNode(limitationId, "authoritative full transition graph not exported")}`);
  classIds.note.push(limitationId);

  let currentId = limitationId;
  if (!currentInfo.available) {
    const unavailableId = `${laneKey}_current_unavailable`;
    lines.push(`    ${renderMermaidNode(unavailableId, currentInfo.label)}`);
    lines.push(`    ${unavailableId} -.-> ${limitationId}`);
    classIds.unavailable.push(unavailableId);
    currentId = unavailableId;
  } else {
    currentId = renderMermaidNodeId(laneKey, currentInfo.label);
    lines.push(`    ${currentId} -.-> ${limitationId}`);
  }

  if (transitionInfo.unavailable) {
    const noteId = `${laneKey}_transitions_unavailable`;
    lines.push(`    ${renderMermaidNode(noteId, "snapshot next transitions unavailable")}`);
    lines.push(`    ${currentId} -.-> ${noteId}`);
    classIds.note.push(noteId);
  }

  lines.push("  end");

  return {
    title,
    currentLabel: currentInfo.label,
    transitionInfo,
    currentId,
    lines,
    classIds,
    summary: `${currentInfo.label}; known outer actions shown, but authoritative full transitions are not exported`,
  };
}

function buildFullStateMachineLane({ laneKey, title, states, transitionTable, currentState, transitions, startStates = [] }) {
  const knownStates = new Set(states);
  const terminalStates = new Set(
    states.filter((state) => Array.isArray(transitionTable[state]) && transitionTable[state].length === 0),
  );
  const currentInfo = normalizeCurrentStateInfo(currentState, { knownStates, terminalStates });
  const transitionInfo = summarizeTransitionAvailability(transitions);
  const authoritativeCurrentNextStates = currentInfo.available
    ? new Set(Array.isArray(transitionTable[currentInfo.label]) ? transitionTable[currentInfo.label] : [])
    : new Set();
  const validNormalizedTransitions = transitionInfo.unavailable || !currentInfo.available
    ? []
    : transitionInfo.normalizedTransitions.filter((state) => authoritativeCurrentNextStates.has(state));
  const invalidNormalizedTransitions = transitionInfo.unavailable || !currentInfo.available
    ? []
    : transitionInfo.normalizedTransitions.filter((state) => !authoritativeCurrentNextStates.has(state));
  const highlightedNextStates = new Set(validNormalizedTransitions);
  const classIds = {
    cue: [],
    current: [],
    currentTerminal: [],
    next: [],
    nextTerminal: [],
    terminal: [],
    inactive: [],
    unavailable: [],
    note: [],
  };
  const lines = [
    `  subgraph ${laneKey}["${escapeMermaidLabel(title)}"]`,
    "    direction LR",
  ];
  const startId = `${laneKey}_start`;
  const endId = `${laneKey}_end`;

  if (startStates.length > 0) {
    lines.push(`    ${renderMermaidNode(startId, "Start", "pill")}`);
    classIds.cue.push(startId);
  }

  for (const state of states) {
    const nodeId = renderMermaidNodeId(laneKey, state);
    const terminal = terminalStates.has(state);
    lines.push(`    ${renderMermaidNode(nodeId, state)}`);

    if (currentInfo.available && currentInfo.label === state) {
      classIds[terminal ? "currentTerminal" : "current"].push(nodeId);
    } else if (highlightedNextStates.has(state)) {
      classIds[terminal ? "nextTerminal" : "next"].push(nodeId);
    } else if (terminal) {
      classIds.terminal.push(nodeId);
    } else {
      classIds.inactive.push(nodeId);
    }
  }

  let endVisible = false;
  const ensureEndNode = () => {
    if (!endVisible) {
      lines.push(`    ${renderMermaidNode(endId, "End", "circle")}`);
      classIds.cue.push(endId);
      endVisible = true;
    }
    return endId;
  };

  for (const startState of startStates) {
    if (knownStates.has(startState)) {
      lines.push(`    ${startId} --> ${renderMermaidNodeId(laneKey, startState)}`);
    }
  }

  for (const state of states) {
    const fromId = renderMermaidNodeId(laneKey, state);
    const nextStates = Array.isArray(transitionTable[state]) ? transitionTable[state] : [];

    if (nextStates.length === 0) {
      lines.push(`    ${fromId} --> ${ensureEndNode()}`);
      continue;
    }

    for (const nextState of nextStates) {
      if (knownStates.has(nextState)) {
        lines.push(`    ${fromId} --> ${renderMermaidNodeId(laneKey, nextState)}`);
      }
    }
  }

  let currentId = startStates.length > 0 ? startId : renderMermaidNodeId(laneKey, states[0]);
  if (!currentInfo.available) {
    const unavailableId = `${laneKey}_current_unavailable`;
    lines.push(`    ${renderMermaidNode(unavailableId, currentInfo.label)}`);
    classIds.unavailable.push(unavailableId);
    currentId = unavailableId;
  } else {
    currentId = renderMermaidNodeId(laneKey, currentInfo.label);
  }

  if (transitionInfo.unavailable) {
    const noteId = `${laneKey}_transitions_unavailable`;
    lines.push(`    ${renderMermaidNode(noteId, "snapshot next transitions unavailable")}`);
    lines.push(`    ${currentId} -.-> ${noteId}`);
    classIds.note.push(noteId);
  }

  lines.push("  end");

  const validatedTransitionSummary = transitionInfo.unavailable
    ? "next transitions unavailable in this snapshot"
    : !currentInfo.available
      ? "next transitions unavailable because current state is unavailable"
      : transitionInfo.empty
        ? "no allowed transitions"
        : validNormalizedTransitions.length === 0
          ? "no authoritative next states confirmed from snapshot"
          : `validated next states: ${validNormalizedTransitions.join(", ")}${invalidNormalizedTransitions.length === 0 ? "" : ` (${invalidNormalizedTransitions.length} invalid snapshot token${invalidNormalizedTransitions.length === 1 ? "" : "s"} ignored)`}`;

  return {
    title,
    currentLabel: currentInfo.label,
    transitionInfo,
    validatedTransitionSummary,
    currentId,
    lines,
    classIds,
    summary: `${currentInfo.label}; full authoritative state machine shown`,
  };
}

export function buildInspectionMermaidGraph(snapshot) {
  if (snapshot === null || snapshot === undefined || snapshot?.sourceMode === "unavailable" || renderSnapshotStateLabel(snapshot) === "unavailable") {
    return null;
  }

  const lanes = [
    buildOuterLoopSummaryLane({
      laneKey: "outer_loop_family",
      title: "outer-loop family",
      currentState: snapshot.activeFamilyState,
      transitions: snapshot.allowedTransitions,
    }),
    buildFullStateMachineLane({
      laneKey: "copilot_layer",
      title: "copilot layer",
      states: Object.values(COPILOT_STATE),
      transitionTable: COPILOT_TRANSITIONS,
      currentState: snapshot.layers?.copilot?.currentState,
      transitions: snapshot.layers?.copilot?.allowedTransitions,
      startStates: [COPILOT_STATE.PR_DRAFT],
    }),
    buildFullStateMachineLane({
      laneKey: "reviewer_layer",
      title: "reviewer layer",
      states: Object.values(REVIEWER_STATE),
      transitionTable: REVIEWER_TRANSITIONS,
      currentState: snapshot.layers?.reviewer?.currentState,
      transitions: snapshot.layers?.reviewer?.allowedTransitions,
      startStates: [REVIEWER_STATE.WAITING_FOR_REVIEW_REQUEST],
    }),
  ];

  const classIds = {
    cue: [],
    current: [],
    currentTerminal: [],
    next: [],
    nextTerminal: [],
    terminal: [],
    inactive: [],
    unavailable: [],
    note: [],
  };

  for (const lane of lanes) {
    for (const [className, ids] of Object.entries(lane.classIds)) {
      classIds[className].push(...ids);
    }
  }

  const lines = [
    "flowchart TB",
    "  classDef cue fill:#f5f7f9,stroke:#78909c,stroke-width:1.5px,color:#355061,font-weight:bold;",
    "  classDef current fill:#e3f2fd,stroke:#1565c0,stroke-width:4px,color:#12344d,font-weight:bold;",
    "  classDef currentTerminal fill:#d9f2df,stroke:#1565c0,stroke-width:4px,color:#12344d,font-weight:800;",
    "  classDef next fill:#f3f4ff,stroke:#5c6bc0,stroke-width:2px,color:#233242,font-weight:700;",
    "  classDef nextTerminal fill:#eef7ef,stroke:#5c6bc0,stroke-width:3px,color:#1b5e20,font-weight:700;",
    "  classDef terminal fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px,color:#1b5e20,font-weight:bold;",
    "  classDef inactive fill:#ffffff,stroke:#b0bec5,stroke-width:1.5px,color:#607d8b;",
    "  classDef unavailable fill:#f8fafc,stroke:#90a4ae,stroke-width:2px,color:#546e7a,stroke-dasharray: 6 4;",
    "  classDef note fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#7f4b00;",
    ...lanes.flatMap((lane) => lane.lines),
    `  ${lanes[0].currentId} -. "layer view" .-> ${lanes[1].currentId}`,
    `  ${lanes[0].currentId} -. "layer view" .-> ${lanes[2].currentId}`,
  ];

  for (const [className, ids] of Object.entries(classIds)) {
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(",")} ${className};`);
    }
  }

  return {
    definition: lines.join("\n"),
    lanes: lanes.map((lane) => ({
      title: lane.title,
      currentLabel: lane.currentLabel,
      transitionInfo: lane.transitionInfo,
      validatedTransitionSummary: lane.validatedTransitionSummary ?? lane.transitionInfo.summary,
      summary: lane.summary,
    })),
  };
}

function renderStateGraphLegend() {
  return `<div class="state-graph-cues" aria-label="State graph cues">
    <span class="state-graph-cue"><span class="state-graph-cue-chip state-graph-cue-chip-start">Start</span> lane entry</span>
    <span class="state-graph-cue"><span class="state-graph-cue-chip state-graph-cue-chip-current">Current</span> snapshot-derived current state</span>
    <span class="state-graph-cue"><span class="state-graph-cue-chip state-graph-cue-chip-next">Next</span> immediate allowed next state</span>
    <span class="state-graph-cue"><span class="state-graph-cue-chip state-graph-cue-chip-end">End</span> terminal / no-transition outcome</span>
    <span class="state-graph-cue"><span class="state-graph-cue-chip state-graph-cue-chip-loop">🔁</span> manual re-inspection cue</span>
  </div>`;
}

function renderStateGraphHelp() {
  return `<ul class="state-graph-help">
    <li><strong>Current:</strong> emphasized nodes show the snapshot-derived current state for each lane when that state is actually known.</li>
    <li><strong>Next:</strong> purple nodes mark immediate allowed next states from the snapshot. Dimmed nodes are still part of the authoritative state machine; they are simply inactive right now.</li>
    <li><strong>Start / End:</strong> Mermaid entry and exit nodes make lane boundaries easier to scan for the full authoritative graph.</li>
    <li><strong>Outer loop:</strong> the viewer shows known outer actions but stays fail-closed about full outer-loop transitions until the repo exports that transition graph authoritatively.</li>
    <li><strong>🔁 Loop cue:</strong> this viewer is revisited by manual reload, so the same current state can recur across inspections until evidence changes.</li>
  </ul>`;
}

function renderStateGraphSummaries(graph) {
  return `<ul class="state-graph-summaries">
    ${graph.lanes.map((lane) => `<li class="state-graph-summary"><strong>${escapeHtml(lane.title)}:</strong> current <code>${escapeHtml(lane.currentLabel)}</code>; ${escapeHtml(lane.summary ?? lane.transitionInfo.summary)}; ${escapeHtml(lane.validatedTransitionSummary ?? lane.transitionInfo.summary)}</li>`).join("")}
  </ul>`;
}

function renderMermaidBootScript() {
  return `<script src="${MERMAID_BROWSER_ASSET_ROUTE}"></script>
    <script>
      (() => {
        const graphs = Array.from(document.querySelectorAll(".mermaid-state-graph"));
        const renderFallback = (message) => {
          graphs.forEach((graph) => {
            const fallback = document.createElement("p");
            fallback.className = "state-graph-render-error";
            fallback.textContent = message;
            graph.replaceWith(fallback);
          });
        };

        if (graphs.length === 0) {
          return;
        }
        if (typeof window.mermaid === "undefined") {
          renderFallback("Mermaid browser asset unavailable. Use the summaries below or open /snapshot.json.");
          return;
        }

        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          flowchart: {
            useMaxWidth: true,
            htmlLabels: false,
            curve: "basis",
          },
        });

        window.mermaid.run({ nodes: graphs }).then(() => {
          graphs.forEach((graph) => {
            graph.dataset.rendered = "true";
          });
        }).catch(() => {
          renderFallback("Mermaid could not render this snapshot safely. Use the summaries below or open /snapshot.json.");
        });
      })();
    </script>`;
}

function renderStateVisualizationSection(snapshot, graph) {
  if (graph === null) {
    return `<section>
      <h2>State visualization</h2>
      <p>Snapshot unavailable, so no state graph can be rendered yet.</p>
    </section>`;
  }

  return `<section>
    <h2>State visualization</h2>
    <p class="state-graph-intro">${escapeHtml(renderStateVisualizationIntro(snapshot))}</p>
    ${renderStateGraphLegend()}
    ${renderStateGraphHelp()}
    <div class="state-graph-frame">
      <div class="mermaid-state-graph mermaid" data-rendered="pending" aria-label="Mermaid inspection state graph">${escapeHtml(graph.definition)}</div>
    </div>
    ${renderStateGraphSummaries(graph)}
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
  if (snapshot.sourceMode === "unavailable") {
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
  return "authoritative";
}

function formatStateToken(value, fallback = "not present") {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
}

function renderCurrentStateNote(snapshot) {
  if (!snapshot) {
    return "Unable to determine the current PR state yet.";
  }

  if (snapshot.sourceMode === "unavailable") {
    return "Snapshot unavailable. Open /snapshot.json or reload once the inspection surface is available again.";
  }

  if ((snapshot.markers?.conflicts?.length ?? 0) > 0) {
    return "Conflicting evidence is present. Treat the current-state fields below as advisory until the snapshot is reconciled.";
  }

  if (snapshot.sourceMode === "checkpoint-only") {
    return "This is a checkpoint-only snapshot. The current-state fields below are advisory, not live-confirmed.";
  }

  if (snapshot.sourceMode === "partial" || snapshot.trust === "degraded") {
    return "This snapshot is degraded. The current-state fields below may be incomplete and should be cross-checked against the graph and raw snapshot.";
  }

  return "These fields are shown directly from the loaded inspection snapshot so the current state stays visible without inventing a second viewer-only status model.";
}

function renderCurrentStateBanner(snapshot, target, stateLabel) {
  return `<section class="current-pr-state-banner" aria-label="Current PR state">
    <h2>Current PR state</h2>
    <p class="current-pr-state-detail">${escapeHtml(renderCurrentStateNote(snapshot))}</p>
    <dl class="current-pr-state-grid">
      <dt>target</dt><dd><code>${escapeHtml(target.repo)}#${escapeHtml(target.pr)}</code></dd>
      <dt>snapshot trust</dt><dd><span class="badge">${escapeHtml(stateLabel)}</span></dd>
      <dt>status class</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.statusClass))}</code></dd>
      <dt>overall outer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.outerAction))}</code></dd>
      <dt>current Copilot state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.copilot?.currentState))}</code></dd>
      <dt>current reviewer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.reviewer?.currentState))}</code></dd>
      <dt>needs attention</dt><dd>${escapeHtml(String(snapshot?.needsAttention ?? "not present"))}</dd>
      <dt>evidence summary</dt><dd>${escapeHtml(snapshot?.evidence?.summary ?? "not present")}</dd>
    </dl>
  </section>`;
}

export function renderInspectRunViewerHtml({
  target,
  snapshot = null,
  error = null,
}) {
  const normalizedSnapshot = snapshot ?? null;
  const graph = buildInspectionMermaidGraph(normalizedSnapshot);
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
      .current-pr-state-banner { border: 1px solid #cfe0f5; background: linear-gradient(180deg, #f8fbff 0%, #eef5fd 100%); box-shadow: 0 8px 24px rgba(21, 101, 192, 0.08); }
      .current-pr-state-banner h2 { margin: 0.2rem 0 0.5rem 0; font-size: 1.9rem; line-height: 1.15; }
      .current-pr-state-detail { margin: 0 0 0.8rem 0; color: #274766; font-size: 1.02rem; }
      .current-pr-state-grid { grid-template-columns: 14rem 1fr; background: rgba(255,255,255,0.6); padding: 0.85rem; border-radius: 0.6rem; }
      .state-graph-intro { margin-top: 0; color: #333; }
      .state-graph-cues { display: flex; flex-wrap: wrap; gap: 0.45rem 0.75rem; margin: 0.5rem 0 0.75rem 0; }
      .state-graph-cue { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.88rem; color: #355061; }
      .state-graph-cue-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 2.5rem; padding: 0.14rem 0.5rem; border-radius: 999px; border: 1px solid #90a4ae; background: #fff; font-weight: 700; }
      .state-graph-cue-chip-start { border-color: #78909c; background: #f5f7f9; }
      .state-graph-cue-chip-current { border-color: #1565c0; background: #e3f2fd; }
      .state-graph-cue-chip-next { border-color: #5c6bc0; background: #f3f4ff; }
      .state-graph-cue-chip-end { border-color: #2e7d32; background: #e8f5e9; }
      .state-graph-cue-chip-loop { border-color: #ef6c00; background: #fff3e0; }
      .state-graph-help { margin: 0 0 0.85rem 1.1rem; padding: 0; color: #425d70; }
      .state-graph-help li + li { margin-top: 0.35rem; }
      .state-graph-frame { margin-top: 0.5rem; border: 1px solid #d7e3f4; border-radius: 0.75rem; background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%); overflow: hidden; }
      .mermaid-state-graph { min-height: 16rem; padding: 0.75rem; overflow-x: auto; }
      .mermaid-state-graph[data-rendered="pending"] { color: #5a7184; }
      .mermaid-state-graph svg { display: block; width: 100%; height: auto; }
      .state-graph-render-error { margin: 0; padding: 0.9rem; color: #7f4b00; }
      .state-graph-summaries { margin: 0.85rem 0 0 0; padding-left: 1.1rem; }
      .state-graph-summary + .state-graph-summary { margin-top: 0.3rem; }
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
    ${renderStateVisualizationSection(normalizedSnapshot, graph)}
    ${renderCurrentStateBanner(normalizedSnapshot, target, stateLabel)}
    ${topSummary}
    ${renderOuterLoopSummarySection(normalizedSnapshot)}
    ${renderCopilotLoopIterationsSection(normalizedSnapshot)}
    ${renderCopilotLayerSection(normalizedSnapshot?.layers?.copilot)}
    ${renderReviewerLayerSection(normalizedSnapshot?.layers?.reviewer)}
    ${renderSteeringSummarySection(normalizedSnapshot?.layers?.steering)}
    ${graph === null ? "" : renderMermaidBootScript()}
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

      if (requestPath !== "/" && requestPath !== "/snapshot.json" && requestPath !== MERMAID_BROWSER_ASSET_ROUTE) {
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

      if (requestPath === MERMAID_BROWSER_ASSET_ROUTE) {
        try {
          const mermaidBrowserScript = await loadMermaidBrowserScript();
          writeText(response, 200, mermaidBrowserScript, {
            "content-type": "application/javascript; charset=utf-8",
          });
        } catch (error) {
          writeText(response, 500, error instanceof Error ? error.message : String(error), {
            "content-type": "text/plain; charset=utf-8",
          });
        }
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

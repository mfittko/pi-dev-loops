#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { formatCliError } from "../_core-helpers.mjs";
import {
  STATE as COPILOT_STATE,
  TRANSITIONS as COPILOT_TRANSITIONS,
} from "../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  OUTER_GRAPH,
  OUTER_STATE,
  OUTER_TERMINAL_STATES,
  OUTER_TRANSITIONS,
} from "../../packages/core/src/loop/outer-loop-state.mjs";
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
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MERMAID_BROWSER_ASSET_ROUTE = "/assets/mermaid.min.js";
const MERMAID_BROWSER_ASSET_PATH = path.join(REPO_ROOT, "node_modules", "mermaid", "dist", "mermaid.min.js");

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

  const normalizedTransitions = [];
  const seenTransitions = new Set();

  for (const transition of transitions) {
    if (typeof transition !== "string") {
      continue;
    }

    const normalizedTransition = transition.trim();
    if (normalizedTransition.length === 0 || seenTransitions.has(normalizedTransition)) {
      continue;
    }

    seenTransitions.add(normalizedTransition);
    normalizedTransitions.push(normalizedTransition);
  }

  return normalizedTransitions;
}

const COPILOT_TERMINAL_STATES = new Set(
  Object.entries(COPILOT_TRANSITIONS)
    .filter(([, nextStates]) => Array.isArray(nextStates) && nextStates.length === 0)
    .map(([state]) => state),
);
const OUTER_TERMINAL_STATE_SET = new Set(OUTER_TERMINAL_STATES);
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

export async function loadMermaidBrowserScript({ readFileImpl = readFile } = {}) {
  if (mermaidBrowserScriptPromise === null) {
    mermaidBrowserScriptPromise = Promise.resolve()
      .then(() => readFileImpl(MERMAID_BROWSER_ASSET_PATH, "utf8"))
      .catch((error) => {
        mermaidBrowserScriptPromise = null;
        throw error;
      });
  }
  return mermaidBrowserScriptPromise;
}

export function resetMermaidBrowserScriptCache() {
  mermaidBrowserScriptPromise = null;
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

function humanizeGraphStateLabel(state) {
  return String(state).replaceAll("_", " ");
}

function buildFullStateMachineLane({ laneKey, title, states, transitionTable, currentState, transitions, startStates = [], startLabel = "Start", endLabel = "End", terminalStates = null, displayLabelForState = (state) => state, suppressSaturatedNextHighlights = false }) {
  const knownStates = new Set(states);
  const resolvedTerminalStates = terminalStates instanceof Set
    ? terminalStates
    : new Set(states.filter((state) => Array.isArray(transitionTable[state]) && transitionTable[state].length === 0));
  const currentInfo = normalizeCurrentStateInfo(currentState, { knownStates, terminalStates: resolvedTerminalStates });
  const transitionInfo = summarizeTransitionAvailability(transitions);
  const authoritativeCurrentNextStates = currentInfo.available
    ? new Set(Array.isArray(transitionTable[currentInfo.label]) ? transitionTable[currentInfo.label] : [])
    : new Set();
  const highlightedNextStates = new Set(
    transitionInfo.unavailable || !currentInfo.available
      ? []
      : transitionInfo.normalizedTransitions.filter((state) => authoritativeCurrentNextStates.has(state)),
  );
  const broadNextSet = suppressSaturatedNextHighlights
    && currentInfo.available
    && highlightedNextStates.size === knownStates.size;
  const effectiveHighlightedNextStates = broadNextSet ? new Set() : highlightedNextStates;
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
    lines.push(`    ${renderMermaidNode(startId, startLabel, "pill")}`);
    classIds.cue.push(startId);
  }

  for (const state of states) {
    const nodeId = renderMermaidNodeId(laneKey, state);
    const terminal = resolvedTerminalStates.has(state);
    lines.push(`    ${renderMermaidNode(nodeId, displayLabelForState(state))}`);

    if (currentInfo.available && currentInfo.label === state) {
      classIds[terminal ? "currentTerminal" : "current"].push(nodeId);
    } else if (effectiveHighlightedNextStates.has(state)) {
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
      lines.push(`    ${renderMermaidNode(endId, endLabel, "circle")}`);
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
  } else if (broadNextSet) {
    const noteId = `${laneKey}_broad_next_set`;
    lines.push(`    ${renderMermaidNode(noteId, "next evaluation may resolve to any shown state")}`);
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
    summary: `${currentInfo.label}; full authoritative state machine shown`,
  };
}

export function buildInspectionMermaidGraph(snapshot) {
  if (snapshot === null || snapshot === undefined || renderSnapshotStateLabel(snapshot) === "unavailable") {
    return null;
  }

  const lanes = [
    buildFullStateMachineLane({
      laneKey: "outer_loop_family",
      title: "outer-loop family",
      states: Object.values(OUTER_STATE),
      transitionTable: OUTER_TRANSITIONS,
      currentState: snapshot.outerState,
      transitions: snapshot.allowedTransitions,
      startStates: OUTER_GRAPH.entryStates,
      startLabel: OUTER_GRAPH.start.label,
      endLabel: OUTER_GRAPH.end.label,
      terminalStates: OUTER_TERMINAL_STATE_SET,
      displayLabelForState: humanizeGraphStateLabel,
      suppressSaturatedNextHighlights: true,
    }),
    buildFullStateMachineLane({
      laneKey: "copilot_layer",
      title: "copilot layer",
      states: Object.values(COPILOT_STATE),
      transitionTable: COPILOT_TRANSITIONS,
      currentState: snapshot.layers?.copilot?.currentState,
      transitions: snapshot.layers?.copilot?.allowedTransitions,
      startStates: [COPILOT_STATE.PR_DRAFT],
      terminalStates: COPILOT_TERMINAL_STATES,
    }),
    buildFullStateMachineLane({
      laneKey: "reviewer_layer",
      title: "reviewer layer",
      states: Object.values(REVIEWER_STATE),
      transitionTable: REVIEWER_TRANSITIONS,
      currentState: snapshot.layers?.reviewer?.currentState,
      transitions: snapshot.layers?.reviewer?.allowedTransitions,
      startStates: [REVIEWER_STATE.WAITING_FOR_REVIEW_REQUEST],
      terminalStates: REVIEWER_TERMINAL_STATES,
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
    <li><strong>Outer loop:</strong> the outer lane now comes from the shared authoritative outer-loop graph contract; outerAction remains visible only as a compatibility projection.</li>
    <li><strong>🔁 Loop cue:</strong> this viewer is revisited by manual reload, so the same current state can recur across inspections until evidence changes.</li>
  </ul>`;
}

function renderStateGraphSummaries(graph) {
  return `<ul class="state-graph-summaries">
    ${graph.lanes.map((lane) => `<li class="state-graph-summary"><strong>${escapeHtml(lane.title)}:</strong> current <code>${escapeHtml(lane.currentLabel)}</code>; ${escapeHtml(lane.summary ?? lane.transitionInfo.summary)}; ${escapeHtml(lane.transitionInfo.summary)}</li>`).join("")}
  </ul>`;
}

function renderStateGraphDetails(graph) {
  return `<details class="state-graph-details">
    <summary>Graph guide and lane details</summary>
    ${renderStateGraphHelp()}
    ${renderStateGraphSummaries(graph)}
  </details>`;
}

function renderMermaidBootScript() {
  return `<script src="${MERMAID_BROWSER_ASSET_ROUTE}"></script>
    <script>
      (() => {
        const frames = Array.from(document.querySelectorAll(".state-graph-frame"));
        const graphs = Array.from(document.querySelectorAll(".mermaid-state-graph"));
        const clampScale = (value) => Math.max(0.5, Math.min(2.5, value));
        const updateFrameScale = (frame, requestedScale) => {
          const scale = clampScale(requestedScale);
          frame.dataset.graphScale = String(scale);
          const zoomValue = frame.querySelector("[data-graph-zoom-value]");
          if (zoomValue) {
            zoomValue.textContent = String(Math.round(scale * 100)) + "%";
          }
          const svg = frame.querySelector(".mermaid-state-graph svg");
          if (svg) {
            svg.style.width = String(Math.round(scale * 100)) + "%";
            svg.style.maxWidth = "none";
            svg.style.height = "auto";
          }
          return scale;
        };
        const zoomGraphViewport = (frame, graphViewport, requestedScale, focusPoint = null) => {
          const previousScale = Number(frame.dataset.graphScale || 1);
          const nextScale = updateFrameScale(frame, requestedScale);
          if (!focusPoint || nextScale === previousScale) {
            return;
          }
          const scaleRatio = nextScale / previousScale;
          requestAnimationFrame(() => {
            graphViewport.scrollLeft = (focusPoint.contentX * scaleRatio) - focusPoint.viewportX;
            graphViewport.scrollTop = (focusPoint.contentY * scaleRatio) - focusPoint.viewportY;
          });
        };
        const renderFallback = (message) => {
          graphs.forEach((graph) => {
            const fallback = document.createElement("p");
            fallback.className = "state-graph-render-error";
            fallback.textContent = message;
            graph.replaceWith(fallback);
          });
        };

        frames.forEach((frame) => {
          updateFrameScale(frame, Number(frame.dataset.graphScale || 1));
          frame.querySelector("[data-graph-zoom-in]")?.addEventListener("click", () => {
            updateFrameScale(frame, Number(frame.dataset.graphScale || 1) + 0.25);
          });
          frame.querySelector("[data-graph-zoom-out]")?.addEventListener("click", () => {
            updateFrameScale(frame, Number(frame.dataset.graphScale || 1) - 0.25);
          });
          frame.querySelector("[data-graph-zoom-reset]")?.addEventListener("click", () => {
            updateFrameScale(frame, 1);
          });
          frame.querySelector("[data-graph-fullscreen]")?.addEventListener("click", async () => {
            if (document.fullscreenElement === frame) {
              await document.exitFullscreen?.();
              return;
            }
            await frame.requestFullscreen?.();
          });

          const graphViewport = frame.querySelector(".mermaid-state-graph");
          if (graphViewport) {
            let dragState = null;
            graphViewport.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) {
                return;
              }
              dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startScrollLeft: graphViewport.scrollLeft,
                startScrollTop: graphViewport.scrollTop,
              };
              graphViewport.dataset.dragging = "true";
              graphViewport.setPointerCapture?.(event.pointerId);
              event.preventDefault();
            });
            graphViewport.addEventListener("pointermove", (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
              }
              graphViewport.scrollLeft = dragState.startScrollLeft - (event.clientX - dragState.startX);
              graphViewport.scrollTop = dragState.startScrollTop - (event.clientY - dragState.startY);
            });
            const stopDragging = (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
              }
              graphViewport.dataset.dragging = "false";
              graphViewport.releasePointerCapture?.(event.pointerId);
              dragState = null;
            };
            graphViewport.addEventListener("pointerup", stopDragging);
            graphViewport.addEventListener("pointercancel", stopDragging);
            graphViewport.addEventListener("dblclick", (event) => {
              const rect = graphViewport.getBoundingClientRect();
              zoomGraphViewport(
                frame,
                graphViewport,
                Number(frame.dataset.graphScale || 1) + 0.25,
                {
                  viewportX: event.clientX - rect.left,
                  viewportY: event.clientY - rect.top,
                  contentX: graphViewport.scrollLeft + (event.clientX - rect.left),
                  contentY: graphViewport.scrollTop + (event.clientY - rect.top),
                },
              );
              event.preventDefault();
            });
          }
        });

        if (graphs.length === 0) {
          return;
        }
        if (typeof window.mermaid === "undefined") {
          renderFallback("Mermaid browser asset unavailable. Use the details below or open /snapshot.json.");
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
            const frame = graph.closest(".state-graph-frame");
            if (frame) {
              updateFrameScale(frame, Number(frame.dataset.graphScale || 1));
            }
          });
        }).catch(() => {
          renderFallback("Mermaid could not render this snapshot safely. Use the details below or open /snapshot.json.");
        });
      })();
    </script>`;
}

function renderStateVisualizationSection(snapshot, graph = buildInspectionMermaidGraph(snapshot)) {
  if (graph === null) {
    return `<div class="state-graph-block">
      <p>Snapshot unavailable, so no state graph can be rendered yet.</p>
    </div>`;
  }

  return `<div class="state-graph-block">
    <div class="state-graph-frame" data-graph-scale="1">
      <div class="state-graph-toolbar" aria-label="Graph controls">
        <button type="button" data-graph-zoom-out aria-label="Zoom out">−</button>
        <button type="button" data-graph-zoom-in aria-label="Zoom in">+</button>
        <button type="button" data-graph-zoom-reset aria-label="Reset zoom">100%</button>
        <span class="state-graph-zoom-value" data-graph-zoom-value>100%</span>
        <button type="button" data-graph-fullscreen aria-label="Open graph fullscreen">⤢</button>
      </div>
      <div class="mermaid-state-graph mermaid" data-rendered="pending" aria-label="Mermaid inspection state graph">${escapeHtml(graph.definition)}</div>
    </div>
    ${renderStateGraphLegend()}
    ${renderStateGraphDetails(graph)}
  </div>`;
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

function renderCollapsedDetailsPanel(content) {
  return `<details class="inspection-details">
    <summary>Details</summary>
    ${content}
  </details>`;
}

function renderOuterLoopSummarySection(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    return renderCompactSection({ title: "outer-loop summary" });
  }

  return renderCompactSection({
    title: "outer-loop summary",
    entries: [
      ["activeStateFamily", snapshot.activeStateFamily ?? "not present"],
      ["outerState", snapshot.outerState ?? "not present"],
      ["outerAction (compatibility)", snapshot.outerAction ?? "not present"],
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

function humanizeStateToken(value) {
  const token = formatStateToken(value, "not present");
  if (token === "not present") {
    return token;
  }
  return token.replaceAll("_", " ");
}

function titleCaseWords(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderReviewerVerdict(snapshot) {
  if (!snapshot) {
    return "not present";
  }

  if (snapshot.layers?.reviewer?.approvedOnCurrentHead === true) {
    return "approved on current head";
  }

  const submittedReviewState = formatStateToken(snapshot.layers?.reviewer?.submittedReviewState);
  return submittedReviewState;
}

function summarizeCurrentPrStatus(snapshot) {
  if (!snapshot) {
    return {
      headline: "Snapshot unavailable",
      detail: "Unable to determine the current PR state yet.",
      nextAction: "Reload the snapshot or open /snapshot.json for the raw error payload.",
    };
  }

  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);
  const statusClass = formatStateToken(snapshot.statusClass, "unknown");
  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");
  const sameHeadCleanConverged = snapshot.layers?.copilot?.sameHeadCleanConverged === true;
  const copilotLoopDisposition = formatStateToken(snapshot.layers?.copilot?.loopDisposition);
  const copilotTerminal = snapshot.layers?.copilot?.terminal === true;
  const reviewerApprovedOnCurrentHead = snapshot.layers?.reviewer?.approvedOnCurrentHead === true;

  if (outerState === OUTER_STATE.DONE_TERMINAL || statusClass === "done" || outerAction === "done" || copilotState === "done") {
    return {
      headline: "PR complete",
      detail: "The current inspection says this PR is in a terminal done state.",
      nextAction: "Confirm merge/readiness context or inspect the raw snapshot for terminal evidence.",
    };
  }

  if (outerState === OUTER_STATE.NEEDS_RECONCILE) {
    return {
      headline: "Needs reconcile",
      detail: "The authoritative outer state is needs_reconcile, which means the current inputs are ambiguous, conflicting, or insufficient.",
      nextAction: "Reconcile the conflicting state before trusting the current routing result.",
    };
  }

  if (outerState === OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER) {
    return {
      headline: "Live owner already active",
      detail: "The authoritative outer state is stay_with_current_live_owner, so the loop should not issue a new handoff yet.",
      nextAction: "Wait for the live owner to progress the run, then refresh the inspection.",
    };
  }

  if (outerState === OUTER_STATE.STOP_NEEDS_HUMAN) {
    return {
      headline: "Needs attention",
      detail: "The authoritative outer state is stop_needs_human, so automated progress should stop until a human resolves the blocking condition.",
      nextAction: "Read the stop reason, trust markers, and layer summaries before proceeding.",
    };
  }

  if (copilotState === "unresolved_feedback_present") {
    return {
      headline: "Needs author fixes",
      detail: "Copilot has unresolved feedback on the current PR head.",
      nextAction: "Address the feedback, then reply to and resolve each addressed thread.",
    };
  }

  if (copilotState === "already_fixed_needs_reply_resolve") {
    return {
      headline: "Fixes applied; threads still need resolution",
      detail: "Local fixes appear applied, but GitHub review threads still need reply/resolve follow-up.",
      nextAction: "Reply to and resolve the addressed review threads before requesting another Copilot pass.",
    };
  }

  if (copilotState === "waiting_for_copilot_review") {
    return {
      headline: "Waiting for Copilot review",
      detail: "Copilot review has been requested and the PR is waiting for new review activity.",
      nextAction: "Wait for Copilot review or refresh the snapshot after review activity lands.",
    };
  }

  if (copilotState === "ready_to_rerequest_review" && reviewerApprovedOnCurrentHead && (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged" || copilotTerminal)) {
    return {
      headline: "Approved current head",
      detail: "The current head has both a clean submitted Copilot review and an approved human review.",
      nextAction: "Proceed to merge if authorized, or wait for any additional required review/approval signal before merging.",
    };
  }

  if (copilotState === "ready_to_rerequest_review" && (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged" || copilotTerminal)) {
    return {
      headline: "Copilot pass complete",
      detail: "The current head already has a clean submitted Copilot review with no unresolved feedback.",
      nextAction: "Proceed to final human review or approval, or wait for a meaningful remediation event before requesting another Copilot pass.",
    };
  }

  if (copilotState === "ready_to_rerequest_review") {
    return {
      headline: "Ready to re-request Copilot review",
      detail: "The current head looks clean enough for another Copilot pass or final confirmation.",
      nextAction: "Re-request Copilot review only after the smallest honest local validation is green, or confirm the PR is done.",
    };
  }

  if (copilotState === "waiting_for_ci") {
    return {
      headline: "Waiting for CI",
      detail: "The current head has progressed past review but is still waiting on CI readiness.",
      nextAction: "Wait for CI to complete or become available.",
    };
  }

  if (reviewerState === "waiting_for_author_followup") {
    return {
      headline: "Waiting for author follow-up",
      detail: "Reviewer work is done for this round and the PR is waiting on author-side changes.",
      nextAction: "Wait for author commits or refresh after follow-up lands.",
    };
  }

  if (reviewerState === "waiting_for_re_request") {
    return {
      headline: "Waiting for reviewer re-request",
      detail: "Reviewer work is paused until a new explicit review request arrives.",
      nextAction: "Wait for a reviewer re-request after follow-up commits.",
    };
  }

  if (reviewerState === "review_requested" || reviewerState === "determine_review_plan" || reviewerState === "reviews_running" || reviewerState === "merge_results" || reviewerState === "draft_review_ready" || reviewerState === "draft_review_posted" || reviewerState === "waiting_for_user_submit" || reviewerState === "submitted_review" || reviewerState === "review_invalidated") {
    return {
      headline: "Reviewer loop active",
      detail: `Reviewer lane is currently at ${humanizeStateToken(reviewerState)}.`,
      nextAction: "Follow the reviewer lane details below and refresh after the next review event.",
    };
  }

  if (outerState === "unknown" && snapshot.needsAttention) {
    return {
      headline: "Needs attention",
      detail: "The current snapshot is not authoritative enough to collapse to one trusted outer state.",
      nextAction: "Check trust markers and layer summaries before acting on this snapshot.",
    };
  }

  if (outerAction === "stop" || statusClass === "blocked") {
    return {
      headline: "Needs attention",
      detail: "The inspection found a blocked or stop-like state, but the authoritative outer state was not specific enough to classify it more narrowly here.",
      nextAction: "Read the stop reason, trust markers, and layer summaries before proceeding.",
    };
  }

  if (outerState === OUTER_STATE.CONTINUE_CURRENT_WAIT || outerAction === "continue_wait") {
    return {
      headline: "Waiting for follow-up",
      detail: "The authoritative outer state is continue_current_wait, so the loop should remain in its durable wait path for now.",
      nextAction: "Refresh after new review, CI, or author activity lands.",
    };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP || outerAction === "reenter_copilot_loop") {
    return {
      headline: "Copilot loop needs action",
      detail: "The authoritative outer state is handoff_to_copilot_loop, so the next meaningful work is in the Copilot lane.",
      nextAction: "Inspect the Copilot state and act on the requested follow-up.",
    };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP || outerAction === "reenter_reviewer_loop") {
    return {
      headline: "Reviewer loop needs action",
      detail: "The authoritative outer state is handoff_to_reviewer_loop, so the next meaningful work is in the reviewer lane.",
      nextAction: "Inspect the reviewer state and act on the requested follow-up.",
    };
  }

  return {
    headline: titleCaseWords(humanizeStateToken(copilotState === "not present" ? (outerState === "unknown" ? outerAction : outerState) : copilotState)),
    detail: "The viewer could not collapse this to a narrower plain-English status than the current exported loop states.",
    nextAction: "Use the current-state banner fields plus the graph and summaries below.",
  };
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

function renderCurrentStateBanner(snapshot, target, stateLabel, graph) {
  const summary = summarizeCurrentPrStatus(snapshot);
  return `<section class="current-pr-state-banner" aria-label="PR #${escapeHtml(target.pr)} State">
    <h1>PR #${escapeHtml(target.pr)} State</h1>
    <p class="current-pr-state-summary-headline">${escapeHtml(summary.headline)}</p>
    <p class="current-pr-state-detail">${escapeHtml(summary.detail)}</p>
    <p class="current-pr-state-detail">${escapeHtml(renderCurrentStateNote(snapshot))}</p>
    <dl class="current-pr-state-grid">
      <dt>target</dt><dd><code>${escapeHtml(target.repo)}#${escapeHtml(target.pr)}</code></dd>
      <dt>snapshot trust</dt><dd><span class="badge">${escapeHtml(stateLabel)}</span></dd>
      <dt>status class</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.statusClass))}</code></dd>
      <dt>outer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.outerState))}</code></dd>
      <dt>outerAction (compatibility)</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.outerAction))}</code></dd>
      <dt>current Copilot state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.copilot?.currentState))}</code></dd>
      <dt>current reviewer state</dt><dd><code>${escapeHtml(formatStateToken(snapshot?.layers?.reviewer?.currentState))}</code></dd>
      <dt>reviewer verdict</dt><dd>${escapeHtml(renderReviewerVerdict(snapshot))}</dd>
      <dt>needs attention</dt><dd>${escapeHtml(String(snapshot?.needsAttention ?? "not present"))}</dd>
      <dt>next action</dt><dd>${escapeHtml(summary.nextAction)}</dd>
      <dt>trust</dt><dd>${escapeHtml(snapshot?.evidence?.summary ?? "not present")}</dd>
    </dl>
    <div class="current-pr-state-visualization">
      ${renderStateVisualizationSection(snapshot, graph)}
    </div>
  </section>`;
}

function renderTargetKey(target) {
  return `${target.repo}#${target.pr}`;
}

function summarizeInboxRow(snapshot) {
  if (!snapshot) {
    return {
      statusClass: "unknown",
      trustLabel: "unavailable",
      needsAttention: false,
      freshness: "unknown freshness",
      headline: "Snapshot unavailable",
    };
  }

  const inspectedAt = Date.parse(snapshot.inspectedAt ?? "");
  const freshness = Number.isNaN(inspectedAt)
    ? "unknown freshness"
    : (Date.now() - inspectedAt <= 30 * 60 * 1000 ? "fresh" : "stale");

  return {
    statusClass: formatStateToken(snapshot.statusClass, "unknown"),
    trustLabel: renderSnapshotStateLabel(snapshot),
    needsAttention: snapshot.needsAttention === true,
    freshness,
    headline: summarizeCurrentPrStatus(snapshot).headline,
  };
}

function renderInboxSidebar(items, selectedTarget) {
  const selectedKey = renderTargetKey(selectedTarget);
  return `<aside class="assigned-pr-inbox" data-sidebar-collapsed="false">
    <div class="assigned-pr-inbox-header">
      <h2>Assigned PR inbox</h2>
      <button type="button" class="inbox-collapse-toggle" data-inbox-toggle aria-expanded="true">Collapse</button>
    </div>
    <label class="inbox-search-label" for="inbox-search">Search assigned PRs</label>
    <input id="inbox-search" class="inbox-search-input" type="search" placeholder="Search repo, PR, title, state…" data-inbox-search />
    <ul class="assigned-pr-list" data-inbox-list>
      ${items.map((item) => {
    const summary = summarizeInboxRow(item.snapshot ?? null);
    const target = item.target;
    const key = renderTargetKey(target);
    const selected = key === selectedKey;
    const searchText = `${target.repo} #${target.pr} ${item.title ?? ""} ${summary.statusClass} ${summary.trustLabel} ${summary.headline}`.toLowerCase();
    return `<li class="assigned-pr-row ${selected ? "is-selected" : ""}" data-inbox-item data-search="${escapeHtml(searchText)}">
          <a class="assigned-pr-link" href="/?repo=${encodeURIComponent(target.repo)}&amp;pr=${encodeURIComponent(String(target.pr))}" ${selected ? 'aria-current="page"' : ""}>
            <div class="assigned-pr-line">
              <span class="assigned-pr-id">#${escapeHtml(String(target.pr))}</span>
              <span class="assigned-pr-title">${escapeHtml(item.title ?? "Untitled pull request")}</span>
            </div>
            <div class="assigned-pr-line assigned-pr-meta">
              <span class="assigned-pr-repo">${escapeHtml(target.repo)}</span>
              <span class="assigned-pr-status">${escapeHtml(summary.statusClass)}</span>
              <span class="assigned-pr-trust">${escapeHtml(summary.trustLabel)} · ${escapeHtml(summary.freshness)}</span>
              <span class="assigned-pr-headline">${escapeHtml(summary.headline)}</span>
              ${summary.needsAttention ? '<span class="assigned-pr-attention" aria-label="Needs attention">⚠ needs attention</span>' : ""}
            </div>
          </a>
        </li>`;
  }).join("")}
    </ul>
    <p class="assigned-pr-empty" data-inbox-empty hidden>No assigned PRs match this search.</p>
  </aside>`;
}

function renderInboxShellScript() {
  return `<script>
    (() => {
      const sidebar = document.querySelector(".assigned-pr-inbox");
      const toggle = document.querySelector("[data-inbox-toggle]");
      const search = document.querySelector("[data-inbox-search]");
      const items = Array.from(document.querySelectorAll("[data-inbox-item]"));
      const empty = document.querySelector("[data-inbox-empty]");
      const updateFilter = () => {
        const query = (search?.value ?? "").trim().toLowerCase();
        let visibleCount = 0;
        items.forEach((item) => {
          const haystack = item.getAttribute("data-search") ?? "";
          const visible = query.length === 0 || haystack.includes(query);
          item.hidden = !visible;
          if (visible) {
            visibleCount += 1;
          }
        });
        if (empty) {
          empty.hidden = visibleCount !== 0;
        }
      };
      toggle?.addEventListener("click", () => {
        const collapsed = sidebar?.dataset.sidebarCollapsed === "true";
        if (!sidebar) {
          return;
        }
        sidebar.dataset.sidebarCollapsed = collapsed ? "false" : "true";
        toggle.textContent = collapsed ? "Collapse" : "Expand";
        toggle.setAttribute("aria-expanded", collapsed ? "true" : "false");
      });
      search?.addEventListener("input", updateFilter);
      updateFilter();
    })();
  </script>`;
}

export function renderInspectRunViewerHtml({
  target,
  snapshot = null,
  error = null,
  inboxItems = [],
}) {
  const normalizedSnapshot = snapshot ?? null;
  const graph = buildInspectionMermaidGraph(normalizedSnapshot);
  const stateLabel = renderSnapshotStateLabel(normalizedSnapshot);
  const title = `${target.repo}#${target.pr} inspection snapshot`;
  const runId = normalizedSnapshot?.runId ?? "not present";
  const rawSnapshotHref = `/snapshot.json?repo=${encodeURIComponent(target.repo)}&pr=${encodeURIComponent(String(target.pr))}`;
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
      body { font-family: sans-serif; margin: 1rem; max-width: none; line-height: 1.4; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
      .inspection-shell { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; align-items: start; }
      .assigned-pr-inbox { position: sticky; top: 1rem; width: 22rem; max-width: 100%; border: 1px solid #d9e5f2; border-radius: 0.65rem; padding: 0.7rem; background: #fbfdff; max-height: calc(100vh - 2rem); overflow: auto; box-sizing: border-box; }
      .assigned-pr-inbox[data-sidebar-collapsed="true"] { width: 3rem; overflow: hidden; }
      .assigned-pr-inbox[data-sidebar-collapsed="true"] h2,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .inbox-search-label,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .inbox-search-input,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-list,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-empty { display: none; }
      .assigned-pr-inbox-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; }
      .assigned-pr-inbox-header h2 { margin: 0; font-size: 1rem; flex: 1; }
      .inbox-collapse-toggle { border: 1px solid #a5bed4; background: #fff; border-radius: 0.4rem; padding: 0.25rem 0.45rem; cursor: pointer; }
      .inbox-search-label { display: block; font-size: 0.82rem; font-weight: 600; color: #355061; margin-bottom: 0.25rem; }
      .inbox-search-input { width: 100%; border: 1px solid #bfd0e2; border-radius: 0.4rem; padding: 0.35rem 0.45rem; margin-bottom: 0.6rem; }
      .assigned-pr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
      .assigned-pr-row { border: 1px solid #d6e0ea; border-radius: 0.5rem; background: #fff; }
      .assigned-pr-row.is-selected { border-color: #1565c0; box-shadow: inset 0 0 0 1px #1565c0; }
      .assigned-pr-link { display: block; padding: 0.45rem 0.5rem; color: inherit; text-decoration: none; }
      .assigned-pr-id { font-weight: 700; margin-right: 0.35rem; }
      .assigned-pr-title { font-weight: 600; }
      .assigned-pr-line + .assigned-pr-line { margin-top: 0.3rem; }
      .assigned-pr-meta { display: flex; flex-wrap: wrap; gap: 0.28rem 0.42rem; font-size: 0.82rem; color: #486174; }
      .assigned-pr-attention { color: #a34a00; font-weight: 700; }
      .inspection-main { min-width: 0; }
      .badge { display: inline-block; padding: 0.25rem 0.5rem; border: 1px solid #666; border-radius: 0.25rem; font-weight: 600; }
      .current-pr-state-banner { border: none; background: none; box-shadow: none; padding: 0; margin-top: 0; }
      .current-pr-state-banner h1 { margin: 0 0 0.5rem 0; font-size: 2.2rem; line-height: 1.15; }
      .current-pr-state-summary-headline { margin: 0 0 0.4rem 0; color: #1565c0; font-weight: 700; font-size: 1.1rem; }
      .current-pr-state-detail { margin: 0.25rem 0 0.8rem 0; color: #274766; font-size: 0.98rem; }
      .current-pr-state-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); background: none; padding: 0; border-radius: 0; margin-bottom: 1rem; }
      .current-pr-state-grid dt { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: #4c6478; }
      .current-pr-state-grid dd { margin: 0 0 0.75rem 0; }
      .state-graph-block { margin-top: 0.4rem; }
      .state-graph-frame { margin-top: 0.5rem; border: 1px solid #d7e3f4; border-radius: 0.75rem; background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%); overflow: hidden; }
      .state-graph-toolbar { display: flex; align-items: center; gap: 0.4rem; padding: 0.55rem 0.65rem; border-bottom: 1px solid #d7e3f4; background: rgba(255,255,255,0.85); }
      .state-graph-toolbar button { border: 1px solid #9fb6cb; background: #fff; border-radius: 0.45rem; padding: 0.3rem 0.6rem; font: inherit; cursor: pointer; }
      .state-graph-toolbar button:hover { background: #f3f8fd; }
      .state-graph-zoom-value { margin-left: auto; font-size: 0.88rem; color: #486174; }
      .mermaid-state-graph { min-height: 16rem; padding: 0.75rem; overflow: auto; cursor: grab; user-select: none; touch-action: none; }
      .mermaid-state-graph[data-dragging="true"] { cursor: grabbing; }
      .mermaid-state-graph[data-rendered="pending"] { color: #5a7184; }
      .mermaid-state-graph svg { display: block; width: 100%; height: auto; transition: width 120ms ease; }
      .state-graph-cues { display: flex; flex-wrap: wrap; gap: 0.45rem 0.75rem; margin: 0.75rem 0 0.35rem 0; }
      .state-graph-cue { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.88rem; color: #355061; }
      .state-graph-cue-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 2.5rem; padding: 0.14rem 0.5rem; border-radius: 999px; border: 1px solid #90a4ae; background: #fff; font-weight: 700; }
      .state-graph-cue-chip-start { border-color: #78909c; background: #f5f7f9; }
      .state-graph-cue-chip-current { border-color: #1565c0; background: #e3f2fd; }
      .state-graph-cue-chip-next { border-color: #5c6bc0; background: #f3f4ff; }
      .state-graph-cue-chip-end { border-color: #2e7d32; background: #e8f5e9; }
      .state-graph-cue-chip-loop { border-color: #ef6c00; background: #fff3e0; }
      .state-graph-details { margin-top: 0.7rem; }
      .state-graph-details summary { cursor: pointer; font-weight: 600; color: #355061; }
      .state-graph-help { margin: 0.75rem 0 0.85rem 1.1rem; padding: 0; color: #425d70; }
      .state-graph-help li + li { margin-top: 0.35rem; }
      .state-graph-render-error { margin: 0; padding: 0.9rem; color: #7f4b00; }
      .state-graph-summaries { margin: 0.85rem 0 0 0; padding-left: 1.1rem; }
      .state-graph-summary + .state-graph-summary { margin-top: 0.3rem; }
      .inspection-details { margin-top: 1rem; }
      .inspection-details summary { cursor: pointer; font-weight: 700; }
      dl { display: grid; grid-template-columns: 14rem 1fr; gap: 0.35rem 0.75rem; }
      dt { font-weight: 600; }
      section { border: 1px solid #ddd; border-radius: 0.5rem; padding: 0.75rem; margin-top: 1rem; }
      .current-pr-state-banner section,
      .current-pr-state-banner .state-graph-block,
      .current-pr-state-banner .current-pr-state-visualization { border: none; padding: 0; margin-top: 0; }
      @media (max-width: 900px) {
        .inspection-shell { grid-template-columns: minmax(0, 1fr); }
        .assigned-pr-inbox { position: static; max-height: none; }
        .current-pr-state-grid { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 640px) {
        .current-pr-state-grid { grid-template-columns: 1fr; }
        .state-graph-toolbar { flex-wrap: wrap; }
        .state-graph-zoom-value { margin-left: 0; }
      }
    </style>
  </head>
  <body>
    <div class="inspection-shell">
      ${renderInboxSidebar(inboxItems, target)}
      <main class="inspection-main">
        ${renderCurrentStateBanner(normalizedSnapshot, target, stateLabel, graph)}
        ${renderCollapsedDetailsPanel(`
      <p><strong>Snapshot state:</strong> <span class="badge">${escapeHtml(stateLabel)}</span> <button type="button" onclick="window.location.reload()" title="Reload snapshot" aria-label="Reload snapshot">🔄</button></p>
      <p><strong>Refresh:</strong> manual reload only. <strong>Raw snapshot:</strong> <a href="${escapeHtml(rawSnapshotHref)}"><code>${escapeHtml(rawSnapshotHref)}</code></a></p>
      ${topSummary}
      ${renderOuterLoopSummarySection(normalizedSnapshot)}
      ${renderCopilotLoopIterationsSection(normalizedSnapshot)}
      ${renderCopilotLayerSection(normalizedSnapshot?.layers?.copilot)}
      ${renderReviewerLayerSection(normalizedSnapshot?.layers?.reviewer)}
      ${renderSteeringSummarySection(normalizedSnapshot?.layers?.steering)}
    `)}
      </main>
    </div>
    ${renderInboxShellScript()}
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

function normalizeRequestedTargetFromUrl(rawUrl, fallbackTarget) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return fallbackTarget;
  }

  const url = new URL(rawUrl, "http://localhost");
  const repo = url.searchParams.get("repo");
  const pr = url.searchParams.get("pr");
  if (repo === null && pr === null) {
    return fallbackTarget;
  }

  return normalizeInspectionTarget({
    repo: repo ?? fallbackTarget.repo,
    pr: pr ?? fallbackTarget.pr,
  });
}

function dedupeInboxEntries(entries) {
  const seen = new Map();
  const deduped = [];
  for (const entry of entries) {
    const key = renderTargetKey(entry.target);
    const existing = seen.get(key);
    if (existing) {
      if ((existing.title === null || existing.title === undefined) && entry.title) {
        existing.title = entry.title;
      }
      continue;
    }
    const normalizedEntry = { target: entry.target, title: entry.title ?? null };
    seen.set(key, normalizedEntry);
    deduped.push(normalizedEntry);
  }
  return deduped;
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
  const loadMermaidBrowserScriptImpl = deps.loadMermaidBrowserScriptImpl ?? loadMermaidBrowserScript;
  const logErrorImpl = deps.logErrorImpl ?? (() => {});
  const defaultTarget = normalizeInspectionTarget({ repo: options.repo, pr: options.pr });
  const adapterOptions = makeAdapterOptions(options);
  const supportsAssignedInbox = options.copilotInputPath === undefined && options.reviewerInputPath === undefined;

  return createServer(async (request, response) => {
    try {
      const requestPath = request.url ? new URL(request.url, "http://localhost").pathname : "/";
      const method = request.method ?? "GET";
      const requestTarget = normalizeRequestedTargetFromUrl(request.url, defaultTarget);

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
          const mermaidBrowserScript = await loadMermaidBrowserScriptImpl();
          writeText(response, 200, mermaidBrowserScript, {
            "content-type": "application/javascript; charset=utf-8",
          });
        } catch (error) {
          logErrorImpl(error);
          writeText(response, 500, "Mermaid browser asset unavailable", {
            "content-type": "text/plain; charset=utf-8",
          });
        }
        return;
      }

      if (requestPath === "/snapshot.json") {
        try {
          const snapshot = requireSnapshotForJson(await adapter.loadSnapshot(requestTarget, adapterOptions));
          writeJson(response, 200, snapshot);
        } catch (error) {
          writeJson(response, 500, jsonErrorPayload(requestTarget, error));
        }
        return;
      }

      const listAssignedPullRequests = typeof adapter.listAssignedPullRequests === "function"
        ? adapter.listAssignedPullRequests.bind(adapter)
        : async () => [];
      let assignedEntries = [];
      if (supportsAssignedInbox) {
        try {
          const rawAssignedEntries = await listAssignedPullRequests(adapterOptions);
          assignedEntries = Array.isArray(rawAssignedEntries)
            ? rawAssignedEntries.flatMap((entry) => {
              try {
                if (entry && typeof entry === "object" && entry.target) {
                  return [{ target: normalizeInspectionTarget(entry.target), title: entry.title ?? null }];
                }
                return [{ target: normalizeInspectionTarget(entry), title: null }];
              } catch {
                return [];
              }
            })
            : [];
        } catch (error) {
          logErrorImpl(error);
          assignedEntries = [];
        }
      }
      const inboxEntries = dedupeInboxEntries([{ target: requestTarget, title: null }, ...assignedEntries]);

      let snapshot = null;
      let error = null;
      try {
        snapshot = await adapter.loadSnapshot(requestTarget, adapterOptions);
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }

      const inboxItems = [];
      for (const inboxEntry of inboxEntries) {
        const inboxTarget = inboxEntry.target;
        if (renderTargetKey(inboxTarget) === renderTargetKey(requestTarget)) {
          inboxItems.push({
            target: inboxTarget,
            title: inboxEntry.title ?? `PR #${inboxTarget.pr}`,
            snapshot: snapshot ?? null,
          });
          continue;
        }
        try {
          const inboxSnapshot = await adapter.loadSnapshot(inboxTarget, adapterOptions);
          inboxItems.push({ target: inboxTarget, title: inboxEntry.title ?? `PR #${inboxTarget.pr}`, snapshot: inboxSnapshot ?? null });
        } catch {
          inboxItems.push({
            target: inboxTarget,
            title: inboxEntry.title ?? `PR #${inboxTarget.pr}`,
            snapshot: null,
          });
        }
      }

      const html = renderInspectRunViewerHtml({
        target: requestTarget,
        snapshot: snapshot ?? null,
        error,
        inboxItems,
      });
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

import { readFile } from "node:fs/promises";

import {
  DEFAULT_INBOX_MODE,
  DEFAULT_INBOX_PAGE,
  DEFAULT_INBOX_PR_STATE,
  DEFAULT_INBOX_UPDATED_WITHIN_DAYS,
  INBOX_MODE_FILTER_PRESETS,
  INBOX_STATE_FILTER_PRESETS,
  INBOX_UPDATED_FILTER_PRESETS,
  MERMAID_BROWSER_ASSET_PATH,
  MERMAID_BROWSER_ASSET_ROUTE,
} from "./constants.mjs";
import { dedupeRepoSlugOptions, repoSlugEquals, tryNormalizeRepoSlug } from "../../../packages/core/src/github/repo-slug.mjs";
import {
  STATE as COPILOT_STATE,
  TRANSITIONS as COPILOT_TRANSITIONS,
} from "../../../packages/core/src/loop/copilot-loop-state.mjs";
import {
  OUTER_GRAPH,
  OUTER_STATE,
  OUTER_TERMINAL_STATES,
  OUTER_TRANSITIONS,
} from "../../../packages/core/src/loop/outer-loop-state.mjs";
import {
  REVIEWER_STATE,
  REVIEWER_TRANSITIONS,
} from "../../../packages/core/src/loop/reviewer-loop-state.mjs";

let mermaidBrowserScriptPromise = null;

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

  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");
  let focusIds = lanes.map((lane) => lane.currentId);
  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP || outerAction === "reenter_copilot_loop") {
    focusIds = [lanes[1].currentId];
  } else if (outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP || outerAction === "reenter_reviewer_loop") {
    focusIds = [lanes[2].currentId];
  } else {
    // Default: focus only on the copilot layer current state as the primary active state,
    // falling back to all lanes if copilot is unavailable.
    const copilotFocusId = lanes[1].currentId;
    const copilotAvailable = !copilotFocusId.includes("unavailable");
    focusIds = copilotAvailable ? [copilotFocusId] : lanes.map((lane) => lane.currentId);
  }

  return {
    definition: lines.join("\n"),
    focusIds,
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
        const clampScale = (value) => Math.max(0.5, Math.min(5, value));
        const updateFrameScale = (frame, requestedScale) => {
          const scale = clampScale(requestedScale);
          frame.dataset.graphScale = String(scale);
          const zoomValue = frame.querySelector("[data-graph-zoom-value]");
          if (zoomValue) {
            zoomValue.textContent = String(Math.round(scale * 100)) + "%";
          }
          const graphViewport = frame.querySelector(".mermaid-state-graph");
          const svg = graphViewport ? graphViewport.querySelector("svg") : null;
          if (svg && graphViewport) {
            // Use a wrapper div for scrollable dimensions because SVG width
            // changes don't reliably expand scrollWidth in WebKit.  The wrapper
            // is a plain div whose pixel size WebKit always respects.
            let wrapper = graphViewport.querySelector(":scope > .mermaid-zoom-inner");
            if (!wrapper) {
              const svgRect = svg.getBoundingClientRect();
              wrapper = document.createElement("div");
              wrapper.className = "mermaid-zoom-inner";
              wrapper.style.transformOrigin = "0 0";
              graphViewport.insertBefore(wrapper, svg);
              wrapper.appendChild(svg);
              svg.style.display = "block";
              svg.style.maxWidth = "none";
              if (svgRect.width > 0) {
                frame.dataset.graphNaturalWidth = String(svgRect.width);
                svg.style.width = svgRect.width + "px";
              }
              if (svgRect.height > 0) {
                frame.dataset.graphNaturalHeight = String(svgRect.height);
                svg.style.height = svgRect.height + "px";
              }
            }
            const naturalWidth = Number(frame.dataset.graphNaturalWidth) || graphViewport.getBoundingClientRect().width;
            const naturalHeight = Number(frame.dataset.graphNaturalHeight) || 256;
            wrapper.style.width = Math.round(naturalWidth * scale) + "px";
            wrapper.style.height = Math.round(naturalHeight * scale) + "px";
            svg.style.transform = "scale(" + scale + ")";
            svg.style.transformOrigin = "0 0";
            void graphViewport.offsetWidth;
          }
          return scale;
        };
        const settleGraphViewport = (delayMs = 180) => new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) {
              return;
            }
            done = true;
            resolve();
          };
          requestAnimationFrame(() => {
            requestAnimationFrame(finish);
          });
          window.setTimeout(finish, delayMs);
        });
        const zoomGraphViewport = (frame, graphViewport, requestedScale, focusPoint = null) => {
          const previousScale = Number(frame.dataset.graphScale || 1);
          const nextScale = updateFrameScale(frame, requestedScale);
          // Force a synchronous reflow so the new SVG width is fully applied
          // before we read scrollWidth or set scrollLeft. Without this the
          // browser may not have expanded the content yet.
          void frame.offsetWidth;
          if (!focusPoint) {
            return settleGraphViewport();
          }
          const scaleRatio = nextScale / previousScale;
          return new Promise((resolve) => {
            requestAnimationFrame(() => {
              const newScrollLeft = (focusPoint.contentX * scaleRatio) - focusPoint.viewportX;
              const newScrollTop = (focusPoint.contentY * scaleRatio) - focusPoint.viewportY;
              graphViewport.scrollLeft = newScrollLeft;
              graphViewport.scrollTop = newScrollTop;
              settleGraphViewport().then(resolve);
            });
          });
        };
        const fitGraphToCurrentState = (frame, graphViewport) => {
          return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const svg = graphViewport.querySelector("svg");
              if (!svg) {
                resolve(false);
                return;
              }
              const focusIds = (graphViewport.dataset.graphFocusIds ?? "")
                .split(",").map((id) => id.trim()).filter(Boolean);
              const allNodes = Array.from(svg.querySelectorAll(".node"));
              const focusNodes = focusIds.length === 0
                ? []
                : allNodes.filter((node) => focusIds.some((focusId) => node.id.includes(focusId)));
              const targetNodes = focusNodes.length > 0
                ? focusNodes
                : Array.from(svg.querySelectorAll(".node.current, .node.currentTerminal, .node.unavailable"));
              const viewportRect = graphViewport.getBoundingClientRect();
              const targetRects = targetNodes
                .map((node) => {
                  const r = node.getBoundingClientRect();
                  return r;
                })
                .filter((rect) => rect.width > 0 && rect.height > 0);
              if (targetRects.length === 0) {
                resolve(false);
                return;
              }
              const [firstRect, ...remainingRects] = targetRects;
              const unionRect = remainingRects.reduce((combined, rect) => ({
                left: Math.min(combined.left, rect.left),
                top: Math.min(combined.top, rect.top),
                right: Math.max(combined.right, rect.right),
                bottom: Math.max(combined.bottom, rect.bottom),
              }), { left: firstRect.left, top: firstRect.top, right: firstRect.right, bottom: firstRect.bottom });
              const unionWidth = unionRect.right - unionRect.left;
              const unionHeight = unionRect.bottom - unionRect.top;
              const targetScale = 3;
              const contentCenterX = graphViewport.scrollLeft + ((unionRect.left - viewportRect.left) + (unionWidth / 2));
              const contentCenterY = graphViewport.scrollTop + ((unionRect.top - viewportRect.top) + (unionHeight / 2));
              zoomGraphViewport(frame, graphViewport, targetScale, {
                viewportX: viewportRect.width / 2,
                viewportY: viewportRect.height / 2,
                contentX: contentCenterX,
                contentY: contentCenterY,
              }).then(() => {
                resolve(true);
              });
            }));
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

        window.mermaid.run({ nodes: graphs }).then(async () => {
          await Promise.all(graphs.map(async (graph) => {
            graph.dataset.rendered = "settling";
            const frame = graph.closest(".state-graph-frame");
            if (!frame) {
              graph.dataset.rendered = "true";
              return;
            }
            updateFrameScale(frame, Number(frame.dataset.graphScale || 1));
            const graphViewport = frame.querySelector(".mermaid-state-graph");
            if (graphViewport) {
              const focused = await fitGraphToCurrentState(frame, graphViewport);
              if (!focused) {
                await settleGraphViewport();
              }
            } else {
              await settleGraphViewport();
            }
            graph.dataset.rendered = "true";
          }));
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
      <div class="mermaid-state-graph mermaid" data-rendered="pending" data-graph-focus-ids="${escapeHtml((graph.focusIds ?? []).join(","))}" aria-label="Mermaid inspection state graph">${escapeHtml(graph.definition)}</div>
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
      headline: "Clean reviews present; gate evidence still required",
      detail: "The current head has both a clean submitted Copilot review and an approved human review, but approval or merge suggestions still require explicit current-head pre_approval_gate evidence.",
      nextAction: "Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation.",
    };
  }

  if (copilotState === "ready_to_rerequest_review" && (sameHeadCleanConverged || copilotLoopDisposition === "clean_converged" || copilotTerminal)) {
    return {
      headline: "Copilot pass complete; gate evidence still required",
      detail: "The current head already has a clean submitted Copilot review with no unresolved feedback, but that alone is not enough for an approval or merge suggestion.",
      nextAction: "Confirm or rerun the current-head pre_approval_gate before any approval or merge recommendation, or wait for a meaningful remediation event before requesting another Copilot pass.",
    };
  }

  if (copilotState === "ready_to_rerequest_review") {
    return {
      headline: "Ready to re-request Copilot review",
      detail: "The current head looks clean enough for another Copilot pass or final confirmation.",
      nextAction: "Re-request Copilot review only after the smallest honest local validation is green, or confirm the PR is done.",
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

  if (copilotState === "waiting_for_ci") {
    return {
      headline: "Waiting for CI",
      detail: "The current head has progressed past review but is still waiting on CI readiness.",
      nextAction: "Wait for CI to complete or become available.",
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

function buildPullRequestHref(target) {
  if (!target?.repo || target?.pr === null || target?.pr === undefined) {
    return null;
  }
  return `https://github.com/${encodeURIComponent(target.repo).replaceAll("%2F", "/")}/pull/${encodeURIComponent(String(target.pr))}`;
}

function summarizeCurrentPrMode(snapshot) {
  if (!snapshot) {
    return null;
  }

  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);
  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");

  if (deriveInboxSignalFromSnapshot(snapshot) === "ready") {
    return { emoji: "✅", label: "Approved" };
  }

  if (copilotState === "waiting_for_copilot_review"
    || copilotState === "waiting_for_ci"
    || reviewerState === "waiting_for_author_followup"
    || reviewerState === "waiting_for_re_request"
    || outerState === OUTER_STATE.CONTINUE_CURRENT_WAIT
    || outerState === OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER
    || outerAction === "continue_wait") {
    return { emoji: "⏳", label: "Waiting state" };
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP
    || outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP
    || outerAction === "reenter_copilot_loop"
    || outerAction === "reenter_reviewer_loop"
    || reviewerState === "review_requested"
    || reviewerState === "determine_review_plan"
    || reviewerState === "reviews_running"
    || reviewerState === "merge_results"
    || reviewerState === "draft_review_ready"
    || reviewerState === "draft_review_posted"
    || reviewerState === "waiting_for_user_submit"
    || reviewerState === "submitted_review"
    || reviewerState === "review_invalidated") {
    return { emoji: "🔁", label: "Active loop" };
  }

  return null;
}

function renderCurrentStateBanner(snapshot, target, stateLabel, graph, selectedTitle = null) {
  const summary = summarizeCurrentPrStatus(snapshot);
  const pullRequestHref = buildPullRequestHref(target);
  const mode = summarizeCurrentPrMode(snapshot);
  const heading = typeof selectedTitle === "string" && selectedTitle.trim().length > 0
    ? selectedTitle.trim()
    : `PR #${target.pr}`;
  return `<section class="current-pr-state-banner" aria-label="PR #${escapeHtml(target.pr)}">
    <div class="current-pr-state-heading-row">
      <div class="current-pr-state-heading-copy">
        <p class="current-pr-state-kicker">${pullRequestHref
          ? `<a href="${escapeHtml(pullRequestHref)}">PR #${escapeHtml(target.pr)}</a>`
          : `PR #${escapeHtml(target.pr)}`}</p>
        <h1>${escapeHtml(heading)}</h1>
      </div>
      ${mode ? `<span class="current-pr-state-mode-indicator" title="${escapeHtml(mode.label)}" aria-label="${escapeHtml(mode.label)}">${escapeHtml(mode.emoji)}</span>` : ""}
    </div>
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

export function renderTargetKey(target) {
  if (!target || target.pr === null || target.pr === undefined) {
    return "";
  }
  const normalizedRepo = tryNormalizeRepoSlug(target.repo);
  if (normalizedRepo === null) {
    return "";
  }
  return `${normalizedRepo}#${target.pr}`;
}

function formatInboxUpdatedAt(updatedAt) {
  if (typeof updatedAt !== "string" || updatedAt.trim().length === 0) {
    return "updated unknown";
  }
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return `updated ${updatedAt.trim()}`;
  }
  return `updated ${new Date(parsed).toISOString().slice(0, 10)}`;
}

export function deriveInboxSignalFromSnapshot(snapshot) {
  if (!snapshot) {
    return "unknown";
  }

  const outerState = formatStateToken(snapshot.outerState, "unknown");
  const outerAction = formatStateToken(snapshot.outerAction, "unknown");
  const statusClass = formatStateToken(snapshot.statusClass, "unknown");
  const copilotState = formatStateToken(snapshot.layers?.copilot?.currentState);
  const reviewerApprovedOnCurrentHead = snapshot.layers?.reviewer?.approvedOnCurrentHead === true;
  const sameHeadCleanConverged = snapshot.layers?.copilot?.sameHeadCleanConverged === true;
  const copilotLoopDisposition = formatStateToken(snapshot.layers?.copilot?.loopDisposition);
  const copilotTerminal = snapshot.layers?.copilot?.terminal === true;

  const reviewerState = formatStateToken(snapshot.layers?.reviewer?.currentState);

  if (snapshot.needsAttention === true
    || outerState === OUTER_STATE.NEEDS_RECONCILE
    || outerState === OUTER_STATE.STOP_NEEDS_HUMAN
    || outerAction === "stop"
    || statusClass === "blocked"
    || copilotState === "unresolved_feedback_present"
    || copilotState === "already_fixed_needs_reply_resolve") {
    return "attention";
  }

  // Layer states that represent genuine waiting take priority over outer routing signals
  // (e.g. waiting_for_copilot_review beats handoff_to_reviewer_loop so sidebar and banner agree).
  if (copilotState === "waiting_for_copilot_review"
    || reviewerState === "waiting_for_author_followup"
    || reviewerState === "waiting_for_re_request") {
    return "waiting";
  }

  if (outerState === OUTER_STATE.HANDOFF_TO_COPILOT_LOOP
    || outerState === OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP
    || outerAction === "reenter_copilot_loop"
    || outerAction === "reenter_reviewer_loop") {
    return "attention";
  }

  if (copilotState === "waiting_for_ci") {
    return "pending";
  }

  if (outerState === OUTER_STATE.DONE_TERMINAL || statusClass === "done") {
    return "ready";
  }

  if ((copilotState === "ready_to_rerequest_review" && reviewerApprovedOnCurrentHead)
    || sameHeadCleanConverged
    || copilotLoopDisposition === "clean_converged"
    || copilotTerminal) {
    return "pending";
  }

  if (snapshot.sourceMode === "unavailable") {
    return "unknown";
  }

  return "waiting";
}

const VALID_INBOX_SIGNALS = new Set(["attention", "pending", "ready", "closed", "unknown", "waiting"]);

function inboxSignalEmoji(signal) {
  switch (signal) {
    case "ready": return "✅";
    case "attention": return "🔴";
    case "waiting": return "⏳";
    case "pending": return "🔄";
    case "closed": return "✖️";
    default: return "❓";
  }
}

export function normalizeInboxSignal(signal, fallback = "unknown") {
  const normalized = typeof signal === "string" ? signal.trim().toLowerCase() : "";
  return VALID_INBOX_SIGNALS.has(normalized) ? normalized : fallback;
}

function describeInboxSignal(signal) {
  switch (signal) {
    case "attention":
      return { label: "Needs attention", shortLabel: "Attention" };
    case "pending":
      return { label: "CI pending", shortLabel: "CI" };
    case "ready":
      return { label: "Ready", shortLabel: "Ready" };
    case "closed":
      return { label: "Closed", shortLabel: "Closed" };
    case "unknown":
      return { label: "State unavailable", shortLabel: "Unknown" };
    case "waiting":
    default:
      return { label: "Waiting", shortLabel: "Waiting" };
  }
}

function summarizeInboxRow(snapshot, fallbackSignal = "unknown") {
  const normalizedFallbackSignal = normalizeInboxSignal(fallbackSignal);
  const signal = normalizedFallbackSignal === "closed"
    ? "closed"
    : snapshot
      ? deriveInboxSignalFromSnapshot(snapshot)
      : normalizedFallbackSignal;
  if (!snapshot) {
    return {
      signal,
      signalLabel: describeInboxSignal(signal),
      statusClass: null,
      trustLabel: null,
      needsAttention: signal === "attention",
      headline: null,
    };
  }

  return {
    signal,
    signalLabel: describeInboxSignal(signal),
    statusClass: formatStateToken(snapshot.statusClass, "unknown"),
    trustLabel: renderSnapshotStateLabel(snapshot),
    needsAttention: snapshot.needsAttention === true,
    headline: summarizeCurrentPrStatus(snapshot).headline,
  };
}

function appendInboxViewParams(params, {
  selectedTarget = null,
  scopeFilter = null,
  updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS,
  state = DEFAULT_INBOX_PR_STATE,
  mode = DEFAULT_INBOX_MODE,
  page = DEFAULT_INBOX_PAGE,
} = {}) {
  if (typeof scopeFilter === "string" && scopeFilter.trim().length > 0) {
    params.set("scope", scopeFilter.trim());
  }
  if (selectedTarget?.repo !== undefined && selectedTarget?.repo !== null) {
    params.set("repo", String(selectedTarget.repo));
  }
  if (selectedTarget?.pr !== undefined && selectedTarget?.pr !== null) {
    params.set("pr", String(selectedTarget.pr));
  }
  if (updatedWithinDays === null) {
    params.set("updated", "all");
  } else if (updatedWithinDays !== DEFAULT_INBOX_UPDATED_WITHIN_DAYS) {
    params.set("updated", String(updatedWithinDays));
  }
  if (page > DEFAULT_INBOX_PAGE) {
    params.set("page", String(page));
  }
  params.set("state", state);
  params.set("mode", mode);
}

function buildInboxHref(target, { scopeFilter = null, updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE, page = DEFAULT_INBOX_PAGE } = {}) {
  const params = new URLSearchParams();
  appendInboxViewParams(params, { selectedTarget: target, scopeFilter, updatedWithinDays, state, mode, page });
  return `/?${params.toString()}`;
}

function buildSnapshotHref(target, scopeFilter = null) {
  if (!target) {
    return null;
  }
  const params = new URLSearchParams();
  appendInboxViewParams(params, { selectedTarget: target, scopeFilter, updatedWithinDays: DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state: DEFAULT_INBOX_PR_STATE, mode: DEFAULT_INBOX_MODE, page: DEFAULT_INBOX_PAGE });
  params.delete("scope");
  params.delete("updated");
  params.delete("limit");
  params.delete("state");
  params.delete("mode");
  return `/snapshot.json?${params.toString()}`;
}

function renderInboxFilterHref(selectedTarget, { scopeFilter = null, updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE, page = DEFAULT_INBOX_PAGE } = {}) {
  const params = new URLSearchParams();
  appendInboxViewParams(params, { selectedTarget, scopeFilter, updatedWithinDays, state, mode, page });
  const query = params.toString();
  return query.length === 0 ? "/" : `/?${query}`;
}

function renderScopeSelectHref(selectedTarget, scopeFilter, { updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE } = {}) {
  const retainedTarget = selectedTarget && (scopeFilter === null || repoSlugEquals(selectedTarget.repo, scopeFilter))
    ? selectedTarget
    : null;
  return renderInboxFilterHref(retainedTarget, { scopeFilter, updatedWithinDays, state, mode, page: DEFAULT_INBOX_PAGE });
}

function renderInboxPageHref(selectedTarget, { scopeFilter = null, updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE, page = DEFAULT_INBOX_PAGE } = {}) {
  return renderInboxFilterHref(selectedTarget, { scopeFilter, updatedWithinDays, state, mode, page });
}

function renderInboxPagination({ selectedTarget = null, scopeFilter = null, updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE, page = DEFAULT_INBOX_PAGE, totalPages = 1 } = {}) {
  if (totalPages <= 1) {
    return "";
  }

  const previousPage = Math.max(DEFAULT_INBOX_PAGE, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return `<nav class="assigned-pr-pagination" aria-label="Sidebar pagination">
    <a class="assigned-pr-page-link ${page <= DEFAULT_INBOX_PAGE ? "is-disabled" : ""}" href="${escapeHtml(renderInboxPageHref(selectedTarget, { scopeFilter, updatedWithinDays, state, mode, page: previousPage }))}" aria-label="Previous page" ${page <= DEFAULT_INBOX_PAGE ? 'aria-disabled="true" tabindex="-1"' : ""}>←</a>
    <span class="assigned-pr-page-status">${escapeHtml(String(page))}/${escapeHtml(String(totalPages))}</span>
    <a class="assigned-pr-page-link ${page >= totalPages ? "is-disabled" : ""}" href="${escapeHtml(renderInboxPageHref(selectedTarget, { scopeFilter, updatedWithinDays, state, mode, page: nextPage }))}" aria-label="Next page" ${page >= totalPages ? 'aria-disabled="true" tabindex="-1"' : ""}>→</a>
  </nav>`;
}

function renderInboxSidebar(items, selectedTarget, { scopeFilter = null, scopeOptions = [], updatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS, state = DEFAULT_INBOX_PR_STATE, mode = DEFAULT_INBOX_MODE, page = DEFAULT_INBOX_PAGE, totalPages = 1 } = {}) {
  const selectedKey = renderTargetKey(selectedTarget);
  const uniqueScopeOptions = ["All repos", ...dedupeRepoSlugOptions(scopeOptions)].sort((left, right) => {
    if (left === "All repos") {
      return -1;
    }
    if (right === "All repos") {
      return 1;
    }
    return left.localeCompare(right);
  });
  return `<aside class="assigned-pr-inbox" data-sidebar-collapsed="false">
    <div class="assigned-pr-inbox-header">
      <h2>PR inbox</h2>
      <button type="button" class="inbox-collapse-toggle" data-inbox-toggle aria-expanded="true" aria-label="Collapse sidebar" title="Collapse sidebar">◀</button>
    </div>
    <div class="assigned-pr-controls">
      <div class="assigned-pr-control-row assigned-pr-scope-row">
        <label class="assigned-pr-filter-label" for="assigned-pr-scope-select">Scope</label>
        <select id="assigned-pr-scope-select" class="assigned-pr-select" data-nav-select>
          ${uniqueScopeOptions.map((option) => {
    const optionScope = option === "All repos" ? null : option;
    const selected = optionScope === null ? scopeFilter === null : repoSlugEquals(optionScope, scopeFilter);
    return `<option value="${escapeHtml(renderScopeSelectHref(selectedTarget, optionScope, { updatedWithinDays, state, mode }))}" ${selected ? "selected" : ""}>${escapeHtml(option)}</option>`;
  }).join("")}
        </select>
      </div>
      <div class="assigned-pr-control-row assigned-pr-secondary-controls">
        <label class="assigned-pr-filter-label" for="assigned-pr-state-select">State</label>
        <select id="assigned-pr-mode-select" class="assigned-pr-select assigned-pr-select-mid" data-nav-select aria-label="Assignment mode">
          ${INBOX_MODE_FILTER_PRESETS.map((preset) => {
    const selected = preset.value === mode;
    return `<option value="${escapeHtml(renderInboxFilterHref(selectedTarget, { scopeFilter, updatedWithinDays, state, mode: preset.value, page: DEFAULT_INBOX_PAGE }))}" ${selected ? "selected" : ""}>${escapeHtml(preset.label)}</option>`;
  }).join("")}
        </select>
        <select id="assigned-pr-state-select" class="assigned-pr-select assigned-pr-select-mid" data-nav-select>
          ${INBOX_STATE_FILTER_PRESETS.map((preset) => {
    const selected = preset.value === state;
    return `<option value="${escapeHtml(renderInboxFilterHref(selectedTarget, { scopeFilter, updatedWithinDays, state: preset.value, mode, page: DEFAULT_INBOX_PAGE }))}" ${selected ? "selected" : ""}>${escapeHtml(preset.label)}</option>`;
  }).join("")}
        </select>
        <select id="assigned-pr-updated-select" class="assigned-pr-select assigned-pr-select-sm assigned-pr-select-updated" data-nav-select aria-label="Updated window">
          ${INBOX_UPDATED_FILTER_PRESETS.map((preset) => {
    const selected = preset.value === updatedWithinDays;
    return `<option value="${escapeHtml(renderInboxFilterHref(selectedTarget, { scopeFilter, updatedWithinDays: preset.value, state, mode, page: DEFAULT_INBOX_PAGE }))}" ${selected ? "selected" : ""}>${escapeHtml(preset.label)}</option>`;
  }).join("")}
        </select>
      </div>
    </div>
    <label class="inbox-search-label" for="inbox-search">Search PRs</label>
    <input id="inbox-search" class="inbox-search-input" type="search" placeholder="Search PR # or title…" data-inbox-search />
    <ul class="assigned-pr-list" data-inbox-list>
      ${items.map((item) => {
    const summary = summarizeInboxRow(item.snapshot ?? null, item.signal ?? "unknown");
    const target = item.target;
    const key = renderTargetKey(target);
    const selected = key === selectedKey;
    const searchText = `${target.repo} #${target.pr} ${item.title ?? ""} ${summary.signalLabel.label} ${summary.statusClass ?? ""} ${summary.trustLabel ?? ""} ${summary.headline ?? ""} ${item.updatedAt ?? ""}`.toLowerCase();
    return `<li class="assigned-pr-row assigned-pr-row-${escapeHtml(summary.signal)} ${selected ? "is-selected" : ""}" data-inbox-item data-inbox-signal="${escapeHtml(summary.signal)}" data-search="${escapeHtml(searchText)}">
          <a class="assigned-pr-link" href="${escapeHtml(buildInboxHref(target, { scopeFilter, updatedWithinDays, state, mode, page }))}" ${selected ? 'aria-current="page"' : ""}>
            <div class="assigned-pr-line assigned-pr-title-line">
              <span class="assigned-pr-id-col">
                <span class="assigned-pr-id">#${escapeHtml(String(target.pr))}</span>
                <span class="assigned-pr-signal-emoji" aria-label="${escapeHtml(summary.signalLabel.label)}">${inboxSignalEmoji(summary.signal)}</span>
              </span>
              <span class="assigned-pr-title">${escapeHtml(item.title ?? "Untitled pull request")}</span>
            </div>
            <div class="assigned-pr-line assigned-pr-meta assigned-pr-meta-primary">
              ${scopeFilter === null ? `<span class="assigned-pr-repo">${escapeHtml(target.repo)}</span>` : ""}
              <span class="assigned-pr-updated">${escapeHtml(formatInboxUpdatedAt(item.updatedAt))}</span>
            </div>
            <div class="assigned-pr-line assigned-pr-meta assigned-pr-meta-secondary">
              ${summary.statusClass ? `<span class="assigned-pr-status">${escapeHtml(summary.statusClass)}</span>` : ""}
              ${summary.trustLabel ? `<span class="assigned-pr-trust">${escapeHtml(summary.trustLabel)}</span>` : ""}
              ${summary.headline ? `<span class="assigned-pr-headline">${escapeHtml(summary.headline)}</span>` : ""}
            </div>
          </a>
        </li>`;
  }).join("")}
    </ul>
    <p class="assigned-pr-empty" data-inbox-empty data-empty-default="No assigned PRs are visible in this view." data-empty-search="No assigned PRs match this search." hidden>No assigned PRs are visible in this view.</p>
    ${renderInboxPagination({ selectedTarget, scopeFilter, updatedWithinDays, state, mode, page, totalPages })}
  </aside>`;
}

function renderInboxShellScript() {
  return `<script>
    (() => {
      const sidebar = document.querySelector(".assigned-pr-inbox");
      const toggle = document.querySelector("[data-inbox-toggle]");
      const search = document.querySelector("[data-inbox-search]");
      const navSelects = Array.from(document.querySelectorAll("[data-nav-select]"));
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
          const defaultMessage = empty.dataset.emptyDefault ?? "No assigned PRs are visible in this view.";
          const searchMessage = empty.dataset.emptySearch ?? "No assigned PRs match this search.";
          empty.textContent = query.length === 0 ? defaultMessage : searchMessage;
          empty.hidden = visibleCount !== 0;
        }
      };
      toggle?.addEventListener("click", () => {
        const collapsed = sidebar?.dataset.sidebarCollapsed === "true";
        if (!sidebar) {
          return;
        }
        sidebar.dataset.sidebarCollapsed = collapsed ? "false" : "true";
        toggle.textContent = collapsed ? "◀" : "▶";
        toggle.setAttribute("aria-label", collapsed ? "Collapse sidebar" : "Expand sidebar");
        toggle.setAttribute("title", collapsed ? "Collapse sidebar" : "Expand sidebar");
        toggle.setAttribute("aria-expanded", collapsed ? "true" : "false");
      });
      search?.addEventListener("input", updateFilter);
      navSelects.forEach((select) => {
        select.addEventListener("change", () => {
          const href = select.value;
          if (typeof href === "string" && href.length > 0) {
            window.location.assign(href);
          }
        });
      });
      updateFilter();
    })();
  </script>`;
}

export function renderInspectRunViewerHtml({
  repo = null,
  target = null,
  snapshot = null,
  error = null,
  inboxItems = [],
  selectedTitle = null,
  scopeOptions = [],
  inboxUpdatedWithinDays = DEFAULT_INBOX_UPDATED_WITHIN_DAYS,
  inboxState = DEFAULT_INBOX_PR_STATE,
  inboxMode = DEFAULT_INBOX_MODE,
  inboxPage = DEFAULT_INBOX_PAGE,
  inboxTotalPages = 1,
}) {
  const normalizedSnapshot = snapshot ?? null;
  const graph = target ? buildInspectionMermaidGraph(normalizedSnapshot) : null;
  const stateLabel = renderSnapshotStateLabel(normalizedSnapshot);
  const selectedInboxItem = target === null
    ? null
    : inboxItems.find((item) => renderTargetKey(item.target) === renderTargetKey(target)) ?? null;
  const effectiveSelectedTitle = selectedTitle ?? selectedInboxItem?.title ?? null;
  const scopeFilter = typeof repo === "string" && repo.length > 0 ? repo : null;
  const scopeLabel = scopeFilter ?? "all repos";
  const title = target
    ? `${target.repo}#${target.pr} inspection snapshot`
    : `${scopeLabel} PR inbox`;
  const runId = normalizedSnapshot?.runId ?? "not present";
  const rawSnapshotHref = buildSnapshotHref(target, scopeFilter);
  const topSummary = target === null
    ? `<section>
      <h2>No PR selected</h2>
      <p>No assigned PR in ${escapeHtml(scopeLabel)} matched the current view yet.</p>
      <p>Pick a PR from the sidebar, widen the state or updated filters, or move to another inbox page.</p>
    </section>`
    : normalizedSnapshot === null
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
      .assigned-pr-inbox { position: sticky; top: 1rem; width: 22rem; max-width: 100%; border: 1px solid #d9e5f2; border-radius: 0.65rem; padding: 0.65rem; background: #fbfdff; max-height: calc(100vh - 2rem); overflow: auto; box-sizing: border-box; }
      .assigned-pr-inbox[data-sidebar-collapsed="true"] { width: 2.15rem; overflow: hidden; padding: 0.22rem; border-color: transparent; background: transparent; box-shadow: none; }
      .assigned-pr-inbox[data-sidebar-collapsed="true"] h2,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-controls,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-filter-note,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .inbox-search-label,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .inbox-search-input,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-list,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-empty,
      .assigned-pr-inbox[data-sidebar-collapsed="true"] .assigned-pr-pagination { display: none; }
      .assigned-pr-inbox-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.45rem; }
      .assigned-pr-inbox-header h2 { margin: 0; font-size: 0.98rem; flex: 1; }
      .assigned-pr-controls { display: flex; flex-wrap: wrap; gap: 0.32rem 0.45rem; margin-bottom: 0.35rem; align-items: center; }
      .assigned-pr-control-row { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
      .assigned-pr-scope-row { align-items: center; }
      .assigned-pr-secondary-controls { flex: 999 1 18rem; flex-wrap: nowrap; }
      .assigned-pr-filter-label { display: inline-block; min-width: 3.6rem; margin: 0; font-size: 0.74rem; font-weight: 700; color: #355061; text-transform: uppercase; letter-spacing: 0.03em; }
      .assigned-pr-select { flex: 1; min-width: 0; max-width: 100%; border: 1px solid #bfd0e2; border-radius: 0.42rem; padding: 0.22rem 0.4rem; font: inherit; font-size: 0.8rem; color: #355061; background: #fff; }
      .assigned-pr-select-mid { flex: 0 1 auto; width: min(7.25rem, 100%); max-width: 7.25rem; min-width: 5.2rem; }
      .assigned-pr-select-sm { flex: 0 1 auto; width: min(4.8rem, 100%); max-width: 4.8rem; min-width: 3.6rem; }
      .assigned-pr-select-updated { margin-left: auto; }
      .inbox-collapse-toggle { border: none; outline: none; box-shadow: none; appearance: none; -webkit-appearance: none; background: #355061; color: #fff; border-radius: 0.4rem; padding: 0.12rem 0.22rem; cursor: pointer; font-size: 1rem; line-height: 1; }
      .inbox-search-label { display: block; font-size: 0.82rem; font-weight: 600; color: #355061; margin-bottom: 0.18rem; margin-top: 0.1rem; }
      .inbox-search-input { width: 100%; border: 1px solid #bfd0e2; border-radius: 0.4rem; padding: 0.28rem 0.42rem; margin-bottom: 0.45rem; }
      .assigned-pr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.36rem; }
      .assigned-pr-row { border: 1px solid #d6e0ea; border-left: 0.32rem solid #8ca3b8; border-radius: 0.5rem; background: #fff; }
      .assigned-pr-row.assigned-pr-row-attention { border-left-color: #c87400; }
      .assigned-pr-row.assigned-pr-row-pending { border-left-color: #b88900; }
      .assigned-pr-row.assigned-pr-row-ready { border-left-color: #2e7d32; }
      .assigned-pr-row.assigned-pr-row-closed { border-left-color: #7a8694; }
      .assigned-pr-row.assigned-pr-row-unknown { border-left-color: #8ca3b8; }
      .assigned-pr-row.assigned-pr-row-waiting { border-left-color: #1565c0; }
      .assigned-pr-link { display: block; padding: 0.38rem 0.45rem; color: inherit; text-decoration: none; }
      .assigned-pr-row.is-selected .assigned-pr-link { box-shadow: inset 0 0 0 1px #1565c0; border-radius: 0.3rem; }
      .assigned-pr-title-line { display: flex; align-items: flex-start; gap: 0.35rem; }
      .assigned-pr-id-col { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; min-width: 2.4rem; margin-right: 0.15rem; }
      .assigned-pr-id { font-weight: 700; }
      .assigned-pr-signal-emoji { font-size: 0.65rem; line-height: 1.2; }
      .assigned-pr-title { font-weight: 600; min-width: 0; flex: 1 1 auto; }
      .assigned-pr-line + .assigned-pr-line { margin-top: 0.18rem; }
      .assigned-pr-meta { display: flex; flex-wrap: wrap; gap: 0.22rem 0.36rem; font-size: 0.76rem; color: #486174; }
      .assigned-pr-meta-primary { justify-content: space-between; align-items: baseline; gap: 0.5rem; }
      .assigned-pr-meta-primary .assigned-pr-repo { text-align: left; min-width: 0; }
      .assigned-pr-meta-primary .assigned-pr-updated { margin-left: auto; text-align: right; white-space: nowrap; }
      .assigned-pr-pagination { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin-top: 0.45rem; }
      .assigned-pr-page-link { color: #5b2ca0; text-decoration: none; font-weight: 700; }
      .assigned-pr-page-link.is-disabled { color: #9aa9b8; pointer-events: none; }
      .assigned-pr-page-status { font-weight: 700; color: #253b53; }
      .inspection-main { min-width: 0; }
      .badge { display: inline-block; padding: 0.25rem 0.5rem; border: 1px solid #666; border-radius: 0.25rem; font-weight: 600; }
      .current-pr-state-banner { border: none; background: none; box-shadow: none; padding: 0; margin-top: 0; }
      .current-pr-state-heading-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
      .current-pr-state-heading-copy { min-width: 0; }
      .current-pr-state-kicker { margin: 0 0 0.28rem 0; font-size: 0.96rem; font-weight: 700; }
      .current-pr-state-kicker a { color: #355061; text-decoration: none; }
      .current-pr-state-kicker a:hover { text-decoration: underline; }
      .current-pr-state-mode-indicator { flex: 0 0 auto; font-size: 1.55rem; line-height: 1; margin-top: 0.08rem; }
      .current-pr-state-banner h1 { margin: 0 0 0.5rem 0; font-size: 2.2rem; line-height: 1.15; }
      .current-pr-state-summary-headline { margin: 0 0 0.4rem 0; color: #1565c0; font-weight: 700; font-size: 1.1rem; }
      .current-pr-state-detail { margin: 0.25rem 0 0.8rem 0; color: #274766; font-size: 0.98rem; }
      .current-pr-state-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); background: none; padding: 0; border-radius: 0; margin-bottom: 1rem; }
      .current-pr-state-grid dt { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: #4c6478; }
      .current-pr-state-grid dd { margin: 0 0 0.75rem 0; }
      .state-graph-block { margin-top: 0.4rem; }
      .state-graph-frame { margin-top: 0.5rem; border: 1px solid #d7e3f4; border-radius: 0.75rem; background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%); }
      .state-graph-toolbar { display: flex; align-items: center; gap: 0.4rem; padding: 0.55rem 0.65rem; border-bottom: 1px solid #d7e3f4; background: rgba(255,255,255,0.85); }
      .state-graph-toolbar button { border: 1px solid #9fb6cb; background: #fff; border-radius: 0.45rem; padding: 0.3rem 0.6rem; font: inherit; cursor: pointer; }
      .state-graph-toolbar button:hover { background: #f3f8fd; }
      .state-graph-zoom-value { margin-left: auto; font-size: 0.88rem; color: #486174; }
      .mermaid-state-graph { min-height: 16rem; padding: 0.75rem; overflow: auto; cursor: grab; user-select: none; touch-action: none; }
      .mermaid-state-graph[data-dragging="true"] { cursor: grabbing; }
      .mermaid-state-graph[data-rendered="pending"] { color: #5a7184; opacity: 0; pointer-events: none; }
      .mermaid-state-graph[data-rendered="settling"] { opacity: 0; pointer-events: none; }
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
        .assigned-pr-secondary-controls { flex-wrap: wrap; }
        .assigned-pr-select-mid,
        .assigned-pr-select-sm,
        .assigned-pr-select-updated { width: 100%; max-width: none; margin-left: 0; flex: 1 1 6rem; }
      }
    </style>
  </head>
  <body>
    <div class="inspection-shell">
      ${renderInboxSidebar(inboxItems, target, { scopeFilter, scopeOptions, updatedWithinDays: inboxUpdatedWithinDays, state: inboxState, mode: inboxMode, page: inboxPage, totalPages: inboxTotalPages })}
      <main class="inspection-main">
        ${target === null
          ? `<section class="current-pr-state-banner" aria-label="${escapeHtml(scopeLabel)} inbox state">
              <h1>${escapeHtml(scopeLabel)} PR inbox</h1>
              <p class="current-pr-state-summary-headline">Choose a PR from the sidebar</p>
              <p class="current-pr-state-detail">This viewer can span all assigned repos or be narrowed to one repo. The sidebar defaults to open PRs from the last 7 days and paginates through the result set.</p>
            </section>`
          : renderCurrentStateBanner(normalizedSnapshot, target, stateLabel, graph, effectiveSelectedTitle)}
        ${renderCollapsedDetailsPanel(`
      <p><strong>Snapshot state:</strong> <span class="badge">${escapeHtml(stateLabel)}</span> <button type="button" onclick="window.location.reload()" title="Reload snapshot" aria-label="Reload snapshot">🔄</button></p>
      <p><strong>Refresh:</strong> manual reload only.${rawSnapshotHref ? ` <strong>Raw snapshot:</strong> <a href="${escapeHtml(rawSnapshotHref)}"><code>${escapeHtml(rawSnapshotHref)}</code></a>` : ""}</p>
      ${topSummary}
      ${target === null ? "" : renderOuterLoopSummarySection(normalizedSnapshot)}
      ${target === null ? "" : renderCopilotLoopIterationsSection(normalizedSnapshot)}
      ${target === null ? "" : renderCopilotLayerSection(normalizedSnapshot?.layers?.copilot)}
      ${target === null ? "" : renderReviewerLayerSection(normalizedSnapshot?.layers?.reviewer)}
      ${target === null ? "" : renderSteeringSummarySection(normalizedSnapshot?.layers?.steering)}
    `)}
      </main>
    </div>
    ${renderInboxShellScript()}
    ${graph === null ? "" : renderMermaidBootScript()}
  </body>
</html>`;
}

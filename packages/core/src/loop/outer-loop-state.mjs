/**
 * Deterministic outer-loop graph contract above family-local state machines.
 *
 * This module reuses conductor routing as the single source of truth for
 * authoritative outer runtime states. It does not invent a separate outer
 * taxonomy; instead it exposes routing outcomes as the outer state vocabulary,
 * adds graph metadata (semantic Start / End), and provides a stable inspection-
 * and viewer-friendly interpreter surface.
 */

import {
  ROUTING_OUTCOME,
  STOP_REASON,
  evaluateConductorRouting,
} from "./conductor-routing.mjs";

export const OUTER_STATE = Object.freeze({
  CONTINUE_CURRENT_WAIT: ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT,
  HANDOFF_TO_COPILOT_LOOP: ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP,
  HANDOFF_TO_REVIEWER_LOOP: ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP,
  STAY_WITH_CURRENT_LIVE_OWNER: ROUTING_OUTCOME.STAY_WITH_CURRENT_LIVE_OWNER,
  STOP_NEEDS_HUMAN: ROUTING_OUTCOME.STOP_NEEDS_HUMAN,
  DONE_TERMINAL: ROUTING_OUTCOME.DONE_TERMINAL,
  NEEDS_RECONCILE: ROUTING_OUTCOME.NEEDS_RECONCILE,
});

const OUTER_STATE_VALUES = Object.freeze(Object.values(OUTER_STATE));
const OUTER_STATE_SET = new Set(OUTER_STATE_VALUES);

export const OUTER_TERMINAL_STATES = Object.freeze([
  OUTER_STATE.STOP_NEEDS_HUMAN,
  OUTER_STATE.DONE_TERMINAL,
  OUTER_STATE.NEEDS_RECONCILE,
]);

export const OUTER_NONTERMINAL_STATES = Object.freeze([
  OUTER_STATE.CONTINUE_CURRENT_WAIT,
  OUTER_STATE.HANDOFF_TO_COPILOT_LOOP,
  OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP,
  OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER,
]);

const OUTER_TERMINAL_STATE_SET = new Set(OUTER_TERMINAL_STATES);
const ALL_OUTER_STATES = Object.freeze([...OUTER_STATE_VALUES]);

export const OUTER_GRAPH = Object.freeze({
  start: Object.freeze({ id: "outer_start", label: "Start", semantic: true }),
  end: Object.freeze({ id: "outer_end", label: "End", semantic: true }),
  entryStates: Object.freeze([...OUTER_STATE_VALUES]),
  terminalStates: OUTER_TERMINAL_STATES,
});

export const OUTER_STATE_TO_OUTER_ACTION = Object.freeze({
  [OUTER_STATE.CONTINUE_CURRENT_WAIT]: "continue_wait",
  [OUTER_STATE.HANDOFF_TO_COPILOT_LOOP]: "reenter_copilot_loop",
  [OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP]: "reenter_reviewer_loop",
  [OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER]: "continue_wait",
  [OUTER_STATE.STOP_NEEDS_HUMAN]: "stop",
  [OUTER_STATE.DONE_TERMINAL]: "done",
  [OUTER_STATE.NEEDS_RECONCILE]: "stop",
});

export const OUTER_STATE_TO_ROUTING_OUTCOME = Object.freeze({
  [OUTER_STATE.CONTINUE_CURRENT_WAIT]: ROUTING_OUTCOME.CONTINUE_CURRENT_WAIT,
  [OUTER_STATE.HANDOFF_TO_COPILOT_LOOP]: ROUTING_OUTCOME.HANDOFF_TO_COPILOT_LOOP,
  [OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP]: ROUTING_OUTCOME.HANDOFF_TO_REVIEWER_LOOP,
  [OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER]: ROUTING_OUTCOME.STAY_WITH_CURRENT_LIVE_OWNER,
  [OUTER_STATE.STOP_NEEDS_HUMAN]: ROUTING_OUTCOME.STOP_NEEDS_HUMAN,
  [OUTER_STATE.DONE_TERMINAL]: ROUTING_OUTCOME.DONE_TERMINAL,
  [OUTER_STATE.NEEDS_RECONCILE]: ROUTING_OUTCOME.NEEDS_RECONCILE,
});

export const OUTER_NEXT_ACTIONS = Object.freeze({
  [OUTER_STATE.CONTINUE_CURRENT_WAIT]: "Remain in outer wait and re-inspect after the bounded interval.",
  [OUTER_STATE.HANDOFF_TO_COPILOT_LOOP]: "Re-enter the Copilot loop.",
  [OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP]: "Re-enter the reviewer loop.",
  [OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER]: "Do not issue a new handoff; wait because a live owner is already active.",
  [OUTER_STATE.STOP_NEEDS_HUMAN]: "Stop and require human intervention before continuing.",
  [OUTER_STATE.DONE_TERMINAL]: "End the outer loop; no further automated action is needed.",
  [OUTER_STATE.NEEDS_RECONCILE]: "Stop and reconcile conflicting or insufficient state before resuming.",
});

export const OUTER_TRANSITIONS = Object.freeze({
  [OUTER_STATE.CONTINUE_CURRENT_WAIT]: ALL_OUTER_STATES,
  [OUTER_STATE.HANDOFF_TO_COPILOT_LOOP]: ALL_OUTER_STATES,
  [OUTER_STATE.HANDOFF_TO_REVIEWER_LOOP]: ALL_OUTER_STATES,
  [OUTER_STATE.STAY_WITH_CURRENT_LIVE_OWNER]: ALL_OUTER_STATES,
  [OUTER_STATE.STOP_NEEDS_HUMAN]: Object.freeze([]),
  [OUTER_STATE.DONE_TERMINAL]: Object.freeze([]),
  [OUTER_STATE.NEEDS_RECONCILE]: Object.freeze([]),
});

export function getAllowedOuterTransitions(state) {
  return Array.isArray(OUTER_TRANSITIONS[state]) ? [...OUTER_TRANSITIONS[state]] : [];
}

function normalizeOuterState(routingOutcome) {
  return OUTER_STATE_SET.has(routingOutcome) ? routingOutcome : OUTER_STATE.NEEDS_RECONCILE;
}

export function interpretOuterLoopState({
  target,
  ownershipState,
  copilotState,
  reviewerState,
  sourceMode,
  requiresLocalIsolation = false,
} = {}) {
  const routing = evaluateConductorRouting({
    target,
    ownershipState,
    copilotState,
    reviewerState,
    sourceMode,
    requiresLocalIsolation,
  });

  const state = normalizeOuterState(routing.routingOutcome);
  const allowedTransitions = getAllowedOuterTransitions(state);
  const nextAction = OUTER_NEXT_ACTIONS[state] ?? OUTER_NEXT_ACTIONS[OUTER_STATE.NEEDS_RECONCILE];
  const isTerminal = OUTER_TERMINAL_STATE_SET.has(state);

  if (state === OUTER_STATE.NEEDS_RECONCILE && routing.routingOutcome !== OUTER_STATE.NEEDS_RECONCILE) {
    return {
      state,
      allowedTransitions: [],
      nextAction,
      isTerminal,
      routingOutcome: OUTER_STATE.NEEDS_RECONCILE,
      outerAction: "stop",
      stopReason: STOP_REASON.UNKNOWN_STATE,
      handoffEnvelope: routing.handoffEnvelope,
    };
  }

  return {
    state,
    allowedTransitions,
    nextAction,
    isTerminal,
    routingOutcome: routing.routingOutcome,
    outerAction: routing.outerAction,
    stopReason: routing.stopReason,
    handoffEnvelope: routing.handoffEnvelope,
  };
}

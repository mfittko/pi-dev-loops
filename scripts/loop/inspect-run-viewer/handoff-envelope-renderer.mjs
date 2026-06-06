/**
 * Render the handoff envelope as a structured HTML section for the inspect-run viewer.
 *
 * Depends on the handoff envelope module from @pi-dev-loops/core.
 */
import { escapeHtml, renderDefinitionList, renderList } from "./shared.mjs";

/**
 * Render a single handoff envelope field key-value pair.
 * Handles arrays and objects gracefully.
 */
function renderEnvelopeValue(value) {
  if (value === null || value === undefined) {
    return `<em>not set</em>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `<em>empty</em>`;
    return renderList(value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))));
  }
  if (typeof value === "object") {
    return renderEnvelopeDefinitionList(Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? escapeHtml(v) : escapeHtml(JSON.stringify(v))]));
  }
  return escapeHtml(String(value));
}

/**
 * Render the handoff envelope as structured HTML.
 *
 * @param {object|null} envelope - The handoff envelope object, or null when unavailable.
 * @returns {string} HTML
 */

/**
 * Render a definition list where values are already HTML-safe (pre-escaped by renderEnvelopeValue).
 * Unlike renderDefinitionList, this does NOT escape values, only keys.
 */
function renderEnvelopeDefinitionList(entries) {
  return `<dl>${entries.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

export function renderHandoffEnvelopeSection(envelope) {
  if (!envelope) {
    return `<section id="handoff-envelope-section">
      <h2>Agent handoff</h2>
      <p><em>Envelope unavailable. Ensure buildDevLoopHandoffEnvelope() is callable and all inputs (resolver output, settings, gate state) are resolvable for the current PR.</em></p>
    </section>`;
  }

  const identity = envelope.target
    ? `${envelope.target.repo}#${envelope.target.pr ?? envelope.target.issue}`
    : "unknown";

  return `<section id="handoff-envelope-section">
    <h2>Agent handoff — ${escapeHtml(identity)}</h2>
    <p><em>Derived ${envelope.derivedAt ? `at ${escapeHtml(envelope.derivedAt)}` : ""}. Version ${escapeHtml(String(envelope.handoffVersion ?? "unknown"))}.</em></p>

    <h3>Target</h3>
    ${renderEnvelopeDefinitionList(envelope.target ? Object.entries(envelope.target).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, renderEnvelopeValue(v)]) : [["target", "<em>missing</em>"]])}

    <h3>Current state</h3>
    ${renderEnvelopeDefinitionList([
      ["currentGate", renderEnvelopeValue(envelope.currentGate)],
      ["currentHeadSha", renderEnvelopeValue(envelope.currentHeadSha)],
      ["ciStatus", renderEnvelopeValue(envelope.ciStatus)],
      ["unresolvedThreadCount", renderEnvelopeValue(envelope.unresolvedThreadCount)],
      ["copilotRoundCount", renderEnvelopeValue(envelope.copilotRoundCount)],
      ["maxCopilotRounds", renderEnvelopeValue(envelope.maxCopilotRounds)],
      ["executionMode", renderEnvelopeValue(envelope.executionMode)],
    ])}

    <h3>Work directive</h3>
    ${renderEnvelopeDefinitionList([
      ["nextAction", renderEnvelopeValue(envelope.nextAction)],
    ])}
    <h4>Required reads</h4>
    ${renderEnvelopeValue(envelope.requiredReads)}

    ${envelope.gateConfig ? `<h3>Gate configuration</h3>
    ${renderEnvelopeDefinitionList([
      ["angles", renderEnvelopeValue(envelope.gateConfig.angles)],
      ["excludeAngles", renderEnvelopeValue(envelope.gateConfig.excludeAngles)],
      ["blockCleanOnFindingSeverities", renderEnvelopeValue(envelope.gateConfig.blockCleanOnFindingSeverities)],
      ["requireCi", renderEnvelopeValue(envelope.gateConfig.requireCi)],
    ])}` : ""}

    <h3>Policy</h3>
    ${renderEnvelopeDefinitionList([
      ["asyncStartMode", renderEnvelopeValue(envelope.asyncStartMode)],
      ["requireDraftFirst", renderEnvelopeValue(envelope.requireDraftFirst)],
    ])}
    <h4>Stop rules</h4>
    ${renderEnvelopeValue(envelope.stopRules)}

    <h3>Worktree / isolation</h3>
    ${renderEnvelopeDefinitionList([
      ["cwd", renderEnvelopeValue(envelope.cwd)],
      ["worktreeRequired", renderEnvelopeValue(envelope.worktreeRequired)],
    ])}

    ${envelope.acceptance ? `<h3>Acceptance contract</h3>
    <h4>Criteria</h4>
    ${renderEnvelopeValue(envelope.acceptance.criteria?.map((c) => `[${c.severity}] ${c.id}: ${c.must}`))}
    ${renderEnvelopeDefinitionList([
      ["evidence", renderEnvelopeValue(envelope.acceptance.evidence)],
      ["maxFinalizationTurns", renderEnvelopeValue(envelope.acceptance.maxFinalizationTurns)],
    ])}` : ""}

    ${envelope.control ? `<h3>Runtime control</h3>
    ${renderEnvelopeDefinitionList([
      ["needsAttentionAfterMs", renderEnvelopeValue(envelope.control.needsAttentionAfterMs)],
      ["activeNoticeAfterMs", renderEnvelopeValue(envelope.control.activeNoticeAfterMs)],
    ])}` : ""}

    ${envelope.overrides ? `<h3>Explicit overrides</h3>
    ${renderEnvelopeValue(envelope.overrides)}` : ""}
  </section>`;
}

import {
  DEFAULT_INBOX_MODE,
  DEFAULT_INBOX_PAGE,
  DEFAULT_INBOX_PR_STATE,
  DEFAULT_INBOX_UPDATED_WITHIN_DAYS,
} from "./constants.mjs";
import {
  buildInspectionMermaidGraph,
  loadMermaidBrowserScript,
  renderMermaidBootScript,
  resetMermaidBrowserScriptCache,
} from "./graph.mjs";
import { buildSnapshotHref, renderInboxShellScript, renderInboxSidebar } from "./inbox.mjs";
import {
  deriveInboxSignalFromSnapshot,
  renderCopilotLayerSection,
  renderCopilotLoopIterationsSection,
  renderCurrentStateBanner,
  renderOuterLoopSummarySection,
  renderReviewerLayerSection,
  renderSteeringSummarySection,
} from "./status.mjs";
import {
  escapeHtml,
  normalizeInboxSignal,
  renderCollapsedDetailsPanel,
  renderDefinitionList,
  renderList,
  renderSnapshotStateLabel,
  renderTargetKey,
} from "./shared.mjs";
import { renderHandoffEnvelopeSection } from "./handoff-envelope-renderer.mjs";

export {
  buildInspectionMermaidGraph,
  deriveInboxSignalFromSnapshot,
  loadMermaidBrowserScript,
  normalizeInboxSignal,
  renderTargetKey,
  resetMermaidBrowserScriptCache,
};

export function renderInspectRunViewerHtml({
  repo = null,
  target = null,
  snapshot = null,
  handoffEnvelope = null,
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
    : `${scopeLabel} PR inspection dashboard`;
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
      .assigned-pr-row.assigned-pr-row-gate { border-left-color: #6f42c1; }
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
      .viewer-tabs { display: flex; gap: 0; margin: 1rem 0 0 0; border-bottom: 2px solid #ddd; }
      .viewer-tab { padding: 0.5rem 1rem; cursor: pointer; border: none; background: none; font: inherit; font-weight: 600; color: #666; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.15s, border-color 0.15s; }
      .viewer-tab:hover { color: #1565c0; }
      .viewer-tab.active { color: #1565c0; border-bottom-color: #1565c0; }
      .tab-content { display: none; }
      .tab-content.active { display: block; }
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
          ? `<section class="current-pr-state-banner" aria-label="${escapeHtml(scopeLabel)} PR inspection dashboard">
              <h1>${escapeHtml(scopeLabel)} PR inspection dashboard</h1>
              <p class="current-pr-state-summary-headline">Choose a PR from the sidebar</p>
              <p class="current-pr-state-detail">This local/operator dashboard is read-only. inspect-run remains authoritative for inspection/status state while this UI owns inbox discovery plus read-only presentation/prioritization.</p>
              <p class="current-pr-state-detail">The dashboard can span all assigned repos or be narrowed to one repo. The sidebar defaults to open PRs from the last 7 days and paginates through the result set.</p>
            </section>`
          : renderCurrentStateBanner(normalizedSnapshot, target, stateLabel, graph, effectiveSelectedTitle)}
        ${renderCollapsedDetailsPanel(`
      <p><strong>Snapshot state:</strong> <span class="badge">${escapeHtml(stateLabel)}</span> <button type="button" onclick="window.location.reload()" title="Reload snapshot" aria-label="Reload snapshot">🔄</button></p>
      <p><strong>Refresh:</strong> manual reload only.${rawSnapshotHref ? ` <strong>Raw snapshot:</strong> <a href="${escapeHtml(rawSnapshotHref)}"><code>${escapeHtml(rawSnapshotHref)}</code></a>` : ""}</p>
      ${topSummary}
    `)}
      ${target === null ? "" : `<div class="viewer-tabs">
        <button class="viewer-tab active" data-tab="live" onclick="switchTab('live')">Live view</button>
        <button class="viewer-tab" data-tab="handoff" onclick="switchTab('handoff')">Agent handoff</button>
      </div>
      <div class="tab-content active" id="tab-live">
        ${renderCollapsedDetailsPanel(`
      ${renderOuterLoopSummarySection(normalizedSnapshot)}
      ${renderCopilotLoopIterationsSection(normalizedSnapshot)}
      ${renderCopilotLayerSection(normalizedSnapshot?.layers?.copilot)}
      ${renderReviewerLayerSection(normalizedSnapshot?.layers?.reviewer)}
      ${renderSteeringSummarySection(normalizedSnapshot?.layers?.steering)}
        `)}
      </div>
      <div class="tab-content" id="tab-handoff">
        ${renderHandoffEnvelopeSection(handoffEnvelope)}
      </div>`}
      </main>
    </div>
    ${renderInboxShellScript()}
    <script>
      function switchTab(tabName) {
        document.querySelectorAll('.viewer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.viewer-tab[data-tab="' + tabName + '"]').classList.add('active');
        document.getElementById('tab-' + tabName).classList.add('active');
      }
    </script>
    ${graph === null ? "" : renderMermaidBootScript()}
  </body>
</html>`;
}

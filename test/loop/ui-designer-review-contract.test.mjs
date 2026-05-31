import test from 'node:test';
import assert from 'node:assert/strict';

import { validateUiDesignerReviewInput } from '../../scripts/loop/ui-designer-review-contract.mjs';

test('validateUiDesignerReviewInput skips non-UI work instead of triggering the designer loop', () => {
  const result = validateUiDesignerReviewInput({
    workType: 'cli',
    uiReviewRequested: false,
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'skip_non_ui',
    reason: 'non_ui_or_not_requested',
    missing: [],
  });
});

test('validateUiDesignerReviewInput fails closed when required review inputs are missing', () => {
  const result = validateUiDesignerReviewInput({
    workType: 'ui',
    uiReviewRequested: true,
    acceptanceCriteria: [],
    reviewBrief: '',
    artifactBundle: {
      sliceId: 'inspect-run-viewer',
      namedStates: [],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked_missing_required_inputs');
  assert.deepEqual(result.missing, [
    'acceptanceCriteria',
    'reviewBrief',
    'artifactBundle.namedStates',
  ]);
});

test('validateUiDesignerReviewInput rejects incomplete named-state artifacts', () => {
  const result = validateUiDesignerReviewInput({
    workType: 'ui',
    uiReviewRequested: true,
    acceptanceCriteria: ['named dashboard state renders'],
    reviewBrief: 'Check layout and visual hierarchy.',
    artifactBundle: {
      sliceId: 'inspect-run-viewer',
      namedStates: [
        {
          stateName: 'Current PR dashboard',
          screenshotPath: 'test-results/ui-smoke/inspect-run-viewer/named-states/current-pr-dashboard/screenshot.png',
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked_incomplete_artifact_bundle');
  assert.deepEqual(result.missing, ['artifactBundle.namedStates[0].statePath']);
});

test('validateUiDesignerReviewInput accepts the artifact bundle from the reusable harness path', () => {
  const result = validateUiDesignerReviewInput({
    workType: 'ui',
    uiReviewRequested: true,
    acceptanceCriteria: ['named dashboard state renders'],
    reviewBrief: 'Check layout and visual hierarchy.',
    artifactBundle: {
      sliceId: 'inspect-run-viewer',
      reportPath: 'playwright-report/ui-smoke/inspect-run-viewer/index.html',
      namedStates: [
        {
          stateName: 'Current PR dashboard',
          screenshotPath: 'test-results/ui-smoke/inspect-run-viewer/named-states/current-pr-dashboard/screenshot.png',
          statePath: 'test-results/ui-smoke/inspect-run-viewer/named-states/current-pr-dashboard/state.json',
        },
      ],
    },
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'ready_for_designer_review',
    reason: 'artifact_bundle_complete',
    missing: [],
  });
});

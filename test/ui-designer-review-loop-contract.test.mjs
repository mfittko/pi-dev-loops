import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const fromRepoRoot = (relativePath) => new URL(`../${relativePath}`, import.meta.url);
const readRepo = (relativePath) => readFile(fromRepoRoot(relativePath), 'utf8');

test('designer review loop doc remains the canonical bounded UI review handoff contract and the stale template is gone', async () => {
  const [doc, readme, indexDoc, localImplementationSkill] = await Promise.all([
    readRepo('docs/ui-designer-review-loop.md'),
    readRepo('README.md'),
    readRepo('docs/index.md'),
    readRepo('skills/local-implementation/SKILL.md'),
  ]);

  assert.match(doc, /designer-persona review loop/i);
  assert.match(doc, /single public entrypoint/i);
  assert.match(doc, /`dev-loop`/i);
  assert.match(doc, /acceptance criteria/i);
  assert.match(doc, /review brief/i);
  assert.match(doc, /artifact bundle/i);
  assert.match(doc, /test-results\/ui-smoke\/<sliceId>\/named-states\/<state-slug>/i);
  assert.match(doc, /continue_ui_fix_loop/i);
  assert.match(doc, /ui_review_satisfied/i);
  assert.match(doc, /blocked_needs_human_decision/i);
  assert.match(doc, /fails closed/i);
  assert.match(doc, /does not trigger for non-UI work/i);

  await assert.rejects(stat(fromRepoRoot('skills/dev-loop/templates/ui-designer-review.md')), /ENOENT/);

  assert.match(readme, /docs\/ui-designer-review-loop\.md/i);
  assert.match(indexDoc, /ui-designer-review-loop\.md/i);
  assert.match(localImplementationSkill, /\.\.\/\.\.\/docs\/ui-designer-review-loop\.md/i);
});

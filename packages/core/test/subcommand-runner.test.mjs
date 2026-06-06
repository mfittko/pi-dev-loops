import test from 'node:test';
import assert from 'node:assert/strict';
import { defineSubcommand } from '@pi-dev-loops/core/cli/subcommand-runner';

test('defineSubcommand creates parser with auto-usage', () => {
  const sub = defineSubcommand({
    name: 'test-cmd --repo <slug> --pr <n>',
    description: 'Test command.',
    options: [
      { flag: '--repo', type: 'string', required: true },
      { flag: '--pr', type: 'pr', required: true },
      { flag: '--verbose', type: 'boolean', default: false },
    ],
    async run(parsed) { return 0; },
  });

  assert.ok(sub.usage.includes('test-cmd'));
  assert.ok(sub.usage.includes('--repo'));
  assert.ok(sub.usage.includes('--pr'));

  const { parsed } = sub.parseArgs(['--repo', 'o/r', '--pr', '42']);
  assert.equal(parsed.repo, 'o/r');
  assert.equal(parsed.pr, 42);
  assert.equal(parsed.verbose, false);
});

test('defineSubcommand rejects removed flags', () => {
  const sub = defineSubcommand({
    name: 'test-cmd',
    description: 'Test.',
    options: [
      { flag: '--repo', type: 'string', required: true },
      { flag: '--force', type: 'boolean', default: false, removedAliases: ['--force-reason'] },
    ],
    async run() { return 0; },
  });

  assert.throws(
    () => sub.parseArgs(['--repo', 'o/r', '--force-reason', 'x']),
    /has been removed/
  );
});

test('defineSubcommand shows help', () => {
  const sub = defineSubcommand({
    name: 'test-cmd',
    description: 'Test.',
    options: [
      { flag: '--repo', type: 'string', required: true },
    ],
    async run() { return 0; },
  });

  const { help } = sub.parseArgs(['--help']);
  assert.equal(help, true);
});

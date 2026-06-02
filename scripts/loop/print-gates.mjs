#!/usr/bin/env node
/**
 * Print active gate review angles with their resolved prompts.
 *
 * Usage:
 *   node scripts/loop/print-gates.mjs [--repo-root <path>]
 *
 * Output:
 *   draft gate:
 *     scope        Check whether every changed file belongs in this PR...
 *     coverage     Check whether tests cover the changed behavior adequately...
 *     correctness  Check whether the implementation matches the acceptance criteria...
 *
 *   pre-approval gate:
 *     dry    Flag duplicated logic, repeated patterns, and copy-pasted code...
 *     kiss   Flag over-engineering and unnecessary complexity...
 *     ...
 */
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDevLoopConfig } from "../../packages/core/src/config/loader.mjs";
import { resolveGateAngles } from "../../packages/core/src/config/model-resolution.mjs";
import { resolveReviewerRole } from "../../packages/core/src/config/roles.mjs";

async function run({ stdout = process.stdout, repoRoot = process.cwd() } = {}) {
  const { config } = await loadDevLoopConfig({ repoRoot });

  const gates = [
    { name: "draft_gate", label: "draft gate", gate: "draft" },
    { name: "pre_approval_gate", label: "pre-approval gate", gate: "preApproval" },
  ];

  for (const { label, gate } of gates) {
    const angles = resolveGateAngles(config, gate);
    stdout.write(`${label}:\n`);

    if (!angles || angles.length === 0) {
      stdout.write("  (no angles configured)\n\n");
      continue;
    }

    const maxLen = Math.max(...angles.map(a => a.length));
    for (const angle of angles) {
      const { prompt } = resolveReviewerRole(config, angle);
      const displayPrompt = prompt ?? "(no prompt — add to config personas)";
      stdout.write(`  ${angle.padEnd(maxLen + 2)} ${displayPrompt}\n`);
    }
    stdout.write("\n");
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  run().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

export { run };

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensurePhaseFiles, parseCliArgs as parsePhaseFileArgs } from "./phase-files.mjs";
import { materializeTemplate } from "./render-template.mjs";

export const DEFAULT_PHASE_ARTIFACTS = [
  "manifest.json",
  "variant-a.md",
  "variant-b.md",
  "variant-c.md",
  "merged-plan.md",
  "review.md",
];

export function parseCliArgs(argv) {
  return parsePhaseFileArgs(argv);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const templateRoot = path.join(skillRoot, "templates");

export async function initializePhase(projectRoot, phase, patch = {}) {
  const nextPatch = {
    ...patch,
    artifacts: [...(patch.artifacts ?? []), ...DEFAULT_PHASE_ARTIFACTS],
  };

  const result = await ensurePhaseFiles(projectRoot, phase, nextPatch);

  const outputs = [
    ["phase-variant.md", path.join(result.paths.phaseDir, "variant-a.md"), { phase, variant: "a" }],
    ["phase-variant.md", path.join(result.paths.phaseDir, "variant-b.md"), { phase, variant: "b" }],
    ["phase-variant.md", path.join(result.paths.phaseDir, "variant-c.md"), { phase, variant: "c" }],
    ["merged-phase-plan.md", path.join(result.paths.phaseDir, "merged-plan.md"), { phase }],
    ["review.md", path.join(result.paths.phaseDir, "review.md"), { phase }],
  ];

  for (const [templateName, outputPath, variables] of outputs) {
    await materializeTemplate(path.join(templateRoot, templateName), outputPath, variables);
  }

  return {
    ...result,
    generated: outputs.map(([, outputPath]) => path.relative(projectRoot, outputPath)),
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const result = await initializePhase(options.projectRoot, options.phase, options.patch);
  process.stdout.write(
    `${JSON.stringify({ ok: true, phase: result.paths.phase, generated: result.generated })}\n`,
  );
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

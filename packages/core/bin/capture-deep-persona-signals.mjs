#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewThreads, readInput, parseJsonText, formatCliError } from "../src/github/review-threads.mjs";
import { extractDeepPersonaSignals } from "../src/debt/deep-persona-signals.mjs";

export const USAGE = [
  "Usage: capture-deep-persona-signals.mjs --input <path> --pr-number <n> --pr-url <url> [--output-dir <path>]",
  "",
  "Arguments:",
  "  --input <path>        Path to normalized review-thread JSON (required)",
  "  --pr-number <n>       PR number for metadata (required)",
  "  --pr-url <url>        PR URL for metadata (required)",
  "  --output-dir <path>   Output directory for emitted artifact (default: .pi/debt/signals/)",
].join("\n");

/**
 * Parse CLI arguments for the capture-deep-persona-signals CLI.
 *
 * @param {string[]} argv - Argument list (e.g. process.argv.slice(2))
 * @returns {{ inputPath: string, prNumber: string, prUrl: string, outputDir: string }}
 */
export function parseArgs(argv) {
  const args = [...argv];
  const options = {
    inputPath: undefined,
    prNumber: undefined,
    prUrl: undefined,
    outputDir: ".pi/debt/signals",
  };

  while (args.length > 0) {
    const token = args.shift();

    switch (token) {
      case "--input": {
        const value = args.shift();
        if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
          throw Object.assign(new Error("Missing value for --input"), { usage: USAGE });
        }
        options.inputPath = value;
        break;
      }
      case "--pr-number": {
        const value = args.shift();
        if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
          throw Object.assign(new Error("Missing value for --pr-number"), { usage: USAGE });
        }
        if (!/^\d+$/.test(value)) {
          throw Object.assign(new Error(`--pr-number must be a positive integer, got: ${value}`), { usage: USAGE });
        }
        options.prNumber = value;
        break;
      }
      case "--pr-url": {
        const value = args.shift();
        if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
          throw Object.assign(new Error("Missing value for --pr-url"), { usage: USAGE });
        }
        options.prUrl = value;
        break;
      }
      case "--output-dir": {
        const value = args.shift();
        if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
          throw Object.assign(new Error("Missing value for --output-dir"), { usage: USAGE });
        }
        options.outputDir = value;
        break;
      }
      default:
        throw Object.assign(new Error(`Unknown argument: ${token}`), { usage: USAGE });
    }
  }

  if (!options.inputPath) {
    throw Object.assign(new Error("--input is required"), { usage: USAGE });
  }
  if (!options.prNumber) {
    throw Object.assign(new Error("--pr-number is required"), { usage: USAGE });
  }
  if (!options.prUrl) {
    throw Object.assign(new Error("--pr-url is required"), { usage: USAGE });
  }

  return /** @type {{ inputPath: string, prNumber: string, prUrl: string, outputDir: string }} */ (options);
}

/**
 * Generate the output filename.
 * @param {string} prNumber
 * @returns {string}
 */
export function outputFilename(prNumber) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `deep-persona-signals-${prNumber}-${ts}.json`;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  // Read and parse the review-thread input
  const rawText = await readInput({ inputPath: options.inputPath });
  const parsed = parseReviewThreads(parseJsonText(rawText));

  // Extract deep-persona signals
  const signals = extractDeepPersonaSignals(parsed, {
    prNumber: options.prNumber,
    prUrl: options.prUrl,
  });

  // Build artifact envelope
  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    prNumber: Number(options.prNumber),
    prUrl: options.prUrl,
    source: "pr_review_deep_persona",
    signalCount: signals.length,
    signals,
  };

  // Write to output directory
  const outDir = resolve(options.outputDir);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, outputFilename(options.prNumber));
  await writeFile(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  process.stdout.write(JSON.stringify({ ok: true, outputPath: outPath, signalCount: signals.length }) + "\n");
}

// Only auto-run when executed directly (not imported)
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  run().catch((error) => {
    if (error.usage) {
      process.stderr.write(error.usage + "\n\n");
    }
    process.stderr.write(formatCliError(error) + "\n");
    process.exitCode = 1;
  });
}

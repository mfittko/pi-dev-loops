#!/usr/bin/env node
/**
 * validate-no-duplicate-rules.mjs — CI guardrail: detect duplicated imperative
 * rule text across skill doc files under skills/.
 *
 * Scans skills/ for Markdown files, extracts imperative sentences (those
 * containing "must", "never", "do not", or "require"/"required"), and reports
 * any sentence that appears in more than one file.
 *
 * Symlink note:
 *   .pi/skills/ -> ../skills on this repo, so scanning skills/ covers both.
 *
 * False-positive suppression:
 *   - Fenced code blocks (``` or ~~~)
 *   - Inline code spans (`)
 *   - Blockquotes (lines starting with ">")
 *   - Markdown link URLs (text inside (...))
 *   - Headings (lines starting with "#")
 *   - Only cross-file duplicates reported (same-file dupes are intentional)
 *
 * Exclusion list:
 *   Canonical contract docs that own their content by design are excluded
 *   from cross-file duplicate detection.
 *
 * Exit 0 when clean, exit 1 when duplicates found.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");

const CANONICAL_CONTRACT_DOCS = new Set([
  "skills/docs/copilot-loop-operations.md",
  "skills/docs/public-dev-loop-contract.md",
]);

const IMPERATIVE_PATTERNS = [
  /\bmust\b/i,
  /\bnever\b/i,
  /\bdo not\b/i,
  /\brequire[sd]?\b(?!DraftFirst)/i,
];

const MIN_SENTENCE_LENGTH = 20;

const USAGE = `Usage: validate-no-duplicate-rules.mjs [--help]

Scan skills/ for duplicated imperative rule text across Markdown files.
Exit 0 when no duplicates found. Exit 1 when duplicates found.

Options:
  --help, -h   Show this help`.trim();


export async function* collectMarkdownFiles(dir, repoRoot = REPO_ROOT) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      yield* collectMarkdownFiles(fullPath, repoRoot);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield fullPath;
    }
  }
}

export function isImperativeSentence(sentence) {
  return IMPERATIVE_PATTERNS.some((pattern) => pattern.test(sentence));
}

export function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function extractSentences(content) {
  const lines = content.split(/\r?\n/);
  const sentences = [];
  let inFencedBlock = false;
  let fencedDelimiter = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const rawTrimmed = line.trim();

    if (/^\s*#/.test(line)) {
      continue;
    }

    if (/^\s*>/.test(line)) {
      continue;
    }

    const fenceMatch = rawTrimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      if (!inFencedBlock) {
        inFencedBlock = true;
        fencedDelimiter = fenceMatch[1];
        continue;
      } else if (rawTrimmed.startsWith(fencedDelimiter)) {
        inFencedBlock = false;
        fencedDelimiter = "";
        continue;
      }
    }

    if (inFencedBlock) {
      continue;
    }

    line = line
      .replace(/`[^`]*`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const part of parts) {
      const normalized = normalizeSentence(part);
      if (normalized.length >= MIN_SENTENCE_LENGTH && isImperativeSentence(normalized)) {
        sentences.push({ text: normalized, line: i + 1 });
      }
    }
  }

  return sentences;
}

export async function scanSkills(skillsDir = SKILLS_DIR, repoRoot = REPO_ROOT) {
  const fileMap = new Map();

  for await (const filePath of collectMarkdownFiles(skillsDir, repoRoot)) {
    const relativePath = path.relative(repoRoot, filePath);

    if (CANONICAL_CONTRACT_DOCS.has(relativePath)) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const sentences = extractSentences(content);

    for (const { text, line } of sentences) {
      if (!fileMap.has(text)) {
        fileMap.set(text, []);
      }
      fileMap.get(text).push({ file: relativePath, line });
    }
  }

  const duplicates = new Map();
  for (const [text, occurrences] of fileMap) {
    const uniqueFiles = new Set(occurrences.map((o) => o.file));
    if (uniqueFiles.size > 1) {
      duplicates.set(text, occurrences);
    }
  }

  return { fileMap, duplicates };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const { fileMap, duplicates } = await scanSkills();

  let totalFilesScanned = 0;
  const seenFiles = new Set();
  for (const [, occurrences] of fileMap) {
    for (const { file } of occurrences) {
      seenFiles.add(file);
    }
  }
  totalFilesScanned = seenFiles.size;

  if (duplicates.size === 0) {
    process.stdout.write(`No duplicate imperative rules found across skill docs.\n`);
    process.stdout.write(`\n${totalFilesScanned} files scanned, ${fileMap.size} imperative sentences extracted, 0 duplicates found.\n`);
    return 0;
  }

  process.stdout.write(`Duplicate imperative rules found across skill docs:\n\n`);
  for (const [text, occurrences] of duplicates) {
    for (const { file, line } of occurrences) {
      process.stdout.write(`  ${file}:${line}\n`);
    }
    process.stdout.write(`    "${text}"\n\n`);
  }

  process.stdout.write(`${totalFilesScanned} files scanned, ${fileMap.size} imperative sentences extracted, ${duplicates.size} duplicates found.\n`);
  return 1;
}

// Only run main() when executed directly, not when imported for testing.
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const exitCode = await main();
  process.exit(exitCode);
}

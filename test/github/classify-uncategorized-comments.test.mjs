import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runNode as runNodeHelper, writeJson } from "../_helpers.mjs";
import {
  buildClassificationPrompt,
  classifyUncategorizedComments,
  dedupeComments,
  parseClassifyUncategorizedCliArgs,
} from "../../scripts/github/classify-uncategorized-comments.mjs";

const scriptPath = path.resolve("scripts/github/classify-uncategorized-comments.mjs");
const runNode = (args = [], options = {}) => runNodeHelper(scriptPath, args, options);

const comments = [
  { prNumber: 1, path: "scripts/a.mjs", line: 10, htmlUrl: "https://example.test/1", body: "JSON.parse can throw without a guard.", excerpt: "JSON.parse can throw without a guard." },
  { prNumber: 2, path: "docs/b.md", line: 5, htmlUrl: "https://example.test/2", body: "Documented contract says ready, code says active.", excerpt: "Documented contract says ready, code says active." },
  { prNumber: 3, path: "scripts/a.mjs", line: 10, htmlUrl: "https://example.test/3", body: "JSON.parse can throw without a guard.", excerpt: "JSON.parse can throw without a guard." },
];

function responseBody(clusters = []) {
  return {
    clusters,
    unclustered: { frequency: 0, examples: [] },
    summary: { totalCommentsProcessed: 2, totalClustersFound: clusters.length },
  };
}

test("classify-uncategorized-comments help lists --base-url", async () => {
  const result = await runNode(["--help"]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /--base-url <url>/);
});

test("parseClassifyUncategorizedCliArgs requires explicit --model", () => {
  assert.throws(
    () => parseClassifyUncategorizedCliArgs(["--api-key", "key"]),
    /requires --model/i,
  );
  assert.equal(parseClassifyUncategorizedCliArgs(["--model", "gpt-test", "--api-key", "key"]).model, "gpt-test");
  assert.equal(parseClassifyUncategorizedCliArgs(["--model", "gpt-test", "--base-url", "https://models.example.test/v1/"]).baseUrl, "https://models.example.test/v1");
  assert.throws(
    () => parseClassifyUncategorizedCliArgs(["--model", "gpt-test", "--base-url", "/"]),
    /valid http\(s\) URL|non-empty http\(s\) URL/i,
  );
});

test("dedupeComments collapses duplicate prompt text by default while preserving occurrence count", () => {
  const deduped = dedupeComments(comments);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].occurrenceCount, 2);
  assert.deepEqual(deduped[0].duplicatePrNumbers, [1, 3]);

  const excerptDuplicates = dedupeComments([
    { prNumber: 4, body: "same excerpt then long body A", excerpt: "same excerpt" },
    { prNumber: 5, body: "same excerpt then long body B", excerpt: "same excerpt" },
  ]);
  assert.equal(excerptDuplicates.length, 1);

  const fullBodyDistinct = dedupeComments([
    { prNumber: 4, body: "same excerpt then long body A", excerpt: "same excerpt" },
    { prNumber: 5, body: "same excerpt then long body B", excerpt: "same excerpt" },
  ], { useFullBody: true });
  assert.equal(fullBodyDistinct.length, 2);
});

test("buildClassificationPrompt uses excerpts by default and full bodies when requested", () => {
  const excerptPrompt = buildClassificationPrompt({ comments: dedupeComments(comments), useFullBody: false });
  const fullPrompt = buildClassificationPrompt({ comments: dedupeComments(comments), useFullBody: true });

  assert.match(excerptPrompt.user, /\[comment 1\] occurrences=2 PR#1 scripts\/a\.mjs:10: JSON\.parse/);
  assert.match(fullPrompt.user, /Documented contract says ready/);
  assert.match(excerptPrompt.system, /existing categories/i);
});

test("validateLlmPayload uses unique fallback names for unnamed clusters", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loops-classify-unnamed-"));

  try {
    const input = path.join(tempDir, "uncategorized-comments.json");
    await writeJson(input, comments.slice(0, 1));

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseBody([
        { name: "", frequency: 1, examples: [] },
        { frequency: 1, examples: [] },
      ])) } }] }),
    });

    const result = await classifyUncategorizedComments({ input, outputDir: path.join(tempDir, "out"), model: "gpt-test", apiKey: "key", provider: "openai-compatible" }, { fetchImpl });
    assert.deepEqual(result.clusters.map((cluster) => cluster.name), ["unnamed-cluster-1", "unnamed-cluster-2"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classifyUncategorizedComments reads input, retries malformed JSON once, and writes JSON and Markdown", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loops-classify-uncategorized-"));

  try {
    const input = path.join(tempDir, "uncategorized-comments.json");
    const outputDir = path.join(tempDir, "out");
    await writeJson(input, comments);

    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "not-json" } }] }) };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseBody([
          {
            name: "error-guard",
            label: "Error Guard",
            description: "Missing error handling around parser calls.",
            frequency: 2,
            priority: "high",
            recommendedPersona: "error-guard",
            personaRationale: "Mechanical pre-review catch.",
            examples: [{ prNumber: 1, path: "scripts/a.mjs", excerpt: "JSON.parse can throw" }],
          },
        ])) } }] }),
      };
    };

    const result = await classifyUncategorizedComments({ input, outputDir, model: "gpt-test", apiKey: "key", provider: "openai-compatible" }, { fetchImpl });

    assert.equal(calls.length, 2);
    assert.equal(result.dedupedComments, 2);
    assert.equal(result.summary.totalCommentsProcessed, 2);
    assert.equal(result.summary.totalOriginalComments, 3);
    assert.equal(result.files.jsonPath, path.join(outputDir, "uncategorized-clusters.json"));
    assert.equal(result.files.markdownPath, path.join(outputDir, "uncategorized-clusters.md"));

    const json = JSON.parse(await readFile(result.files.jsonPath, "utf8"));
    const markdown = await readFile(result.files.markdownPath, "utf8");
    assert.equal(json.clusters[0].name, "error-guard");
    assert.match(markdown, /Persona candidates/);
    assert.match(markdown, /personas:/);
    assert.match(markdown, /Left unclustered/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classifyUncategorizedComments falls back from summary JSON and retries 429", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loops-classify-summary-"));

  try {
    const input = path.join(tempDir, "copilot-comment-summary.json");
    await writeJson(input, {
      comments: [
        { ...comments[0], primaryCategoryId: null },
        { ...comments[1], primaryCategoryId: "gate_evidence" },
      ],
    });

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 429, text: async () => "rate limited" };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify(responseBody()) }] }) };
    };

    const result = await classifyUncategorizedComments({ input, outputDir: path.join(tempDir, "out"), model: "claude-test", apiKey: "key", provider: "anthropic", retryBaseMs: 1 }, { fetchImpl });

    assert.equal(calls, 2);
    assert.equal(result.totalComments, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classifyUncategorizedComments reports both default input candidates when missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loops-classify-missing-input-"));

  try {
    await assert.rejects(
      classifyUncategorizedComments({ outputDir: path.join(tempDir, "out"), model: "gpt-test", apiKey: "key", provider: "openai-compatible" }, { fetchImpl: async () => { throw new Error("should not fetch"); } }),
      /uncategorized-comments\.json.*copilot-comment-summary\.json/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classify-uncategorized-comments CLI rejects missing API key clearly", async () => {
  const result = await runNode(["--model", "gpt-test"], { env: { ...process.env, LLM_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" } });

  assert.equal(result.code, 1);
  const stderr = JSON.parse(result.stderr);
  assert.match(stderr.error, /requires an API key/i);
});

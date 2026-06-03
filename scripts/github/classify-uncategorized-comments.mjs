#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { requireOptionValue } from "../_cli-primitives.mjs";
import { CATEGORY_DEFINITIONS, DEFAULT_OUTPUT_DIR } from "./audit-copilot-comments.mjs";

const DEFAULT_INPUT_NAME = "uncategorized-comments.json";
const FALLBACK_SUMMARY_NAME = "copilot-comment-summary.json";
const DEFAULT_JSON_NAME = "uncategorized-clusters.json";
const DEFAULT_MARKDOWN_NAME = "uncategorized-clusters.md";
const DEFAULT_PROVIDER = "openai-compatible";
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MS = 1000;
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/u, "");
  if (trimmed.length === 0) {
    throw parseError("--base-url must be a non-empty http(s) URL");
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw parseError("--base-url must be a valid http(s) URL");
  }
  return trimmed;
}

const USAGE = `Usage: classify-uncategorized-comments.mjs --model <model> [--provider <openai-compatible|anthropic>] [--api-key <key>] [--input <path>] [--output-dir <path>] [--use-full-body] [--no-dedup]

Classify uncategorized Copilot review comments with a single LLM pass and write
both JSON and Markdown cluster reports. Uses built-in fetch; no extra npm deps.

Required:
  --model <model>           LLM model to use. This flag is required.

Optional:
  --provider <provider>     openai-compatible (default) or anthropic
  --api-key <key>           LLM API key. Falls back to LLM_API_KEY, then provider-specific env.
  --base-url <url>          Provider base URL (defaults to OpenAI/Anthropic public API)
  --input <path>            Input JSON. Defaults to <output-dir>/uncategorized-comments.json,
                            then falls back to <output-dir>/copilot-comment-summary.json
  --output-dir <path>       Output directory (default: tmp/investigation)
  --use-full-body           Send full comment bodies instead of excerpts
  --no-dedup                Disable default body/excerpt deduplication

Output files:
  <output-dir>/uncategorized-clusters.json
  <output-dir>/uncategorized-clusters.md

Error output (stderr, JSON):
  { "ok": false, "error": "...", "usage": "..." }
  { "ok": false, "error": "..." }

Exit codes:
  0  Success
  1  Argument error, input error, LLM error, or malformed LLM JSON`.trim();

const parseError = buildParseError(USAGE);

function parseProvider(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "openai-compatible" || normalized === "anthropic") {
    return normalized;
  }
  throw parseError("--provider must be openai-compatible or anthropic");
}

export function parseClassifyUncategorizedCliArgs(argv) {
  const args = [...argv];
  const options = {
    help: false,
    provider: DEFAULT_PROVIDER,
    model: undefined,
    apiKey: undefined,
    baseUrl: undefined,
    input: undefined,
    outputDir: DEFAULT_OUTPUT_DIR,
    useFullBody: false,
    dedup: true,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--help" || token === "-h") {
      options.help = true;
      return options;
    }

    if (token === "--model") {
      options.model = requireOptionValue(args, "--model", parseError).trim();
      continue;
    }

    if (token === "--provider") {
      options.provider = parseProvider(requireOptionValue(args, "--provider", parseError));
      continue;
    }

    if (token === "--api-key") {
      options.apiKey = requireOptionValue(args, "--api-key", parseError).trim();
      continue;
    }

    if (token === "--base-url") {
      options.baseUrl = normalizeBaseUrl(requireOptionValue(args, "--base-url", parseError));
      continue;
    }

    if (token === "--input") {
      options.input = requireOptionValue(args, "--input", parseError).trim();
      continue;
    }

    if (token === "--output-dir") {
      options.outputDir = requireOptionValue(args, "--output-dir", parseError).trim();
      continue;
    }

    if (token === "--use-full-body") {
      options.useFullBody = true;
      continue;
    }

    if (token === "--no-dedup") {
      options.dedup = false;
      continue;
    }

    throw parseError(`Unknown argument: ${token}`);
  }

  if (options.model === undefined || options.model.length === 0) {
    throw parseError("classify-uncategorized-comments requires --model <model>");
  }
  if (options.outputDir.length === 0) {
    throw parseError("--output-dir must be a non-empty path");
  }
  if (options.input !== undefined && options.input.length === 0) {
    throw parseError("--input must be a non-empty path");
  }

  return options;
}

function resolveApiKey(options, env) {
  const explicit = typeof options.apiKey === "string" && options.apiKey.trim().length > 0 ? options.apiKey.trim() : null;
  if (explicit) return explicit;
  const generic = typeof env.LLM_API_KEY === "string" && env.LLM_API_KEY.trim().length > 0 ? env.LLM_API_KEY.trim() : null;
  if (generic) return generic;
  const providerKey = options.provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const normalized = typeof providerKey === "string" && providerKey.trim().length > 0 ? providerKey.trim() : null;
  if (normalized) return normalized;
  throw new Error("classify-uncategorized-comments requires an API key via --api-key, LLM_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY");
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInputPath(options) {
  if (options.input) return options.input;
  const uncategorizedPath = path.join(options.outputDir, DEFAULT_INPUT_NAME);
  if (await pathExists(uncategorizedPath)) return uncategorizedPath;
  const summaryPath = path.join(options.outputDir, FALLBACK_SUMMARY_NAME);
  if (await pathExists(summaryPath)) return summaryPath;
  throw new Error(`No classifier input found. Expected ${uncategorizedPath} or fallback ${summaryPath}; pass --input to use another file.`);
}

function normalizeComment(entry) {
  return {
    prNumber: Number.isInteger(entry?.prNumber) ? entry.prNumber : null,
    path: typeof entry?.path === "string" ? entry.path : null,
    line: Number.isInteger(entry?.line) ? entry.line : null,
    htmlUrl: typeof entry?.htmlUrl === "string" ? entry.htmlUrl : null,
    body: typeof entry?.body === "string" ? entry.body.trim() : "",
    excerpt: typeof entry?.excerpt === "string" && entry.excerpt.trim().length > 0
      ? entry.excerpt.trim()
      : String(entry?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
  };
}

async function loadComments(inputPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read input JSON at ${inputPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawComments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.comments)
      ? parsed.comments.filter((comment) => comment?.primaryCategoryId === null)
      : null;

  if (!rawComments) {
    throw new Error("Input JSON must be an uncategorized comments array or an audit summary with comments[]");
  }

  return rawComments.map(normalizeComment).filter((comment) => comment.body.length > 0 || comment.excerpt.length > 0);
}

export function dedupeComments(comments, { useFullBody = false } = {}) {
  const byKey = new Map();
  for (const comment of comments) {
    const keySource = useFullBody ? comment.body : (comment.excerpt || comment.body);
    const key = String(keySource ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      if (Number.isInteger(comment.prNumber)) existing.duplicatePrNumbers.push(comment.prNumber);
      continue;
    }
    byKey.set(key, {
      ...comment,
      occurrenceCount: 1,
      duplicatePrNumbers: Number.isInteger(comment.prNumber) ? [comment.prNumber] : [],
    });
  }
  return [...byKey.values()];
}

function formatCategoryList() {
  return CATEGORY_DEFINITIONS
    .map((category) => `- ${category.id}: ${category.label} — ${category.description}`)
    .join("\n");
}

export function buildClassificationPrompt({ comments, useFullBody = false, strict = false }) {
  const system = `You are a code review comment clusterer. Classify Copilot-authored review comments into emergent thematic clusters.\n\nAvoid clusters that merely restate these existing categories:\n${formatCategoryList()}\n\nReturn JSON only. ${strict ? "No prose, no markdown fences, no commentary." : ""}`;
  const commentLines = comments.map((comment, index) => {
    const text = useFullBody ? comment.body : comment.excerpt;
    const location = [comment.path, Number.isInteger(comment.line) ? `:${comment.line}` : null].filter(Boolean).join("");
    return `[comment ${index + 1}] occurrences=${comment.occurrenceCount ?? 1} PR#${comment.prNumber ?? "?"}${location ? ` ${location}` : ""}: ${text}`;
  });
  const user = `Repo context: mfittko/pi-dev-loops Copilot review comments that did not match the existing regex taxonomy.\n\nTask:\n1. Identify 5-15 emergent thematic clusters.\n2. For each cluster include name, label, description, frequency, priority (high/medium/low), recommendedPersona or null, personaRationale, and 3-5 examples with prNumber, path, excerpt.\n3. Include unclustered.frequency and unclustered.examples.\n4. Include optional commentAssignments as [{ commentIndex, clusterName }].\n5. Produce persona candidates for high/medium clusters through recommendedPersona and personaRationale.\n\nOutput exact JSON object shape:\n{ "clusters": [ { "name": "slug", "label": "Label", "description": "...", "frequency": 42, "priority": "high", "recommendedPersona": "persona-slug", "personaRationale": "...", "examples": [ { "prNumber": 1, "path": "file", "excerpt": "..." } ] } ], "unclustered": { "frequency": 0, "examples": [] }, "summary": { "totalCommentsProcessed": ${comments.length}, "totalClustersFound": 0 }, "commentAssignments": [] }\n\nComments:\n${commentLines.join("\n")}`;
  return { system, user };
}

function requestShape({ provider, baseUrl, model, apiKey, prompt }) {
  if (provider === "anthropic") {
    return {
      url: `${baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL}/messages`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      },
    };
  }

  return {
    url: `${baseUrl ?? OPENAI_DEFAULT_BASE_URL}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      }),
    },
  };
}

function extractProviderText(provider, rawText) {
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error("LLM provider returned non-JSON response envelope");
  }
  if (provider === "anthropic") {
    if (typeof payload?.content === "string") return payload.content;
    const text = Array.isArray(payload?.content)
      ? payload.content.filter((part) => part?.type === "text" && typeof part?.text === "string").map((part) => part.text).join("\n")
      : "";
    if (text.length > 0) return text;
  } else {
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.length > 0) return text;
  }
  throw new Error("LLM provider response did not contain text content");
}

function parseLlmJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("LLM response was not valid JSON");
  }
}

function validateLlmPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.clusters)) {
    throw new Error("LLM JSON must include clusters[]");
  }
  return {
    clusters: payload.clusters.map((cluster, index) => {
      const normalizedName = typeof cluster?.name === "string" && cluster.name.trim().length > 0
        ? cluster.name.trim()
        : `unnamed-cluster-${index + 1}`;
      return {
        name: normalizedName,
        label: typeof cluster?.label === "string" && cluster.label.trim().length > 0 ? cluster.label.trim() : normalizedName,
        description: typeof cluster?.description === "string" ? cluster.description : "",
        frequency: Number.isInteger(cluster?.frequency) ? cluster.frequency : 0,
        priority: ["high", "medium", "low"].includes(cluster?.priority) ? cluster.priority : "low",
        recommendedPersona: typeof cluster?.recommendedPersona === "string" && cluster.recommendedPersona.trim().length > 0 ? cluster.recommendedPersona.trim() : null,
        personaRationale: typeof cluster?.personaRationale === "string" ? cluster.personaRationale : "",
        examples: Array.isArray(cluster?.examples) ? cluster.examples.map((example) => ({
          prNumber: Number.isInteger(example?.prNumber) ? example.prNumber : null,
          path: typeof example?.path === "string" ? example.path : null,
          excerpt: typeof example?.excerpt === "string" ? example.excerpt : "",
        })) : [],
      };
    }),
    unclustered: {
      frequency: Number.isInteger(payload?.unclustered?.frequency) ? payload.unclustered.frequency : 0,
      examples: Array.isArray(payload?.unclustered?.examples) ? payload.unclustered.examples : [],
    },
    summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
    commentAssignments: Array.isArray(payload.commentAssignments) ? payload.commentAssignments : [],
  };
}

async function wait(ms) {
  if (ms > 0) await new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function callLlmWithRetry({ provider, baseUrl, model, apiKey, prompt, retryMax, retryBaseMs, fetchImpl }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryMax; attempt += 1) {
    const { url, init } = requestShape({ provider, baseUrl, model, apiKey, prompt });
    const response = await fetchImpl(url, init);
    const text = await response.text();
    if (response.ok) {
      return extractProviderText(provider, text);
    }
    const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
    lastError = new Error(`LLM request failed with HTTP ${response.status}: ${text.trim()}`);
    if (!retryable || attempt === retryMax) throw lastError;
    await wait(retryBaseMs * (2 ** attempt));
  }
  throw lastError ?? new Error("LLM request failed");
}

function buildPersonaCandidates(clusters, model) {
  return clusters
    .filter((cluster) => ["high", "medium"].includes(cluster.priority) && cluster.recommendedPersona)
    .sort((left, right) => {
      const rank = { high: 0, medium: 1, low: 2 };
      if (rank[left.priority] !== rank[right.priority]) return rank[left.priority] - rank[right.priority];
      return right.frequency - left.frequency;
    })
    .map((cluster) => ({
      persona: cluster.recommendedPersona,
      prompt: `Review for ${cluster.label}: ${cluster.description} Focus on issue patterns represented by this cluster and flag concrete repo-specific risks without broadening scope.`,
      defaultModel: model,
      sourceCluster: cluster.name,
      priority: cluster.priority,
      rationale: cluster.personaRationale,
    }));
}

function renderReport(result) {
  const lines = [];
  lines.push("# Uncategorized Copilot comment clusters");
  lines.push("");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Model: ${result.provider} / ${result.model}`);
  lines.push(`Comments classified: ${result.totalComments}`);
  lines.push(`Deduped comments sent: ${result.dedupedComments}`);
  lines.push(`Clusters found: ${result.clusters.length}`);
  lines.push(`Left unclustered: ${result.unclustered.frequency}`);
  lines.push("");
  lines.push("## Clusters");
  lines.push("");
  if (result.clusters.length === 0) {
    lines.push("- No clusters returned.");
  }
  for (const cluster of result.clusters) {
    lines.push(`### ${cluster.label}`);
    lines.push("");
    lines.push(`- Slug: ${cluster.name}`);
    lines.push(`- Frequency: ${cluster.frequency}`);
    lines.push(`- Priority: ${cluster.priority}`);
    lines.push(`- Description: ${cluster.description}`);
    lines.push(`- Recommended persona: ${cluster.recommendedPersona ?? "none"}`);
    if (cluster.personaRationale) lines.push(`- Persona rationale: ${cluster.personaRationale}`);
    if (cluster.examples.length > 0) {
      lines.push("- Examples:");
      for (const example of cluster.examples) {
        lines.push(`  - PR #${example.prNumber ?? "?"}${example.path ? ` (${example.path})` : ""}: ${example.excerpt}`);
      }
    }
    lines.push("");
  }
  lines.push("## Persona candidates");
  lines.push("");
  if (result.personaCandidates.length === 0) {
    lines.push("- None recommended.");
  } else {
    lines.push("```yaml");
    lines.push("personas:");
    for (const candidate of result.personaCandidates) {
      lines.push(`  - persona: ${candidate.persona}`);
      lines.push(`    defaultModel: ${candidate.defaultModel}`);
      lines.push(`    prompt: ${JSON.stringify(candidate.prompt)}`);
    }
    lines.push("```");
  }
  lines.push("");
  lines.push("## Left unclustered");
  lines.push("");
  if (!Array.isArray(result.unclustered.examples) || result.unclustered.examples.length === 0) {
    lines.push("- No examples returned.");
  } else {
    for (const example of result.unclustered.examples.slice(0, 10)) {
      lines.push(`- PR #${example?.prNumber ?? "?"}${example?.path ? ` (${example.path})` : ""}: ${example?.excerpt ?? ""}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function classifyUncategorizedComments(options, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Built-in fetch is unavailable in this Node runtime");
  }
  const apiKey = resolveApiKey(options, env);
  const inputPath = await resolveInputPath(options);
  const comments = await loadComments(inputPath);
  const commentsForPrompt = options.dedup === false ? comments.map((comment) => ({ ...comment, occurrenceCount: 1, duplicatePrNumbers: Number.isInteger(comment.prNumber) ? [comment.prNumber] : [] })) : dedupeComments(comments, { useFullBody: options.useFullBody === true });
  const retryMax = options.retryMax ?? DEFAULT_RETRY_MAX;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

  let prompt = buildClassificationPrompt({ comments: commentsForPrompt, useFullBody: options.useFullBody === true });
  let text = await callLlmWithRetry({ provider: options.provider, baseUrl: options.baseUrl, model: options.model, apiKey, prompt, retryMax, retryBaseMs, fetchImpl });
  let llmPayload;
  try {
    llmPayload = validateLlmPayload(parseLlmJson(text));
  } catch (error) {
    prompt = buildClassificationPrompt({ comments: commentsForPrompt, useFullBody: options.useFullBody === true, strict: true });
    text = await callLlmWithRetry({ provider: options.provider, baseUrl: options.baseUrl, model: options.model, apiKey, prompt, retryMax, retryBaseMs, fetchImpl });
    llmPayload = validateLlmPayload(parseLlmJson(text));
  }

  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const files = {
    outputDir,
    jsonPath: path.join(outputDir, DEFAULT_JSON_NAME),
    markdownPath: path.join(outputDir, DEFAULT_MARKDOWN_NAME),
  };
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    provider: options.provider,
    model: options.model,
    inputPath,
    mode: options.useFullBody === true ? "full-body" : "excerpt",
    dedup: options.dedup !== false,
    totalComments: comments.length,
    dedupedComments: commentsForPrompt.length,
    clusters: llmPayload.clusters,
    unclustered: llmPayload.unclustered,
    summary: {
      ...llmPayload.summary,
      totalCommentsProcessed: commentsForPrompt.length,
      totalOriginalComments: comments.length,
      totalClustersFound: llmPayload.clusters.length,
    },
    commentAssignments: llmPayload.commentAssignments,
    personaCandidates: buildPersonaCandidates(llmPayload.clusters, options.model),
    inputComments: commentsForPrompt.map((comment, index) => ({
      commentIndex: index + 1,
      prNumber: comment.prNumber,
      path: comment.path,
      line: comment.line,
      htmlUrl: comment.htmlUrl,
      excerpt: comment.excerpt,
      occurrenceCount: comment.occurrenceCount ?? 1,
      duplicatePrNumbers: comment.duplicatePrNumbers ?? [],
    })),
    files,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(files.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(files.markdownPath, renderReport(result), "utf8");

  return result;
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const options = parseClassifyUncategorizedCliArgs(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }
  const result = await classifyUncategorizedComments(options, { env, fetchImpl });
  stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectCliRun(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${formatCliError(error, { usage: USAGE })}\n`);
    process.exitCode = 1;
  });
}

export {
  DEFAULT_INPUT_NAME,
  DEFAULT_JSON_NAME,
  DEFAULT_MARKDOWN_NAME,
  DEFAULT_PROVIDER,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX,
  FALLBACK_SUMMARY_NAME,
};

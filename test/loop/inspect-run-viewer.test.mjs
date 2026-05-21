import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import test from "node:test";

import {
  createInspectRunViewerServer,
  formatInspectRunViewerUrl,
  parseInspectRunViewerCliArgs,
  renderInspectRunViewerHtml,
} from "../../scripts/loop/inspect-run-viewer.mjs";
import { createInspectionViewerAdapter } from "../../scripts/loop/_inspect-run-viewer-adapter.mjs";

function makeSnapshot(overrides = {}) {
  return {
    ok: true,
    schemaVersion: 1,
    target: { repo: "owner/repo", pr: 55 },
    runId: "pr-55",
    inspectedAt: "2026-05-21T00:00:00.000Z",
    activeStateFamily: "copilot-pr-outer-loop",
    outerAction: "continue_wait",
    activeFamilyState: "continue_wait",
    statusClass: "waiting",
    needsAttention: false,
    sourceMode: "live-detector-backed",
    trust: "authoritative",
    evidence: { summary: "Live detectors agree.", authoritative: ["live"], checkpoint: [] },
    markers: { missing: [], stale: [], conflicts: [] },
    layers: {
      copilot: { currentState: "waiting_for_copilot_review" },
      reviewer: { currentState: "waiting_for_author_followup", scope: { mode: "all_reviewers", reviewerLogin: null } },
      steering: { status: "unavailable", reason: "no_steering_locator" },
    },
    ...overrides,
  };
}

test("parseInspectRunViewerCliArgs normalizes target values and rejects malformed input with usage", () => {
  const parsed = parseInspectRunViewerCliArgs(["--repo", "  owner/repo  ", "--pr", "55"]);
  assert.equal(parsed.repo, "owner/repo");
  assert.equal(parsed.pr, 55);

  let malformedTargetError;
  try {
    parseInspectRunViewerCliArgs(["--repo", "../../bad", "--pr", "55"]);
  } catch (error) {
    malformedTargetError = error;
  }
  assert.ok(malformedTargetError instanceof Error);
  assert.match(malformedTargetError.message, /Invalid repository slug|owner\/name|Repository slug/i);
  assert.equal(typeof malformedTargetError.usage, "string");
  assert.ok(malformedTargetError.usage.length > 0);

  assert.throws(
    () => parseInspectRunViewerCliArgs([
      "--repo",
      "owner/repo",
      "--pr",
      "55",
      "--reviewer-login",
      "reviewer",
      "--reviewer-input",
      "tmp/reviewer.json",
    ]),
    /cannot be combined/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--reviewer-login", "   "]),
    /must not be empty/i,
  );
  assert.throws(
    () => parseInspectRunViewerCliArgs(["--repo", "owner/repo", "--pr", "55", "--host", "   "]),
    /--host must not be empty/i,
  );
});

test("formatInspectRunViewerUrl formats IPv4 and IPv6 hosts for copy-pasteable output", () => {
  assert.equal(formatInspectRunViewerUrl("127.0.0.1", 4311), "http://127.0.0.1:4311");
  assert.equal(formatInspectRunViewerUrl("::1", 4311), "http://[::1]:4311");
});

test("renderInspectRunViewerHtml renders required top-level fields for authoritative snapshot", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot(),
  });

  assert.match(html, /Read-only run viewer/);
  assert.match(html, /target\.repo/);
  assert.match(html, /owner\/repo/);
  assert.match(html, /target\.pr/);
  assert.match(html, /55/);
  assert.match(html, /runId/);
  assert.match(html, /pr-55/);
  assert.match(html, /inspectedAt/);
  assert.match(html, /activeStateFamily/);
  assert.match(html, /outerAction/);
  assert.match(html, /activeFamilyState/);
  assert.match(html, /statusClass/);
  assert.match(html, /needsAttention/);
  assert.match(html, /sourceMode/);
  assert.match(html, /trust/);
  assert.match(html, /evidence\.summary/);
  assert.match(html, /markers\.missing/);
  assert.match(html, /markers\.stale/);
  assert.match(html, /markers\.conflicts/);
  assert.match(html, /outer-loop summary/);
  assert.match(html, /copilot layer/);
  assert.match(html, /reviewer layer/);
  assert.match(html, /steering summary/);
});

test("renderInspectRunViewerHtml renders checkpoint-only / degraded cues and absent sections", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      sourceMode: "checkpoint-only",
      trust: "checkpoint",
      needsAttention: true,
      outerAction: "unknown",
      activeFamilyState: "unknown",
      statusClass: "unknown",
      layers: {
        steering: { status: "unavailable", reason: "no_steering_file" },
      },
    }),
  });

  assert.match(html, /checkpoint-only/);
  assert.match(html, /not present \/ unavailable/);
  assert.match(html, /no_steering_file/);
});

test("renderInspectRunViewerHtml renders conflicting snapshot cues", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "owner/repo", pr: 55 },
    snapshot: makeSnapshot({
      needsAttention: true,
      markers: {
        missing: [],
        stale: [],
        conflicts: ["checkpoint outerAction 'continue_wait' differs from live-derived 'reenter_copilot_loop'"],
      },
    }),
  });

  assert.match(html, /Snapshot state:[\s\S]*conflicting/);
  assert.match(html, /checkpoint outerAction/);
});

test("renderInspectRunViewerHtml renders unavailable snapshot and malformed target load errors explicitly", () => {
  const html = renderInspectRunViewerHtml({
    target: { repo: "bad target", pr: "x" },
    snapshot: null,
    error: new Error("target.pr must be a positive integer"),
  });

  assert.match(html, /Snapshot unavailable/);
  assert.match(html, /target\.pr must be a positive integer/);
  assert.match(html, /manual reload only/i);
});

test("createInspectionViewerAdapter loadSnapshot validates target deterministically", async () => {
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "owner/repo", pr: "nope" }),
    /positive integer/,
  );
  await assert.rejects(
    () => adapter.loadSnapshot({ repo: "../../bad", pr: 55 }),
    /target\.repo must match <owner\/name>/,
  );
});

test("createInspectionViewerAdapter keeps normalized target authoritative over options", async () => {
  let inspectRunCall;
  const adapter = createInspectionViewerAdapter({
    inspectRunImpl: async (input) => {
      inspectRunCall = input;
      return { ok: true };
    },
  });

  await adapter.loadSnapshot(
    { repo: "owner/repo", pr: "55" },
    { repo: "other/repo", pr: 99, reviewerLogin: "reviewer" },
  );

  assert.deepEqual(inspectRunCall, {
    repo: "owner/repo",
    pr: 55,
    reviewerLogin: "reviewer",
  });
});

test("createInspectRunViewerServer serves browser html from adapter snapshot", async () => {
  const adapter = {
    async loadSnapshot() {
      return makeSnapshot({ sourceMode: "partial", trust: "degraded" });
    },
  };

  const server = createInspectRunViewerServer(
    { repo: "owner/repo", pr: "55", host: "127.0.0.1", port: 0 },
    { adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const body = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}`, (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += String(chunk);
        });
        response.on("end", () => resolve(text));
      }).on("error", reject);
    });

    assert.match(body, /Read-only run viewer/);
    assert.match(body, /owner\/repo/);
    assert.match(body, /degraded/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRACKER_SPEC_FORMAT,
  detectTrackerSpecFormat,
  isSpecBearingIssueBody,
  normalizeTrackerSpec,
  trackerBackedStartupReads,
  generateThinPhaseDoc,
} from "../src/loop/tracker-spec-resolution.mjs";

const SPEC_BEARING_BODY = `## Summary

Define a durable hand-off contract for workflow-run subagents.

## Problem

When a coordinator hands off a workflow run to a subagent, the task summary often collapses the gate pipeline into shorthand.

## Desired behavior

Every hand-off must include the full gate sequence explicitly.

## Scope

In scope:
- define the canonical hand-off contract
- require the full gate/review ordering
- add regression test

Out of scope:
- changing the gate contracts themselves

## Acceptance criteria

- there is a named, durable contract
- the contract mandates the full gate sequence
- regression coverage`;

const NON_SPEC_BODY = "Just a quick note, nothing structured here.";

describe("detectTrackerSpecFormat", () => {
  it("recognizes GitHub issue reference owner/repo#N", () => {
    const result = detectTrackerSpecFormat("mfittko/pi-dev-loops#294");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.GITHUB_ISSUE);
    assert.equal(result.owner, "mfittko");
    assert.equal(result.repo, "pi-dev-loops");
    assert.equal(result.number, "294");
  });

  it("recognizes bare GitHub issue reference #N", () => {
    const result = detectTrackerSpecFormat("#301");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.GITHUB_ISSUE);
    assert.equal(result.owner, undefined);
    assert.equal(result.repo, undefined);
    assert.equal(result.number, "301");
  });

  it("recognizes full GitHub URL", () => {
    const result = detectTrackerSpecFormat(
      "https://github.com/mfittko/pi-dev-loops/issues/294"
    );
    assert.equal(result.format, TRACKER_SPEC_FORMAT.GITHUB_URL);
    assert.equal(result.owner, "mfittko");
    assert.equal(result.repo, "pi-dev-loops");
    assert.equal(result.number, "294");
  });

  it("recognizes Shortcut story reference sc#1234", () => {
    const result = detectTrackerSpecFormat("sc#1234");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.SHORTCUT_STORY);
    assert.equal(result.number, "1234");
  });

  it("recognizes Shortcut story reference sc-5678", () => {
    const result = detectTrackerSpecFormat("sc-5678");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.SHORTCUT_STORY);
    assert.equal(result.number, "5678");
  });

  it("recognizes Jira issue reference", () => {
    const result = detectTrackerSpecFormat("PROJ-1234");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.JIRA_ISSUE);
    assert.equal(result.number, "PROJ-1234");
  });

  it("returns unknown for empty string", () => {
    const result = detectTrackerSpecFormat("");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.UNKNOWN);
  });

  it("returns unknown for whitespace-only", () => {
    const result = detectTrackerSpecFormat("   ");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.UNKNOWN);
  });

  it("returns unknown for non-tracker text", () => {
    const result = detectTrackerSpecFormat("just some text");
    assert.equal(result.format, TRACKER_SPEC_FORMAT.UNKNOWN);
  });

  it("returns unknown for non-string input", () => {
    const result = detectTrackerSpecFormat(123);
    assert.equal(result.format, TRACKER_SPEC_FORMAT.UNKNOWN);
  });
});

describe("isSpecBearingIssueBody", () => {
  it("returns true for a body with summary, scope, and acceptance criteria", () => {
    assert.equal(isSpecBearingIssueBody(SPEC_BEARING_BODY), true);
  });

  it("returns false for a short non-structured body", () => {
    assert.equal(isSpecBearingIssueBody(NON_SPEC_BODY), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isSpecBearingIssueBody(""), false);
  });

  it("returns false for whitespace-only", () => {
    assert.equal(isSpecBearingIssueBody("   "), false);
  });

  it("returns false for body under 200 chars even with sections", () => {
    const short = "## Summary\nShort.\n## Scope\nTiny.";
    assert.equal(isSpecBearingIssueBody(short), false);
  });

  it("returns false for body over 200 chars but only one section", () => {
    const oneSection =
      "## Summary\n" +
      "A".repeat(200) +
      "\nJust a long summary with no other sections.";
    assert.equal(isSpecBearingIssueBody(oneSection), false);
  });

  it("returns false for non-string input", () => {
    assert.equal(isSpecBearingIssueBody(null), false);
  });
});

describe("normalizeTrackerSpec", () => {
  const trackerRef = { format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE, owner: "mfittko", repo: "pi-dev-loops", number: "294" };

  it("returns objective from title", () => {
    const result = normalizeTrackerSpec({
      title: "Test issue",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.equal(result.objective, "Test issue");
  });

  it("defaults objective to Untitled when title is empty", () => {
    const result = normalizeTrackerSpec({
      title: "",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.equal(result.objective, "Untitled");
  });

  it("has specBearing=true for structured body", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.equal(result.specBearing, true);
  });

  it("has specBearing=false for non-structured body", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: NON_SPEC_BODY,
      trackerRef,
    });
    assert.equal(result.specBearing, false);
  });

  it("preserves rawBody and trackerRef", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.equal(result.rawBody, SPEC_BEARING_BODY);
    assert.deepEqual(result.trackerRef, trackerRef);
  });

  it("extracts summary section", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.ok(result.summary.includes("Define a durable hand-off contract"));
    assert.ok(!result.summary.includes("## Problem"));
  });

  it("extracts scope section", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.ok(result.scope.includes("In scope"));
    assert.ok(result.scope.includes("define the canonical hand-off contract"));
  });

  it("extracts acceptance criteria section", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: SPEC_BEARING_BODY,
      trackerRef,
    });
    assert.ok(result.acceptanceCriteria.includes("named, durable contract"));
  });

  it("handles body with no sections gracefully", () => {
    const result = normalizeTrackerSpec({
      title: "Test",
      body: "Just some text with no headings at all.",
      trackerRef,
    });
    assert.equal(result.summary, "Just some text with no headings at all.");
    assert.equal(result.scope, "Not specified");
    assert.equal(result.acceptanceCriteria, "Not specified");
  });
});

describe("trackerBackedStartupReads", () => {
  it("returns required and optional arrays", () => {
    const reads = trackerBackedStartupReads();
    assert.ok(Array.isArray(reads.required));
    assert.ok(Array.isArray(reads.optional));
    assert.ok(reads.required.length > 0);
  });

  it("required includes the tracker issue body", () => {
    const reads = trackerBackedStartupReads();
    const hasIssueBody = reads.required.some((r) =>
      r.includes("tracker issue body") || r.includes("canonical spec")
    );
    assert.equal(hasIssueBody, true);
  });

  it("optional includes AGENTS.md", () => {
    const reads = trackerBackedStartupReads();
    const hasAgents = reads.optional.some((r) => r.includes("AGENTS.md"));
    assert.equal(hasAgents, true);
  });
});

describe("generateThinPhaseDoc", () => {
  it("generates a thin pointer for GitHub issues", () => {
    const doc = generateThinPhaseDoc({
      phase: "phase-9",
      trackerRef: {
        format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE,
        owner: "mfittko",
        repo: "pi-dev-loops",
        number: "294",
      },
      title: "Tracker-backed local implementation",
    });

    assert.ok(doc.includes("# phase-9 durable plan"));
    assert.ok(doc.includes("## Status"));
    assert.ok(doc.includes("planning"));
    assert.ok(doc.includes("## Tracker reference"));
    assert.ok(doc.includes("GitHub issue [#294]"));
    assert.ok(doc.includes("Tracker-backed local implementation"));
    assert.ok(doc.includes("The issue body is the canonical spec. This file is a thin pointer."));
    assert.ok(doc.includes("tmp/phases/phase-9/"));
  });

  it("generates a thin pointer for GitHub URLs", () => {
    const doc = generateThinPhaseDoc({
      phase: "phase-10",
      trackerRef: {
        format: TRACKER_SPEC_FORMAT.GITHUB_URL,
        owner: "mfittko",
        repo: "pi-dev-loops",
        number: "301",
        url: "https://github.com/mfittko/pi-dev-loops/issues/301",
      },
      title: "Hand-off contract",
    });

    assert.ok(doc.includes("GitHub issue [#301]"));
    assert.ok(doc.includes("Hand-off contract"));
  });

  it("generates a thin pointer for non-GitHub trackers", () => {
    const doc = generateThinPhaseDoc({
      phase: "phase-11",
      trackerRef: {
        format: TRACKER_SPEC_FORMAT.SHORTCUT_STORY,
        number: "1234",
      },
      title: "Shortcut story",
    });

    assert.ok(doc.includes("phase-11"));
    assert.ok(doc.includes("1234 — Shortcut story"));
  });

  it("does not include a URL when trackerRef has no owner/repo", () => {
    const doc = generateThinPhaseDoc({
      phase: "phase-12",
      trackerRef: {
        format: TRACKER_SPEC_FORMAT.GITHUB_ISSUE,
        number: "500",
      },
      title: "Bare issue",
    });

    // Without owner/repo, renders as plain text (no link, no brackets)
    assert.ok(doc.includes("GitHub issue #500"));
    // Should not include a malformed URL
    assert.ok(!doc.includes("github.com/undefined"));
  });
});

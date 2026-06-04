import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const templatePath = path.resolve("skills/docs/workflow-handoff-template.md");

let templateContent = null;

async function readTemplate() {
  if (templateContent === null) {
    templateContent = await readFile(templatePath, "utf8");
  }
  return templateContent;
}

test("workflow-handoff-template exists and is non-empty", async () => {
  const content = await readTemplate();
  assert.ok(content.length > 100, "template should have substantial content");
});

test("workflow-handoff-template includes all 8 mandatory steps in order", async () => {
  const content = await readTemplate();

  // Scope to the mandatory sequence section only
  const seqStart = content.indexOf("## Mandatory sequence");
  const nextSection = content.indexOf("## Non-negotiable");
  const sequenceSection = content.slice(seqStart, nextSection);

  const stepPatterns = [
    /### 1\. Create draft PR/i,
    /### 2\. Draft gate inspection/i,
    /### 3\. Mark ready for review/i,
    /### 4\. Wait for Copilot review/i,
    /### 5\. Address Copilot feedback/i,
    /### 6\. Re-request Copilot review/i,
    /### 7\. Pre-approval gate inspection/i,
    /### 8\. Merge/i,
  ];

  let lastIndex = -1;
  for (const pattern of stepPatterns) {
    const match = pattern.exec(sequenceSection);
    assert.ok(match, `missing step matching: ${pattern}`);
    assert.ok(
      match.index > lastIndex,
      `step "${pattern}" appears out of order (index ${match.index}, previous at ${lastIndex})`,
    );
    lastIndex = match.index;
  }
});

test("workflow-handoff-template references required contract docs by path", async () => {
  const content = await readTemplate();

  const requiredRefs = [
    "../../docs/gate-review-comment-contract.md",
    "../copilot-pr-followup/SKILL.md",
    "../../scripts/README.md",
  ];

  for (const ref of requiredRefs) {
    assert.ok(
      content.includes(ref),
      `template must reference "${ref}"`,
    );
  }
});

test("workflow-handoff-template requires self-assigned draft PR creation in the mandatory sequence", async () => {
  const content = await readTemplate();

  const seqStart = content.indexOf("## Mandatory sequence");
  const nextSection = content.indexOf("## Non-negotiable", seqStart);

  assert.ok(seqStart >= 0, "mandatory sequence section should exist");
  assert.ok(nextSection > seqStart, "non-negotiable section should follow mandatory sequence");

  const sequenceSection = content.slice(seqStart, nextSection);

  assert.match(sequenceSection, /node scripts\/github\/create-draft-pr\.mjs --assignee @me/i);
  assert.doesNotMatch(sequenceSection, /gh pr create --draft --assignee @me/i);
});

test("workflow-handoff-template has Copilot review loop between draft_gate and pre_approval_gate", async () => {
  const content = await readTemplate();

  // Scope to the mandatory sequence section
  const seqStart = content.indexOf("## Mandatory sequence");
  const nextSection = content.indexOf("## Non-negotiable");
  const sequenceSection = content.slice(seqStart, nextSection);

  const draftGateIndex = sequenceSection.indexOf("draft_gate");
  const preApprovalGateIndex = sequenceSection.indexOf("pre_approval_gate");
  const copilotReviewIndex = sequenceSection.indexOf("Copilot review");

  assert.ok(draftGateIndex >= 0, "template must mention draft_gate");
  assert.ok(preApprovalGateIndex >= 0, "template must mention pre_approval_gate");
  assert.ok(copilotReviewIndex >= 0, "template must mention Copilot review");
  assert.ok(
    draftGateIndex < copilotReviewIndex,
    "Copilot review must appear after draft_gate in mandatory sequence",
  );
  assert.ok(
    copilotReviewIndex < preApprovalGateIndex,
    "Copilot review must appear before pre_approval_gate in mandatory sequence",
  );
});

test("workflow-handoff-template requires unresolvedThreadCount === 0 verification", async () => {
  const content = await readTemplate();

  assert.ok(
    content.includes("unresolvedThreadCount === 0"),
    "template must explicitly require unresolvedThreadCount === 0 verification",
  );
});

test("workflow-handoff-template includes non-negotiable invariants section", async () => {
  const content = await readTemplate();

  assert.ok(
    /non-negotiable invariants/i.test(content),
    "template must have a non-negotiable invariants section",
  );
  assert.ok(
    /Copilot review loop.*between.*draft_gate.*pre_approval_gate/i.test(content) ||
    /between.*draft_gate.*pre_approval_gate/i.test(content),
    "invariants must state Copilot review loop sits between draft_gate and pre_approval_gate",
  );
});

test("unresolvedThreadCount === 0 appears before pre_approval_gate in mandatory sequence", async () => {
  const content = await readTemplate();

  const seqStart = content.indexOf("## Mandatory sequence");
  const nextSection = content.indexOf("## Non-negotiable");
  const sequenceSection = content.slice(seqStart, nextSection);

  const unresolvedIndex = sequenceSection.indexOf("unresolvedThreadCount === 0");
  const preApprovalIndex = sequenceSection.indexOf("### 7. Pre-approval gate inspection");

  assert.ok(unresolvedIndex >= 0, "unresolvedThreadCount === 0 must appear in mandatory sequence");
  assert.ok(preApprovalIndex >= 0, "pre_approval_gate step must exist in mandatory sequence");
  assert.ok(
    unresolvedIndex < preApprovalIndex,
    "unresolvedThreadCount === 0 verification must appear before pre_approval_gate step",
  );
});

test("workflow-handoff-template includes the persistence rule and timeout escalation", async () => {
  const content = await readTemplate();

  assert.match(
    content,
    /PERSISTENCE RULE: Do not exit your session until the PR is merged or you hit a hard stop that requires conductor authorization\./i,
  );
  assert.match(
    content,
    /watch → detect → if threads found, fix \+ reply \+ resolve → re-request → watch again/i,
  );
  assert.match(content, /30 minutes[\s\S]*1800000/i);
  assert.match(
    content,
    /watch timeout\s+[—-]\s+PR #<number> needs manual attention/i,
  );
});


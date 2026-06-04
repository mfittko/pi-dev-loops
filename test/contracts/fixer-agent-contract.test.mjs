import { assert, readRepo, test } from "../imported-assets-helpers.mjs";

test("fixer agent does not re-request Copilot; returns control after reply-resolve", async () => {
  const content = await readRepo("agents/fixer.agent.md");

  assert.doesNotMatch(
    content,
    /explicitly request Copilot review again/i,
    "fixer agent must not contain instruction to re-request Copilot review"
  );
  assert.doesNotMatch(
    content,
    /request-copilot-review\.mjs/i,
    "fixer agent must not reference request-copilot-review.mjs"
  );
  assert.doesNotMatch(
    content,
    /If that re-requested Copilot pass posts fresh review comments/i,
    "fixer must not loop on re-requested Copilot reviews"
  );
  assert.match(
    content,
    /return control to the caller/i,
    "fixer must hand control back to the caller"
  );
  assert.match(
    content,
    /Do not re-request Copilot review/i,
    "fixer must explicitly forbid re-requesting Copilot"
  );
});

test("fixer procedure returns control after fix → push → reply → resolve", async () => {
  const content = await readRepo("agents/fixer.agent.md");

  assert.doesNotMatch(
    content,
    /If the workflow expects another Copilot pass/i,
    "fixer must not conditionally re-request Copilot"
  );
  assert.match(
    content,
    /reply.*resolve/i,
    "fixer must still handle reply and resolve for addressed threads"
  );
});

test("fixer agent description reflects four-step scope without re-request", async () => {
  const content = await readRepo("agents/fixer.agent.md");

  assert.match(
    content,
    /narrow fix.*verify.*push.*reply.*resolve/i,
    "fixer description must describe fix → verify → push → reply → resolve without re-request"
  );
});

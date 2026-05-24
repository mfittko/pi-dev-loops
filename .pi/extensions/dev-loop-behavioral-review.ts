/**
 * dev-loop-behavioral-review
 *
 * Automatically triggers a brief behavioral review after every async dev-loop
 * run completes. The review checks whether the loop followed the working
 * agreement, notes where it drifted, and records any corrections needed
 * before the next loop starts.
 *
 * Activation: fires when a user-visible "Background task completed: dev-loop"
 * message arrives, which is the standard async-subagent delivery format.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REVIEW_PROMPT = `
Run a brief behavioral review of the dev-loop run that just completed.

Check:
- Did it follow the working agreement (test-first, honest validation, proper thread resolution, no dangerous git history rewrites)?
- Did it stay in dev mode as expected?
- What did it get right?
- Where did it drift or skip a step?
- Any corrections needed before the next loop starts?

Keep it concise and honest — this is not a formality.
`.trim();

function isDevLoopCompletion(content: unknown): boolean {
  if (typeof content !== "string") return false;
  return (
    content.includes("Background task completed") &&
    content.includes("dev-loop")
  );
}

export default function devLoopBehavioralReview(pi: ExtensionAPI) {
  pi.on("agent_end", async (event, _ctx) => {
    const messages = event.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    const trigger = messages[0];
    if (
      trigger?.role === "user" &&
      isDevLoopCompletion(
        Array.isArray(trigger.content)
          ? trigger.content.map((c: { text?: string }) => c.text ?? "").join("")
          : trigger.content
      )
    ) {
      pi.sendUserMessage(REVIEW_PROMPT);
    }
  });
}

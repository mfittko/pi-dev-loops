import test from "node:test";
import assert from "node:assert/strict";

import registerExtension from "../extension/index.ts";
import {
  POST_MERGE_UPDATE_COMMAND,
  TARGET_REPO_SLUG,
  createPostMergeUpdateHook,
  isMergeCapableCommand,
  normalizeGitHubRepoSlug,
} from "../extension/post-merge-update.ts";

function createUiCalls() {
  const notifications = [];
  return {
    notifications,
    ctx: {
      hasUI: true,
      cwd: "/repo",
      ui: {
        notify(message, level = "info") {
          notifications.push({ message, level });
        },
        setStatus() {},
        setWidget() {},
      },
    },
  };
}

function createPiDouble() {
  const events = new Map();
  const registeredCommands = new Map();
  return {
    on(event, handler) {
      events.set(event, handler);
    },
    registerCommand(name, config) {
      registeredCommands.set(name, config);
    },
    events,
    registeredCommands,
  };
}

test("normalizeGitHubRepoSlug recognizes GitHub remote variants", () => {
  assert.equal(normalizeGitHubRepoSlug("git@github.com:mfittko/pi-dev-loops.git"), TARGET_REPO_SLUG);
  assert.equal(normalizeGitHubRepoSlug("https://github.com/mfittko/pi-dev-loops.git"), TARGET_REPO_SLUG);
  assert.equal(normalizeGitHubRepoSlug("git@github.com:Mfittko/Pi-Dev-Loops.git"), TARGET_REPO_SLUG);
  assert.equal(normalizeGitHubRepoSlug("ssh://git@github.com/mfittko/pi-dev-loops.git"), TARGET_REPO_SLUG);
  assert.equal(normalizeGitHubRepoSlug("git:github.com/mfittko/pi-dev-loops"), TARGET_REPO_SLUG);
  assert.equal(normalizeGitHubRepoSlug("https://gitlab.com/mfittko/pi-dev-loops.git"), null);
});

test("isMergeCapableCommand only matches bounded merge commands", () => {
  assert.equal(isMergeCapableCommand("gh pr merge 373 --squash --delete-branch"), true);
  assert.equal(isMergeCapableCommand("git merge origin/main"), true);
  assert.equal(isMergeCapableCommand("npm test && gh pr merge 373"), true);
  assert.equal(isMergeCapableCommand("git merge --abort"), false);
  assert.equal(isMergeCapableCommand("git merge --continue"), false);
  assert.equal(isMergeCapableCommand("git merge --quit"), false);
  assert.equal(isMergeCapableCommand("git merge-base HEAD origin/main"), false);
  assert.equal(isMergeCapableCommand("git merge-tree HEAD origin/main"), false);
  assert.equal(isMergeCapableCommand("git status"), false);
  assert.equal(isMergeCapableCommand("echo gh pr merge"), false);
});

test("successful bash-tool gh pr merge queues and flushes one post-merge update on agent_end", async () => {
  const calls = [];
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      return { code: 0, stdout: "updated", stderr: "", killed: false };
    },
  });
  const { ctx, notifications } = createUiCalls();

  await hook.onToolResult({
    toolName: "bash",
    input: { command: "gh pr merge 373 --squash --delete-branch" },
    isError: false,
  }, ctx);

  assert.equal(hook.getState().pendingPostMergeUpdate, true);
  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);

  assert.deepEqual(calls, [{ command: POST_MERGE_UPDATE_COMMAND, cwd: "/repo" }]);
  assert.deepEqual(notifications, [
    { message: `Post-merge update running: ${POST_MERGE_UPDATE_COMMAND}`, level: "info" },
    { message: `Post-merge update completed: ${POST_MERGE_UPDATE_COMMAND}`, level: "info" },
  ]);
  assert.equal(hook.getState().pendingPostMergeUpdate, false);

  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);
  assert.equal(calls.length, 1);
});

test("successful user_bash git merge queues and flushes one update", async () => {
  const calls = [];
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      if (command === "git merge origin/main") {
        return { code: 0, stdout: "Already up to date.", stderr: "", killed: false };
      }
      return { code: 0, stdout: "updated", stderr: "", killed: false };
    },
  });
  const { ctx } = createUiCalls();

  const result = await hook.onUserBash({ command: "git merge origin/main", cwd: "/repo" }, ctx);
  assert.deepEqual(result, {
    result: {
      output: "Already up to date.",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    },
  });
  assert.equal(hook.getState().pendingPostMergeUpdate, true);

  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);
  assert.deepEqual(calls, [
    { command: "git merge origin/main", cwd: "/repo" },
    { command: POST_MERGE_UPDATE_COMMAND, cwd: "/repo" },
  ]);
});

test("failed merge commands do not trigger the post-merge update", async () => {
  const calls = [];
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      return { code: 1, stdout: "", stderr: "merge failed", killed: false };
    },
  });
  const { ctx } = createUiCalls();

  const result = await hook.onUserBash({ command: "git merge conflict-branch", cwd: "/repo" }, ctx);
  assert.deepEqual(result, {
    result: {
      output: "merge failed",
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  });
  assert.equal(hook.getState().pendingPostMergeUpdate, false);

  await hook.onToolResult({
    toolName: "bash",
    input: { command: "gh pr merge 373" },
    isError: true,
  }, ctx);
  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);

  assert.deepEqual(calls, [{ command: "git merge conflict-branch", cwd: "/repo" }]);
});

test("non-merge commands and non-target repos never trigger the update", async () => {
  const calls = [];
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: "other/repo" }),
    runCommand: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      return { code: 0, stdout: "ok", stderr: "", killed: false };
    },
  });
  const { ctx } = createUiCalls();

  await hook.onToolResult({ toolName: "bash", input: { command: "git status" }, isError: false }, ctx);
  const result = await hook.onUserBash({ command: "git merge feature", cwd: "/repo" }, ctx);
  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);

  assert.equal(result, undefined);
  assert.deepEqual(calls, []);
  assert.equal(hook.getState().pendingPostMergeUpdate, false);
});


test("repo-resolution failures are swallowed so the hook stays best-effort", async () => {
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async () => {
      throw new Error("git unavailable");
    },
    runCommand: async () => ({ code: 0, stdout: "ok", stderr: "", killed: false }),
  });
  const { ctx } = createUiCalls();

  await hook.onToolResult({ toolName: "bash", input: { command: "gh pr merge 373" }, isError: false }, ctx);
  const result = await hook.onUserBash({ command: "git merge origin/main", cwd: "/repo" }, ctx);

  assert.equal(result, undefined);
  assert.equal(hook.getState().pendingPostMergeUpdate, false);
});

test("multiple merge signals in one turn still run only one update", async () => {
  const calls = [];
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      return { code: 0, stdout: "ok", stderr: "", killed: false };
    },
  });
  const { ctx } = createUiCalls();

  await hook.onToolResult({ toolName: "bash", input: { command: "gh pr merge 373" }, isError: false }, ctx);
  await hook.onToolResult({ toolName: "bash", input: { command: "git merge origin/main" }, isError: false }, ctx);
  assert.equal(hook.getState().pendingPostMergeUpdate, true);

  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);
  assert.deepEqual(calls, [{ command: POST_MERGE_UPDATE_COMMAND, cwd: "/repo" }]);
});

test("update failure is warning-only and leaves the session healthy", async () => {
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async () => ({ code: 1, stdout: "", stderr: "permission denied", killed: false }),
  });
  const { ctx, notifications } = createUiCalls();

  await hook.onToolResult({ toolName: "bash", input: { command: "gh pr merge 373" }, isError: false }, ctx);
  await hook.onAgentEnd({ type: "agent_end", messages: [] }, ctx);

  assert.equal(hook.getState().pendingPostMergeUpdate, false);
  assert.equal(hook.getState().updateInFlight, false);
  assert.deepEqual(notifications, [
    { message: `Post-merge update running: ${POST_MERGE_UPDATE_COMMAND}`, level: "info" },
    { message: "Post-merge update failed (warning only): permission denied", level: "warning" },
  ]);
});

test("session_start resets post-merge hook state and extension registers lifecycle listeners", async () => {
  const pi = createPiDouble();
  const hook = createPostMergeUpdateHook({
    resolveRepoContext: async (cwd) => ({ repoRoot: cwd, repoSlug: TARGET_REPO_SLUG }),
    runCommand: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
  });
  registerExtension(pi, { postMergeUpdateHook: hook });

  assert.equal(typeof pi.events.get("session_start"), "function");
  assert.equal(typeof pi.events.get("tool_result"), "function");
  assert.equal(typeof pi.events.get("user_bash"), "function");
  assert.equal(typeof pi.events.get("agent_end"), "function");
  assert.equal(pi.registeredCommands.has("dev-loops"), true);

  const { ctx } = createUiCalls();
  await pi.events.get("tool_result")({ toolName: "bash", input: { command: "gh pr merge 373" }, isError: false }, ctx);
  assert.equal(hook.getState().pendingPostMergeUpdate, true);

  await pi.events.get("session_start")({}, ctx);
  assert.equal(hook.getState().pendingPostMergeUpdate, false);
});

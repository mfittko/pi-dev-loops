import { parseRepoSlugParts } from "../../packages/core/src/github/repo-slug.mjs";
import { inspectRun } from "./inspect-run.mjs";
import { spawn } from "node:child_process";

function malformedTargetError(message) {
  const error = new Error(message);
  error.code = "MALFORMED_TARGET";
  return error;
}

export function parseGhJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Invalid JSON from gh: ${stdout.trim() || "<empty>"}`);
  }
}

function parsePositivePr(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) {
    return Number(value);
  }

  throw malformedTargetError("target.pr must be a positive integer");
}

export function normalizeInspectionTarget(target) {
  if (target === null || typeof target !== "object") {
    throw malformedTargetError("target must be an object with repo and pr");
  }

  const rawRepo = typeof target.repo === "string" ? target.repo.trim() : "";
  if (rawRepo.length === 0) {
    throw malformedTargetError("target.repo is required");
  }

  try {
    parseRepoSlugParts(rawRepo, { errorMessage: "target.repo must match <owner/name>" });
  } catch (error) {
    throw malformedTargetError(error instanceof Error ? error.message : String(error));
  }

  return {
    repo: rawRepo,
    pr: parsePositivePr(target.pr),
  };
}

export function createInspectionViewerAdapter({ inspectRunImpl = inspectRun, runGhJsonImpl = null } = {}) {
  const runChild = (command, args, env = process.env) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (status, signal) => resolve({
      status,
      signal,
      stdout,
      stderr,
      command,
      args,
    }));
  });

  const runGhJson = async (args, { env = process.env, ghCommand = "gh" } = {}) => {
    if (typeof runGhJsonImpl === "function") {
      return runGhJsonImpl(args, { env, ghCommand });
    }
    const result = await runChild(ghCommand, args, env);
    if (result.status !== 0) {
      throw new Error(`Command failed: ${result.command} ${result.args.join(" ")}\n${result.stderr.trim() || "(no stderr output)"}`);
    }
    return parseGhJsonOutput(result.stdout);
  };

  const toRepoSlug = (repository) => {
    if (repository === null || typeof repository !== "object") {
      return null;
    }
    if (typeof repository.nameWithOwner === "string" && repository.nameWithOwner.trim().length > 0) {
      return repository.nameWithOwner.trim();
    }

    const ownerLogin = typeof repository.owner?.login === "string" ? repository.owner.login.trim() : "";
    const repoName = typeof repository.name === "string" ? repository.name.trim() : "";
    if (ownerLogin.length === 0 || repoName.length === 0) {
      return null;
    }
    return `${ownerLogin}/${repoName}`;
  };

  return {
    async loadSnapshot(target, options = {}) {
      const normalizedTarget = normalizeInspectionTarget(target);
      return inspectRunImpl({ ...options, ...normalizedTarget });
    },
    async listAssignedPullRequests(options = {}) {
      const {
        limit = 50,
        env = process.env,
        ghCommand = "gh",
      } = options;
      const payload = await runGhJson([
        "search",
        "prs",
        "--assignee",
        "@me",
        "--state",
        "open",
        "--limit",
        String(limit),
        "--json",
        "number,title,repository",
      ], { env, ghCommand });
      if (!Array.isArray(payload)) {
        return [];
      }

      const normalized = [];
      for (const item of payload) {
        const repo = toRepoSlug(item?.repository);
        if (repo === null) {
          continue;
        }
        try {
          normalized.push({
            target: normalizeInspectionTarget({ repo, pr: item?.number }),
            title: typeof item?.title === "string" && item.title.trim().length > 0
              ? item.title.trim()
              : null,
          });
        } catch {
          continue;
        }
      }
      return normalized;
    },
  };
}

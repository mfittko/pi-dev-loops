import { parseRepoSlugParts } from "../../packages/core/src/github/repo-slug.mjs";
import { inspectRun } from "./inspect-run.mjs";
import { spawn } from "node:child_process";

const ASSIGNED_PR_LIST_CACHE_TTL_MS = 15_000;
const DEFAULT_UPDATED_WITHIN_DAYS = 7;
const DEFAULT_RESULT_LIMIT = 25;
const MAX_RESULT_LIMIT = 100;
const DEFAULT_PR_STATE = "open";
const DEFAULT_INBOX_MODE = "assignee";

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

function parseUpdatedWithinDays(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_UPDATED_WITHIN_DAYS;
  }
  if (value === "all") {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) {
    return Number(value);
  }
  throw malformedTargetError("updatedWithinDays must be a positive integer or 'all'");
}

function parseResultLimit(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_RESULT_LIMIT;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, MAX_RESULT_LIMIT);
  }
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) {
    return Math.min(Number(value), MAX_RESULT_LIMIT);
  }
  throw malformedTargetError(`limit must be a positive integer <= ${MAX_RESULT_LIMIT}`);
}

function parsePrState(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PR_STATE;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "open" || normalized === "closed" || normalized === "all") {
    return normalized;
  }
  throw malformedTargetError("state must be one of: open, closed, all");
}

function parseInboxMode(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_INBOX_MODE;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "assignee" || normalized === "reviewer" || normalized === "involved") {
    return normalized;
  }
  throw malformedTargetError("mode must be one of: assignee, reviewer, involved");
}

function formatUtcDateDaysAgo(daysAgo, nowMs) {
  const date = new Date(nowMs - (daysAgo * 24 * 60 * 60 * 1000));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function createInspectionViewerAdapter({ inspectRunImpl = inspectRun, runGhJsonImpl = null, nowImpl = () => Date.now() } = {}) {
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

  const assignedPrListCache = new Map();

  return {
    async loadSnapshot(target, options = {}) {
      const normalizedTarget = normalizeInspectionTarget(target);
      return inspectRunImpl({ ...options, ...normalizedTarget });
    },
    async listAssignedPullRequests(options = {}) {
      const {
        repo,
        limit = DEFAULT_RESULT_LIMIT,
        updatedWithinDays = DEFAULT_UPDATED_WITHIN_DAYS,
        state = DEFAULT_PR_STATE,
        mode = DEFAULT_INBOX_MODE,
        env = process.env,
        ghCommand = "gh",
      } = options;

      const repoSlug = typeof repo === "string" ? repo.trim() : "";
      if (repoSlug.length > 0) {
        parseRepoSlugParts(repoSlug, { errorMessage: "repo must match <owner/name>" });
      }

      const normalizedLimit = parseResultLimit(limit);
      const normalizedUpdatedWithinDays = parseUpdatedWithinDays(updatedWithinDays);
      const normalizedState = parsePrState(state);
      const normalizedMode = parseInboxMode(mode);
      const cacheKey = `${ghCommand}::${repoSlug.length > 0 ? repoSlug.toLowerCase() : "all-repos"}::${normalizedMode}::${normalizedState}::${normalizedLimit}::${normalizedUpdatedWithinDays ?? "all"}`;
      const cached = assignedPrListCache.get(cacheKey);
      if (cached && (nowImpl() - cached.cachedAt) <= ASSIGNED_PR_LIST_CACHE_TTL_MS) {
        return cached.payload.map((entry) => ({
          target: { ...entry.target },
          title: entry.title,
          updatedAt: entry.updatedAt,
        }));
      }

      const ghArgs = [
        "search",
        "prs",
      ];

      if (normalizedMode === "assignee") {
        ghArgs.push("--assignee", "@me");
      } else if (normalizedMode === "reviewer") {
        ghArgs.push("--review-requested", "@me");
      } else {
        ghArgs.push("--involves", "@me");
      }

      if (repoSlug.length > 0) {
        ghArgs.push("--repo", repoSlug);
      }

      if (normalizedState !== "all") {
        ghArgs.push("--state", normalizedState);
      }

      ghArgs.push(
        "--sort",
        "updated",
        "--order",
        "desc",
      );

      if (normalizedUpdatedWithinDays !== null) {
        ghArgs.push("--updated", `>=${formatUtcDateDaysAgo(normalizedUpdatedWithinDays, nowImpl())}`);
      }

      ghArgs.push(
        "--limit",
        String(normalizedLimit),
        "--json",
        "number,title,repository,updatedAt",
      );

      const payload = await runGhJson(ghArgs, { env, ghCommand });
      if (!Array.isArray(payload)) {
        return [];
      }

      const normalized = [];
      for (const item of payload) {
        const itemRepo = toRepoSlug(item?.repository);
        if (itemRepo === null) {
          continue;
        }
        try {
          normalized.push({
            target: normalizeInspectionTarget({ repo: itemRepo, pr: item?.number }),
            title: typeof item?.title === "string" && item.title.trim().length > 0
              ? item.title.trim()
              : null,
            updatedAt: typeof item?.updatedAt === "string" && item.updatedAt.trim().length > 0
              ? item.updatedAt.trim()
              : null,
          });
        } catch {
          continue;
        }
      }

      assignedPrListCache.set(cacheKey, {
        cachedAt: nowImpl(),
        payload: normalized.map((entry) => ({
          target: { ...entry.target },
          title: entry.title,
          updatedAt: entry.updatedAt,
        })),
      });
      return normalized;
    },
  };
}

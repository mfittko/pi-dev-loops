import { readFile } from "node:fs/promises";

function normalizeId(value, fallback) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function normalizeBody(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeAuthor(author) {
  if (!author || typeof author !== "object") {
    return {
      login: "",
      type: "System",
      isBot: false,
    };
  }

  const login = typeof author.login === "string" ? author.login.trim() : "";
  const type = typeof author.__typename === "string"
    ? author.__typename.trim()
    : typeof author.type === "string"
      ? author.type.trim()
      : "User";

  return {
    login,
    type,
    isBot: Boolean(author.isBot) || type === "Bot" || login.endsWith("[bot]"),
  };
}

function extractRawComments(thread) {
  if (Array.isArray(thread?.comments)) {
    return thread.comments;
  }

  if (Array.isArray(thread?.comments?.nodes)) {
    return thread.comments.nodes;
  }

  return [];
}

function extractRawThreads(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = [
    payload?.threads,
    payload?.reviewThreads,
    payload?.reviewThreads?.nodes,
    payload?.data?.repository?.pullRequest?.reviewThreads?.nodes,
    payload?.data?.node?.reviewThreads?.nodes,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find review threads in payload");
}

function compareIds(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

export function isActionableComment(comment) {
  const body = normalizeBody(comment?.body ?? comment?.bodyText ?? comment?.bodyHTML ?? "");
  const author = normalizeAuthor(comment?.author);

  return body.length > 0 && author.login.length > 0 && author.type !== "System" && !author.isBot;
}

export function isActionableThread(thread) {
  if (Boolean(thread?.isResolved)) {
    return false;
  }

  return extractRawComments(thread).some((comment) => isActionableComment(comment));
}

function normalizeComment(comment, threadId, index) {
  const author = normalizeAuthor(comment?.author);
  const body = normalizeBody(comment?.body ?? comment?.bodyText ?? comment?.bodyHTML ?? "");

  return {
    id: normalizeId(comment?.id ?? comment?.databaseId, `${threadId}:comment-${index + 1}`),
    threadId,
    author,
    body,
    isActionable: body.length > 0 && author.login.length > 0 && author.type !== "System" && !author.isBot,
  };
}

export function parseReviewThreads(payload) {
  const rawThreads = extractRawThreads(payload);
  const comments = [];
  const threads = rawThreads.map((thread, threadIndex) => {
    const threadId = normalizeId(thread?.id ?? thread?.databaseId, `thread-${threadIndex + 1}`);
    const normalizedComments = extractRawComments(thread)
      .map((comment, commentIndex) => normalizeComment(comment, threadId, commentIndex))
      .sort((left, right) => compareIds(left.id, right.id));

    comments.push(...normalizedComments);

    const isResolved = Boolean(thread?.isResolved);
    const actionableCommentIds = isResolved
      ? []
      : normalizedComments
          .filter((comment) => comment.isActionable)
          .map((comment) => comment.id);

    return {
      id: threadId,
      isResolved,
      isActionable: actionableCommentIds.length > 0,
      commentIds: normalizedComments.map((comment) => comment.id),
      actionableCommentIds,
    };
  }).sort((left, right) => compareIds(left.id, right.id));

  const sortedComments = comments.sort((left, right) => {
    const threadOrder = compareIds(left.threadId, right.threadId);
    return threadOrder === 0 ? compareIds(left.id, right.id) : threadOrder;
  });

  return {
    summary: {
      totalThreads: threads.length,
      unresolvedThreads: threads.filter((thread) => !thread.isResolved).length,
      actionableThreads: threads.filter((thread) => thread.isActionable).length,
      actionableComments: threads.reduce((count, thread) => count + thread.actionableCommentIds.length, 0),
    },
    threads,
    comments: sortedComments,
  };
}

function requireOptionValue(args, flag) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    inputPath: undefined,
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--input") {
      options.inputPath = requireOptionValue(args, "--input");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

export async function readInput({ inputPath, stdin = process.stdin } = {}) {
  if (inputPath) {
    return readFile(inputPath, "utf8");
  }

  let input = "";
  for await (const chunk of stdin) {
    input += chunk;
  }

  if (input.trim().length === 0) {
    throw new Error("Expected review-thread JSON via --input <path> or stdin");
  }

  return input;
}

export function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON input");
  }
}

export function formatCliError(error) {
  return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stdin = process.stdin,
    stdout = process.stdout,
  } = {},
) {
  const options = parseCliArgs(argv);
  const text = await readInput({ inputPath: options.inputPath, stdin });
  const result = parseReviewThreads(parseJsonText(text));
  stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

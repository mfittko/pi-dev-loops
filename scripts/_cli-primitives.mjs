import { spawn } from "node:child_process";

function toCliError(message, parseError) {
  if (typeof parseError === "function") {
    return parseError(message);
  }

  return new Error(message);
}

export function requireOptionValue(args, flag, parseError = null, { flagPattern = /^--/u } = {}) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || flagPattern.test(value)) {
    throw toCliError(`Missing value for ${flag}`, parseError);
  }

  return value;
}

export function parsePositiveInteger(value, flag, parseError = null) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw toCliError(`${flag} must be a positive integer`, parseError);
  }

  return Number(value);
}

export function parseNonNegativeInteger(value, flag, parseError = null) {
  if (!/^\d+$/.test(value)) {
    throw toCliError(`${flag} must be a non-negative integer`, parseError);
  }

  return Number(value);
}

export function parsePrNumber(value, parseError = null) {
  return parsePositiveInteger(value, "--pr", parseError);
}

export function parseIssueNumber(value, parseError = null) {
  return parsePositiveInteger(value, "--issue", parseError);
}

export function runChild(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim().length > 0 ? stderr.trim() : `${command} exited with code ${code}`));
    });
  });
}

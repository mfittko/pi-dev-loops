import { spawn } from "node:child_process";

function toCliError(message, parseError) {
  if (typeof parseError === "function") {
    return parseError(message);
  }

  return new Error(message);
}

export function requireOptionValue(args, flag, parseError = null) {
  const value = args.shift();

  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw toCliError(`Missing value for ${flag}`, parseError);
  }

  return value;
}

export function parsePrNumber(value, parseError = null) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw toCliError("--pr must be a positive integer", parseError);
  }

  return Number(value);
}

export function runChild(command, args, env) {
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

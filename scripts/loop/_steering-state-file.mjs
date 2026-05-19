import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const STATE_FILE_LOCK_TIMEOUT_MS = 5000;
const STATE_FILE_LOCK_RETRY_MS = 50;

export function defaultStateFilePath(runId, cwd = process.cwd()) {
  return path.join(cwd, ".pi", "steering", `${runId}.json`);
}

export async function loadStateFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read steering state file '${filePath}': ${error.message}`);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLockMetadata(lockPath) {
  try {
    const text = await readFile(path.join(lockPath, "owner.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function withStateFileLock(filePath, callback) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + STATE_FILE_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new Error(`Failed to acquire steering state lock '${lockPath}': ${error.message}`);
      }
      if (Date.now() >= deadline) {
        const metadata = await readLockMetadata(lockPath);
        const ownerSuffix = metadata
          ? ` (current lock owner pid=${metadata.pid ?? "unknown"}, acquiredAt=${metadata.acquiredAt ?? "unknown"})`
          : "";
        throw new Error(`Timed out waiting for steering state lock '${lockPath}'${ownerSuffix}. If the owning process crashed, remove the stale lock directory and retry.`);
      }
      await sleep(STATE_FILE_LOCK_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function saveStateFile(filePath, steeringState) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(steeringState, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

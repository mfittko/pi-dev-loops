import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendBashExitOneRecord,
  formatBashExitOneRecord,
  normalizeBashExitOneRecord,
  parseCliArgs,
  truncateText,
} from "./log-bash-exit-1.mjs";

describe("log-bash-exit-1 helper", () => {
  test("truncates long text deterministically", () => {
    expect(truncateText("abcdef", 4)).toBe("abcd…[truncated 2 chars]");
    expect(truncateText("abc", 4)).toBe("abc");
    expect(truncateText(undefined, 4)).toBeUndefined();
  });

  test("normalizes a valid record", () => {
    const record = normalizeBashExitOneRecord({
      timestamp: "2026-05-12T10:00:00Z",
      phase: "phase-0",
      cwd: "/tmp/project",
      command: "npm test",
      exitCode: 1,
      purpose: "validate current failing test state",
      summary: "tests fail because file-image.ts is missing",
      stdout: "ok",
      stderr: "bad",
    });

    expect(record).toEqual({
      timestamp: "2026-05-12T10:00:00Z",
      phase: "phase-0",
      cwd: "/tmp/project",
      command: "npm test",
      exitCode: 1,
      purpose: "validate current failing test state",
      summary: "tests fail because file-image.ts is missing",
      stdout: "ok",
      stderr: "bad",
    });
  });

  test("rejects non-1 exit codes", () => {
    expect(() =>
      normalizeBashExitOneRecord({
        phase: "phase-0",
        cwd: "/tmp/project",
        command: "npm test",
        exitCode: 2,
        purpose: "x",
        summary: "y",
      }),
    ).toThrow(/exitCode must be 1/i);
  });

  test("formats one jsonl line", () => {
    const line = formatBashExitOneRecord({
      timestamp: "2026-05-12T10:00:00Z",
      phase: "phase-0",
      cwd: "/tmp/project",
      command: "npm test",
      exitCode: 1,
      purpose: "validate",
      summary: "failed",
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({
      phase: "phase-0",
      exitCode: 1,
    });
  });

  test("appends a normalized record to jsonl", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-skill-"));
    const logPath = path.join(tempDir, "bash-exit-1.jsonl");

    try {
      await appendBashExitOneRecord(logPath, {
        timestamp: "2026-05-12T10:00:00Z",
        phase: "phase-0",
        cwd: "/tmp/project",
        command: "npm test",
        exitCode: 1,
        purpose: "validate",
        summary: "failed",
      });

      const content = await readFile(logPath, "utf8");
      const [line] = content.trim().split("\n");

      expect(JSON.parse(line)).toEqual({
        timestamp: "2026-05-12T10:00:00Z",
        phase: "phase-0",
        cwd: "/tmp/project",
        command: "npm test",
        exitCode: 1,
        purpose: "validate",
        summary: "failed",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parses cli args", () => {
    expect(parseCliArgs(["--log", "tmp/x.jsonl", "--record", "{}"])) .toEqual({
      logPath: "tmp/x.jsonl",
      recordJson: "{}",
    });
  });

  test("rejects unknown cli args", () => {
    expect(() => parseCliArgs(["--wat"])) .toThrow(/unknown argument/i);
  });
});

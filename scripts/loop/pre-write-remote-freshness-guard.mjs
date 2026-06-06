#!/usr/bin/env node
import { buildParseError, formatCliError, isDirectCliRun } from "../_core-helpers.mjs";
import { requireOptionValue, runCommand } from "../_cli-primitives.mjs";

const USAGE = `Usage: pre-write-remote-freshness-guard.mjs --branch <name>\nRefresh remote branch state before starting local file writes.`;
const parseError = buildParseError(USAGE);

export function parseRemoteFreshnessGuardCliArgs(argv) {
  const args = [...argv], options = { help: false, branch: undefined };
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--help" || token === "-h") { options.help = true; return options; }
    if (token === "--branch") { options.branch = requireOptionValue(args, "--branch", parseError, { flagPattern: /^-/u }); continue; }
    throw parseError(`Unknown argument: ${token}`);
  }
  if (options.branch === undefined) throw parseError("--branch <name> is required");
  return options;
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), env = process.env, gitCommand = "git" } = {}) {
  const options = parseRemoteFreshnessGuardCliArgs(argv);
  if (options.help) { stdout.write(`${USAGE}\n`); return { ok: true, help: true }; }
  await runCommand(gitCommand, ["fetch", "origin", options.branch], { cwd, env });
  const { stdout: logOutput } = await runCommand(gitCommand, ["log", `HEAD..origin/${options.branch}`, "--oneline"], { cwd, env });
  const newCommits = logOutput.split(/\r?\n/u).map(l => l.trim()).filter(l => l.length > 0);
  if (newCommits.length === 0) { const p = { ok: true, status: "up_to_date" }; stdout.write(`${JSON.stringify(p)}\n`); return p; }
  const p = { ok: false, error: "remote_ahead", newCommits }; stderr.write(`${JSON.stringify(p)}\n`); return p;
}

if (isDirectCliRun(import.meta.url)) {
  runCli().then(r => { if (r?.ok === false) process.exitCode = 1; }).catch(e => { process.stderr.write(`${formatCliError(e)}\n`); process.exitCode = 1; });
}

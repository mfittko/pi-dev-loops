/**
 * Shared subcommand runner for standardizing CLI script boilerplate.
 * Extracted per issue #548 Phase 3.
 *
 * Replaces per-script: USAGE string, parseError, arg-parsing loop,
 * removed-flags handling, and direct-invocation boilerplate.
 */

import { buildParseError, isDirectCliRun } from "./helpers.mjs";
import { requireOptionValue, parsePrNumber, parseIssueNumber,
         parsePositiveInteger, parseNonNegativeInteger } from "./primitives.mjs";

/**
 * Option descriptor for defineSubcommand.
 *
 * @typedef {Object} CliOption
 * @property {string} flag       - e.g. "--repo"
 * @property {string} [key]      - override output key name; defaults to dashed→camelCase (e.g. "--head-sha" → "headSha")
 * @property {string} [valueName] - human-readable value name for usage (ignored for boolean flags)
 * @property {string} [description] - help text
 * @property {"string"|"number"|"boolean"|"pr"|"issue"|"positiveInt"|"nonNegativeInt"} [type] - default "string"
 * @property {boolean} [required] - default false
 * @property {*} [default]        - default value
 * @property {string[]} [choices] - allowed values
 * @property {string[]} [removedAliases] - flags that should be rejected with a message
 */

/** Convert a dashed flag name (e.g. "--head-sha") to camelCase (e.g. "headSha"). */
function dashedToCamel(flag) {
  const stem = flag.replace(/^--/, "");
  return stem.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Return the parsed output key for an option. Respects opt.key override. */
function optionKey(opt) {
  if (opt.key) return opt.key;
  return dashedToCamel(opt.flag);
}

/** Render a single option's usage fragment for the generated help text. */
function optionUsageFragment(opt) {
  if (opt.type === "boolean") return opt.flag;
  const vn = opt.valueName || opt.flag.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
  return `${opt.flag} <${vn}>`;
}

/**
 * Define a subcommand with auto-generated usage, arg parsing, and help.
 *
 * @param {Object} def
 * @param {string} def.name        - subcommand name for usage
 * @param {string} def.description - one-line description
 * @param {string} [def.longDescription] - extended help text
 * @param {CliOption[]} def.options - option descriptors
 * @param {Function} def.run       - async (parsed, { args, stdout, stderr }) => exitCode
 * @param {Object} [def.extraUsage] - extra usage lines
 * @param {Object} [def.outputSchema] - stdout JSON schema description
 * @returns {{ parseArgs, runAsScript, usage, parseError }}
 */
export function defineSubcommand(def) {
  const {
    name,
    description,
    longDescription = "",
    options = [],
    run,
    extraUsage = {},
    outputSchema = null,
  } = def;

  // Auto-build usage string
  const requiredOpts = options.filter((o) => o.required);
  const optionalOpts = options.filter((o) => !o.required);

  const usageLines = [`Usage: pi-dev-loops ${name}`];
  for (const opt of requiredOpts) {
    usageLines.push(`  ${optionUsageFragment(opt)}`);
  }
  if (optionalOpts.length > 0) {
    const optStrs = optionalOpts.map((o) => optionUsageFragment(o));
    usageLines.push(`  [${optStrs.join("] [")}]`);
  }

  if (description) usageLines.push("", description);
  if (longDescription) usageLines.push("", longDescription);

  if (requiredOpts.length > 0) {
    usageLines.push("", "Required:");
    for (const opt of requiredOpts) {
      usageLines.push(`  ${optionUsageFragment(opt)}${opt.description ? `    ${opt.description}` : ""}`);
    }
  }

  if (optionalOpts.length > 0) {
    usageLines.push("", "Optional:");
    for (const opt of optionalOpts) {
      usageLines.push(`  ${optionUsageFragment(opt)}${opt.description ? `    ${opt.description}` : ""}`);
    }
  }

  if (extraUsage.before) usageLines.splice(1, 0, ...extraUsage.before);
  if (extraUsage.after) usageLines.push(...extraUsage.after);

  if (outputSchema) {
    usageLines.push("", "Output (stdout, JSON):", JSON.stringify(outputSchema, null, 2));
  }

  const usage = usageLines.join("\n");
  const parseError = buildParseError(usage);

  // Build removed-flags set
  const removedFlags = new Set();
  for (const opt of options) {
    if (opt.removedAliases) {
      for (const alias of opt.removedAliases) removedFlags.add(alias);
    }
  }

  function parseValue(raw, opt) {
    if (raw === undefined) return opt.default;
    switch (opt.type) {
      case "number": case "positiveInt": case "nonNegativeInt": {
        if (opt.type === "positiveInt") return parsePositiveInteger(raw, opt.flag, parseError);
        if (opt.type === "nonNegativeInt") return parseNonNegativeInteger(raw, opt.flag, parseError);
        const n = Number(raw);
        if (isNaN(n)) throw parseError(`${opt.flag} must be a number`);
        return n;
      }
      case "pr": return parsePrNumber(raw, parseError);
      case "issue": return parseIssueNumber(raw, parseError);
      case "boolean": {
        const v = raw.toLowerCase();
        if (v === "true" || v === "1" || v === "yes") return true;
        if (v === "false" || v === "0" || v === "no") return false;
        throw parseError(`${opt.flag} must be true/false`);
      }
      case "string":
      default: {
        const v = raw.trim();
        if (opt.choices && !opt.choices.includes(v)) {
          throw parseError(`${opt.flag} must be one of: ${opt.choices.join(", ")}`);
        }
        return v;
      }
    }
  }

  function parseArgs(argv) {
    const args = [...argv];
    const parsed = {};
    // Initialize defaults for all options
    for (const opt of options) {
      if (opt.default !== undefined) {
        parsed[optionKey(opt)] = opt.default;
      }
    }

    while (args.length > 0) {
      const token = args.shift();

      if (token === "--help" || token === "-h") {
        return { help: true };
      }

      if (removedFlags.has(token)) {
        throw parseError(
          `${token} has been removed. Omit the flag.`,
        );
      }

      const opt = options.find((o) => o.flag === token);
      if (opt) {
        if (opt.type === "boolean") {
          // Boolean flags are presence-only: --flag sets true, no value required.
          parsed[optionKey(opt)] = true;
        } else {
          const raw = requireOptionValue(args, opt.flag, parseError);
          parsed[optionKey(opt)] = parseValue(raw, opt);
        }
        continue;
      }

      throw parseError(`Unknown argument: ${token}`);
    }

    // Check required
    for (const opt of requiredOpts) {
      const key = optionKey(opt);
      if (parsed[key] === undefined) {
        throw parseError(`Missing required option: ${opt.flag}`);
      }
    }

    return { parsed };
  }

  async function runAsScript(scriptArgv = process.argv.slice(2)) {
    try {
      const result = parseArgs(scriptArgv);
      if (result.help) {
        process.stdout.write(`${usage}\n`);
        process.exitCode = 0;
        return;
      }
      const code = await run(result.parsed, { args: scriptArgv, usage });
      process.exitCode = typeof code === "number" ? code : 0;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.usage) {
        process.stderr.write(JSON.stringify({ ok: false, error: msg, usage: error.usage }) + "\n");
      } else {
        process.stderr.write(JSON.stringify({ ok: false, error: msg }) + "\n");
      }
      process.exitCode = 1;
    }
  }

  return { parseArgs, runAsScript, usage, parseError };
}

/**
 * Run a CLI function as the main entrypoint when the module is invoked directly.
 * Handles process.exitCode and error formatting.
 *
 * Usage: replace `if (isDirectCliRun(import.meta.url)) { ... }` with:
 *   if (isDirectCliRun(import.meta.url)) { runAsMain(runCli); }
 *
 * @param {Function} fn - async function returning exit code or void
 * @param {Object} [opts]
 * @param {Function} [opts.formatError] - error formatter (default: JSON.stringify)
 */
export function runAsMain(fn, { formatError } = {}) {
  Promise.resolve(fn()).then(
    (code) => { process.exitCode = typeof code === "number" ? code : 0; },
    (error) => {
      const msg = formatError
        ? formatError(error)
        : JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      process.stderr.write(`${msg}\n`);
      process.exitCode = 1;
    },
  );
}

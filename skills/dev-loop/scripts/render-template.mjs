import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function renderTemplate(template, variables) {
  if (typeof template !== "string") {
    throw new Error("template must be a string");
  }

  return template.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (match, key) => {
    if (!(key in variables)) {
      throw new Error(`Missing template variable: ${key}`);
    }

    return String(variables[key]);
  });
}

export async function materializeTemplate(templatePath, outputPath, variables) {
  const template = await readFile(templatePath, "utf8");
  const content = renderTemplate(template, variables);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  return { templatePath, outputPath, content };
}

export function parseCliArgs(argv) {
  const args = [...argv];
  let templatePath;
  let outputPath;
  let variables = {};

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--template") {
      templatePath = args.shift();
      continue;
    }

    if (token === "--output") {
      outputPath = args.shift();
      continue;
    }

    if (token === "--vars") {
      variables = JSON.parse(args.shift() ?? "{}");
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!templatePath) {
    throw new Error("Missing required --template <path> argument");
  }

  if (!outputPath) {
    throw new Error("Missing required --output <path> argument");
  }

  return { templatePath, outputPath, variables };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const result = await materializeTemplate(options.templatePath, options.outputPath, options.variables);
  process.stdout.write(
    `${JSON.stringify({ ok: true, templatePath: result.templatePath, outputPath: result.outputPath })}\n`,
  );
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeTemplate, parseCliArgs, renderTemplate } from "./render-template.mjs";

describe("render-template helper", () => {
  test("renders placeholders deterministically", () => {
    expect(
      renderTemplate("# Phase {{phase}} variant {{variant}}\n", {
        phase: "phase-0",
        variant: "a",
      }),
    ).toBe("# Phase phase-0 variant a\n");
  });

  test("throws on missing variables", () => {
    expect(() => renderTemplate("Hello {{name}}", {})).toThrow(/missing template variable: name/i);
  });

  test("materializes a template file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-loop-render-template-"));
    const templatePath = path.join(tempDir, "template.md");
    const outputPath = path.join(tempDir, "out", "variant-a.md");

    try {
      await writeFile(templatePath, "# {{phase}}\n{{body}}\n", "utf8");
      await materializeTemplate(templatePath, outputPath, {
        phase: "phase-0",
        body: "hello",
      });

      const output = await readFile(outputPath, "utf8");
      expect(output).toBe("# phase-0\nhello\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parses cli args", () => {
    expect(
      parseCliArgs([
        "--template",
        "templates/x.md",
        "--output",
        "tmp/x.md",
        "--vars",
        '{"phase":"phase-0"}',
      ]),
    ).toEqual({
      templatePath: "templates/x.md",
      outputPath: "tmp/x.md",
      variables: { phase: "phase-0" },
    });
  });

  test("requires template and output args", () => {
    expect(() => parseCliArgs(["--output", "tmp/x.md"])) .toThrow(/missing required --template/i);
    expect(() => parseCliArgs(["--template", "templates/x.md"])) .toThrow(/missing required --output/i);
  });
});

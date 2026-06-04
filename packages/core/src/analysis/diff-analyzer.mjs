/**
 * Diff analysis for dynamic gate angle resolution.
 *
 * T0 — file-level: classifies files by extension and directory.
 * T1 — hunk-level: classifies hunks by change type (comments, imports, config, etc.).
 *
 * T2 (AST-level) is deferred to a follow-up.
 *
 * This module is intentionally pure and side-effect free.
 */

// ---------------------------------------------------------------------------
// T0: File-level analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {object} T0Result
 * @property {string[]} files — flat file paths
 * @property {string[]} extensions — unique file extensions (lowercase, with dot)
 * @property {string[]} directories — unique top-level directories
 * @property {boolean} renameOnly — true when all entries are renames (no adds/deletes/modifies)
 * @property {boolean} allDocs — true when all files are under docs/ or are .md
 */

/**
 * Parse `git diff --name-status` output into a T0 analysis.
 *
 * Each line format: `<status>\t<path>` or `<status>\t<old>\t<new>`.
 *
 * @param {string} nameStatusOutput — raw stdout from `git diff --name-status`
 * @returns {T0Result}
 */
export function analyzeT0(nameStatusOutput) {
  const lines = nameStatusOutput.trim().split("\n").filter(Boolean);
  const files = [];
  const extensions = new Set();
  const directories = new Set();
  let renameCount = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    const status = parts[0];
    const path = parts.length >= 3 ? parts[2] : parts[1];
    if (!path) continue;

    files.push(path);

    const ext = path.includes(".") ? "." + path.split(".").pop().toLowerCase() : "";
    if (ext) extensions.add(ext);

    const dir = path.split("/")[0];
    if (dir) directories.add(dir);

    if (status.startsWith("R")) renameCount++;
  }

  const renameOnly = lines.length > 0 && renameCount === lines.length;
  const allDocs = lines.length > 0 && files.every(
    (f) => f.startsWith("docs/") || f.endsWith(".md") || f === "README.md",
  );

  return {
    files,
    extensions: [...extensions].sort(),
    directories: [...directories].sort(),
    renameOnly,
    allDocs,
  };
}

/**
 * @typedef {"code" | "docs" | "config" | "test" | "ci" | "unknown"} FileCategory
 */

/**
 * Classify a single file path into a high-level category.
 *
 * @param {string} filePath
 * @returns {FileCategory}
 */
export function classifyFile(filePath) {
  if (filePath.startsWith(".github/")) {
    return "ci";
  }
  if (filePath.startsWith("docs/") || filePath.endsWith(".md") || filePath === "README.md") {
    return "docs";
  }
  if (
    filePath.endsWith(".yml") || filePath.endsWith(".yaml") ||
    filePath.endsWith(".json") || filePath === "package.json"
  ) {
    return "config";
  }
  if (filePath.includes(".test.") || filePath.startsWith("test/")) {
    return "test";
  }
  if (
    filePath.endsWith(".mjs") || filePath.endsWith(".js") ||
    filePath.endsWith(".ts") || filePath.endsWith(".mts")
  ) {
    return "code";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// T1: Hunk-level analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {object} T1Result
 * @property {string[]} changeCategories — detected change categories
 * @property {number} hunkCount
 * @property {{ added: number, deleted: number }} lineStats
 */

/**
 * Check whether a diff line content (after stripping the + / - prefix) is
 * a comment, import/export, or blank line — i.e. not logic.
 *
 * @param {string} content — trimmed line content (without + / - prefix)
 * @returns {boolean}
 */
function isNonLogicLine(content) {
  if (content === "") return true;
  if (content.startsWith("//") || content.startsWith("/*") || content.startsWith("*")) return true;
  if (content.startsWith("import ") || content.startsWith("export ")) return true;
  if (content.includes("require(")) return true;
  return false;
}

/**
 * Analyze unified diff hunks to classify change types.
 *
 * Detects:
 * - IMPORT_ONLY: only import/require lines changed
 * - COMMENT_ONLY: only comment lines changed
 * - DOCS_ONLY: only .md files changed (from extensions)
 * - CONFIG_ONLY: only config files changed
 * - TEST_ONLY: only test files changed
 * - RENAME_ONLY: all renames, no content changes
 * - LOGIC_CHANGE: any non-trivial code change
 *
 * @param {string} diffOutput — raw unified diff output
 * @param {T0Result} t0 — T0 result for context
 * @returns {T1Result}
 */
export function analyzeT1(diffOutput, t0) {
  const lines = diffOutput.split("\n");
  let hunkCount = 0;
  let added = 0;
  let deleted = 0;
  const categories = new Set();

  let inHunk = false;
  let hasLogicChange = false;
  let hasAnyChangedLine = false;
  let allChangedLinesAreNonLogic = true;

  for (const line of lines) {
    // Track hunk headers
    if (line.startsWith("@@")) {
      hunkCount++;
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    // Track line stats and classify
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      hasAnyChangedLine = true;
      const content = line.slice(1).trim();
      if (!isNonLogicLine(content)) {
        hasLogicChange = true;
        allChangedLinesAreNonLogic = false;
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deleted++;
      hasAnyChangedLine = true;
      const content = line.slice(1).trim();
      if (!isNonLogicLine(content)) {
        hasLogicChange = true;
        allChangedLinesAreNonLogic = false;
      }
    }
  }

  // Build categories from T0 + hunk analysis
  if (t0.renameOnly) categories.add("RENAME_ONLY");
  if (t0.allDocs) categories.add("DOCS_ONLY");
  if (t0.files.every((f) => classifyFile(f) === "config")) categories.add("CONFIG_ONLY");
  if (t0.files.every((f) => classifyFile(f) === "test")) categories.add("TEST_ONLY");
  if (t0.files.every((f) => classifyFile(f) === "ci")) categories.add("CI_ONLY");
  if (hasLogicChange) categories.add("LOGIC_CHANGE");

  // COMMENT_ONLY: hunkCount > 0 (real diff), has changed lines, all are non-logic,
  // and not a rename-only change
  if (hunkCount > 0 && hasAnyChangedLine && allChangedLinesAreNonLogic && !t0.renameOnly) {
    categories.add("COMMENT_ONLY");
  }

  return {
    changeCategories: [...categories],
    hunkCount,
    lineStats: { added, deleted },
  };
}

// ---------------------------------------------------------------------------
// Combined analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DiffAnalysis
 * @property {T0Result} t0
 * @property {T1Result | null} t1
 * @property {boolean} ambiguous — true when heuristics cannot confidently classify
 */

/**
 * Infer change categories from T0 analysis when T1 is not run.
 *
 * @param {T0Result} t0
 * @returns {string[]}
 */
function inferCategoriesFromT0(t0) {
  const categories = [];
  if (t0.renameOnly) categories.push("RENAME_ONLY");
  if (t0.allDocs) categories.push("DOCS_ONLY");
  if (t0.files.length > 0 && t0.files.every((f) => classifyFile(f) === "config")) categories.push("CONFIG_ONLY");
  if (t0.files.length > 0 && t0.files.every((f) => classifyFile(f) === "test")) categories.push("TEST_ONLY");
  if (t0.files.length > 0 && t0.files.every((f) => classifyFile(f) === "ci")) categories.push("CI_ONLY");
  return categories;
}

/**
 * Run full diff analysis (T0 + T1 if needed).
 *
 * T0 always runs. T1 runs when T0 doesn't produce a clear single-category result.
 * When T1 is not run (unambiguous diff), categories are inferred from T0 so
 * dynamic angle resolution can still narrow the angle list.
 *
 * @param {{ nameStatusOutput: string, diffOutput?: string }} input
 * @returns {DiffAnalysis}
 */
export function analyzeDiff({ nameStatusOutput, diffOutput }) {
  const t0 = analyzeT0(nameStatusOutput);
  let t1 = null;

  // T0 is unambiguous when: renameOnly, allDocs, or single clear category
  const t0Ambiguous = !t0.renameOnly && !t0.allDocs && t0.files.length > 1 &&
    new Set(t0.files.map(classifyFile)).size > 1;

  if (t0Ambiguous && diffOutput) {
    t1 = analyzeT1(diffOutput, t0);
  }

  // When t1 is null (unambiguous diff), infer categories from t0
  // so dynamic angle resolution can narrow for config-only / test-only etc.
  if (!t1) {
    t1 = {
      changeCategories: inferCategoriesFromT0(t0),
      hunkCount: 0,
      lineStats: { added: 0, deleted: 0 },
    };
  }

  const ambiguous = t0Ambiguous && (t1.changeCategories.length === 0 || t1.changeCategories.includes("LOGIC_CHANGE"));

  return { t0, t1, ambiguous };
}

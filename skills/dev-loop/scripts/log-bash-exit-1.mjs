import { pathToFileURL } from "node:url";

export {
  DEFAULT_OUTPUT_LIMIT,
  appendBashExitOneRecord,
  formatBashExitOneRecord,
  normalizeBashExitOneRecord,
  parseCliArgs,
  readRecordFromStdin,
  runCli,
  truncateText,
} from "../../../packages/core/src/bash-exit-one.mjs";

import { runCli } from "../../../packages/core/src/bash-exit-one.mjs";

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

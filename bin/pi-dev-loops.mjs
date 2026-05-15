#!/usr/bin/env node
import { runCli } from "../cli/index.mjs";

process.exitCode = await runCli();

#!/usr/bin/env node
import { runValedictorianCli } from './valedictorian-cli.js';
const exitCode = await runValedictorianCli({
    argv: process.argv.slice(2),
});
process.exitCode = exitCode;

#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(`repo-guard failed: ${error.message}`);
    process.exitCode = 1;
  });

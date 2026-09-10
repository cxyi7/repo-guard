#!/usr/bin/env node

import { runCli } from '../src/orchestration/cli/runner.js';
import { EXIT_CODES, validateExitCode } from '../src/core/result/exit-code.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = validateExitCode(exitCode);
  })
  .catch((error) => {
    console.error(`repo-guard 未能完成执行：${error.message}`);
    process.exitCode = EXIT_CODES.error;
  });

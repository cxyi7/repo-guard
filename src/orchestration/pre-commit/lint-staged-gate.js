import { fileURLToPath } from 'node:url';
import lintStaged from 'lint-staged';
import { loadConfig } from '../../config/configuration-loader.js';
import {
  runStreamingProcess,
  terminalProcessOutput,
} from '../../core/execution/streaming-process.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { findRepositoryRoot } from '../../git/repository.js';

const CLI_PATH = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));

function quoteCommandArgument(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

export async function runQualityGate({ cwd = process.cwd() } = {}) {
  const root = findRepositoryRoot(cwd);
  loadConfig(root);
  const stagedChanges = collectStagedChanges(root);
  const task = [
    quoteCommandArgument(process.execPath),
    quoteCommandArgument(CLI_PATH),
    'quality-files',
  ].join(' ');

  const passed = await lintStaged({
    allowEmpty: false,
    concurrent: false,
    config: {
      '{*,.*}': task,
    },
    cwd: root,
    relative: false,
    stash: true,
    verbose: true,
  });

  if (!passed) return 1;
  if (
    stagedChanges.length > 0
    && stagedChanges.every(({ status }) => status.startsWith('D'))
  ) {
    const deletionResult = await runStreamingProcess({
      command: process.execPath,
      argumentsList: [CLI_PATH, 'quality-files'],
      root,
      timeoutMs: 120000,
      output: terminalProcessOutput(true),
    });
    return deletionResult.status === 0 ? 0 : 1;
  }
  return 0;
}

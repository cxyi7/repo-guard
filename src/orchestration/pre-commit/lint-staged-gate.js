import { fileURLToPath } from 'node:url';
import lintStaged from 'lint-staged';
import { loadConfig } from '../../config/configuration-loader.js';
import { findRepositoryRoot } from '../../git/repository.js';

const CLI_PATH = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));

function quoteCommandArgument(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

export async function runQualityGate({ cwd = process.cwd() } = {}) {
  const root = findRepositoryRoot(cwd);
  loadConfig(root);
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

  return passed ? 0 : 1;
}

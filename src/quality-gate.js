import { fileURLToPath } from 'node:url';
import lintStaged from 'lint-staged';
import { loadConfig } from './config.js';
import { findRepositoryRoot } from './git.js';

const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));

function quoteCommandArgument(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

export async function runQualityGate({ cwd = process.cwd() } = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const eslintConfig = config.preCommit.eslint;

  if (!eslintConfig.enabled) {
    console.log('repo-guard ESLint gate skipped: disabled by project configuration.');
    return 0;
  }

  const task = [
    quoteCommandArgument(process.execPath),
    quoteCommandArgument(CLI_PATH),
    'lint-files',
  ].join(' ');

  const passed = await lintStaged({
    allowEmpty: false,
    concurrent: false,
    config: {
      [eslintConfig.pattern]: task,
    },
    cwd: root,
    relative: false,
    stash: true,
    verbose: true,
  });

  return passed ? 0 : 1;
}

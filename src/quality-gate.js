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
  const prettierConfig = config.preCommit.prettier;
  const stylelintConfig = config.preCommit.stylelint;
  const maxFileLinesConfig = config.preCommit.maxFileLines;

  if (
    !eslintConfig.enabled
    && !prettierConfig.enabled
    && !stylelintConfig.enabled
    && !maxFileLinesConfig.enabled
  ) {
    console.log(
      'repo-guard quality gate skipped: ESLint, Prettier, Stylelint, '
      + 'and maximum file lines are disabled.',
    );
    return 0;
  }

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

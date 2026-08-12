import { loadConfig } from '../config.js';
import { collectProjectFiles } from '../file-placement.js';
import { findRepositoryRoot } from '../git.js';
import { runStyleComplexityProject } from '../stylelint-runner.js';

const STYLE_FILE = /\.(?:css|scss|sass|less|vue)$/i;

export async function runStyleComplexityCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const files = collectProjectFiles(root)
    .filter((file) => STYLE_FILE.test(file));
  return await runStyleComplexityProject({
    root,
    files,
    config: {
      ...config.preCommit.stylelint.complexity,
      enabled: true,
    },
    exceptions: config.exceptions,
  });
}

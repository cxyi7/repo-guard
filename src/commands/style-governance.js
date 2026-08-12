import { loadConfig } from '../config.js';
import { collectProjectFiles } from '../file-placement.js';
import { findRepositoryRoot } from '../git.js';
import { runStyleGovernanceProject } from '../stylelint-runner.js';

const STYLE_FILE = /\.(?:css|scss|sass|less|vue)$/i;

export async function runStyleGovernanceCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const files = collectProjectFiles(root)
    .filter((file) => STYLE_FILE.test(file));
  return await runStyleGovernanceProject({
    root,
    files,
    config: {
      ...config.preCommit.stylelint.governance,
      enabled: true,
    },
    exceptions: config.exceptions,
  });
}

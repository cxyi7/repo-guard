import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runVueTargetBlankProject } from '../vue-target-blank.js';

export function runTargetBlankCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runVueTargetBlankProject({
    root,
    exceptions: config.exceptions,
  });
}

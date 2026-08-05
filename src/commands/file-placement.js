import { loadConfig } from '../config.js';
import { runFilePlacementProject } from '../file-placement.js';
import { findRepositoryRoot } from '../git.js';

export function runFilePlacementCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runFilePlacementProject({
    root,
    config: config.preCommit.filePlacement,
  });
}

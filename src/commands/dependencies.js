import { loadConfig } from '../config.js';
import { runDependencyPolicy } from '../dependency-policy.js';
import { findRepositoryRoot } from '../git.js';

export function runDependenciesCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runDependencyPolicy({
    root,
    config: config.dependencyPolicy,
    exceptions: config.exceptions,
  });
}

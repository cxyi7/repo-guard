import { runBuildGate } from '../build-runner.js';
import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';

export function runBuildCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runBuildGate({ root, config: config.build });
}

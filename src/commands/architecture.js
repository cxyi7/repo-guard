import { runArchitectureGate } from '../architecture-runner.js';
import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';

export function runArchitectureCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runArchitectureGate({ root, config: config.architecture });
}

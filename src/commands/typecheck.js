import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runTypeCheckGate } from '../typecheck-runner.js';

export function runTypeCheckCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runTypeCheckGate({ root, config: config.typeCheck });
}

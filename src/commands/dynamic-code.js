import { loadConfig } from '../config.js';
import { runDynamicCodeProject } from '../dynamic-code.js';
import { findRepositoryRoot } from '../git.js';

export function runDynamicCodeCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runDynamicCodeProject({
    root,
    exceptions: config.exceptions,
  });
}

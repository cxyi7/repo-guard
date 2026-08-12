import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runVueFormLabelProject } from '../vue-form-label.js';

export function runFormLabelsCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runVueFormLabelProject({
    root,
    exceptions: config.exceptions,
  });
}

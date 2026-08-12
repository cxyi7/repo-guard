import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runVueImageAltProject } from '../vue-image-alt.js';

export function runImageAltCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runVueImageAltProject({
    root,
    exceptions: config.exceptions,
  });
}

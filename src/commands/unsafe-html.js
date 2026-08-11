import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runUnsafeVueHtmlProject } from '../vue-unsafe-html.js';

export function runUnsafeHtmlCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runUnsafeVueHtmlProject({
    root,
    exceptions: config.exceptions,
  });
}

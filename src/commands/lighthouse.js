import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runVueLighthouse } from '../lighthouse-runner.js';

export function runLighthouseCommand(cwd = process.cwd(), { skipBuild = false } = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runVueLighthouse({
    root,
    config: config.lighthouse,
    skipBuild,
  });
}

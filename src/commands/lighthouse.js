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

export function runPrePush(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  if (!config.lighthouse.enabled) {
    console.log('repo-guard pre-push: Lighthouse is disabled.');
    return 0;
  }
  return runVueLighthouse({ root, config: config.lighthouse });
}

import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { runVueLighthouse } from '../lighthouse-runner.js';
import { collectPrePushChanges } from '../pre-push-changes.js';
import { runUnitTestGate } from '../unit-test-runner.js';

export function runPrePush(cwd = process.cwd(), {
  input = '',
  remoteName = 'origin',
} = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);

  if (config.unitTest.enabled) {
    const changes = collectPrePushChanges({ input, remoteName, root });
    const unitTestExitCode = runUnitTestGate({
      root,
      config: config.unitTest,
      changes,
    });
    if (unitTestExitCode !== 0) {
      return unitTestExitCode;
    }
  } else {
    console.log('repo-guard pre-push: unit tests are disabled.');
  }

  if (!config.lighthouse.enabled) {
    console.log('repo-guard pre-push: Lighthouse is disabled.');
    return 0;
  }
  return runVueLighthouse({ root, config: config.lighthouse });
}

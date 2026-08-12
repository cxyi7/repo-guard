import { runAccessibilityTestGate } from '../accessibility-test-runner.js';
import { loadConfig } from '../config.js';
import { findRepositoryRoot } from '../git.js';

export function runAccessibilityTestCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  if (!config.accessibilityTest.enabled) {
    console.error('Accessibility test gate is disabled. Run repo-guard enable accessibilityTest first.');
    return 1;
  }
  return runAccessibilityTestGate({ root, config: config.accessibilityTest });
}

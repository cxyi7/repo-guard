import { loadConfig } from '../config.js';
import { createChangeSet } from '../core/capability/gate-context.js';
import { collectWorkingTreeChanges } from '../git-changes.js';
import { findRepositoryRoot } from '../git.js';
import { runUnitTestGate } from '../unit-test-runner.js';

export function runUnitTestCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return runUnitTestGate({
    root,
    config: config.unitTest,
    changes: createChangeSet({
      source: 'manual',
      changes: collectWorkingTreeChanges(root),
    }),
  });
}

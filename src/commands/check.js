import { loadConfig } from '../config.js';
import {
  classifyChanges,
  collectWorkingTreeChanges,
} from '../git-changes.js';
import { findRepositoryRoot } from '../git.js';
import { assertLocalEnvironmentNotStaged } from '../local-env.js';
import { printProtectedChanges } from '../report.js';

export function runCheck(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const changes = collectWorkingTreeChanges(root);
  assertLocalEnvironmentNotStaged(
    changes.filter(({ states }) => states.includes('staged')),
  );
  const protectedChanges = classifyChanges(changes, config);

  console.log(`Repository: ${root}`);
  if (protectedChanges.length === 0) {
    console.log('repo-guard check passed: no protected working tree changes.');
    return 0;
  }

  console.log(`repo-guard found ${protectedChanges.length} protected working tree change(s):`);
  printProtectedChanges(protectedChanges, { includeStates: true });
  return 2;
}

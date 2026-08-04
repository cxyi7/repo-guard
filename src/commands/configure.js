import path from 'node:path';
import { CONFIG_FILE } from '../config.js';
import {
  enableQualityGates,
  migrateProjectConfig,
} from '../config-management.js';
import { findRepositoryRoot } from '../git.js';

export function runMigrate(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const result = migrateProjectConfig(root);
  console.log(`repo-guard configuration: ${path.join(root, CONFIG_FILE)}`);
  console.log(`- migration: ${result.changed ? 'updated' : 'already current'}`);
  return 0;
}

export function runEnable(requestedGates, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const result = enableQualityGates(root, requestedGates);
  console.log(`repo-guard quality gates: ${path.join(root, CONFIG_FILE)}`);
  if (result.migrated) {
    console.log('- configuration: migrated');
  }
  for (const gate of result.enabled) {
    console.log(`- ${gate}: enabled`);
  }
  for (const gate of result.alreadyEnabled) {
    console.log(`- ${gate}: already enabled`);
  }
  console.log('- run "repo-guard doctor" to verify project dependencies and configuration');
  return 0;
}

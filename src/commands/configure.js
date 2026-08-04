import path from 'node:path';
import { CONFIG_FILE } from '../config.js';
import {
  migrateProjectConfig,
  setFeaturesEnabled,
} from '../config-management.js';
import { findRepositoryRoot } from '../git.js';

export function runMigrate(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const result = migrateProjectConfig(root);
  console.log(`repo-guard configuration: ${path.join(root, CONFIG_FILE)}`);
  console.log(`- migration: ${result.changed ? 'updated' : 'already current'}`);
  return 0;
}

function runFeatureToggle(requestedFeatures, enabled, cwd) {
  const root = findRepositoryRoot(cwd);
  const result = setFeaturesEnabled(root, requestedFeatures, enabled);
  const state = enabled ? 'enabled' : 'disabled';
  console.log(`repo-guard features: ${path.join(root, CONFIG_FILE)}`);
  if (result.migrated) {
    console.log('- configuration: migrated');
  }
  for (const feature of result.changed) {
    console.log(`- ${feature}: ${state}`);
  }
  for (const feature of result.unchanged) {
    console.log(`- ${feature}: already ${state}`);
  }
  console.log('- run "repo-guard doctor" to verify project dependencies and configuration');
  return 0;
}

export function runEnable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, true, cwd);
}

export function runDisable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, false, cwd);
}

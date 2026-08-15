import path from 'node:path';
import { loadConfig } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import {
  migrateProjectConfig,
  setFeaturesEnabled,
} from '../setup/config-management.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import {
  ensureAccessibilityTestPolicy,
  ensureArchitecturePolicy,
  ensureUnitTestPolicy,
} from '../../policies/managed-policies.js';

export function runMigrate(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const result = migrateProjectConfig(root);
  writeConsoleMessage(`repo-guard configuration: ${path.join(root, CONFIG_FILE)}`);
  writeConsoleMessage(`- migration: ${result.changed ? 'updated' : 'already current'}`);
  return 0;
}

function runFeatureToggle(requestedFeatures, enabled, cwd) {
  const root = findRepositoryRoot(cwd);
  const result = setFeaturesEnabled(root, requestedFeatures, enabled);
  if (enabled && requestedFeatures.includes('architecture')) {
    const policy = ensureArchitecturePolicy(root, loadConfig(root).architecture);
    writeConsoleMessage(
      `repo-guard architecture policy: ${policy.changed ? 'updated' : 'already current'}`,
    );
  }
  if (enabled && requestedFeatures.includes('accessibilityTest')) {
    const policy = ensureAccessibilityTestPolicy(
      root,
      loadConfig(root).accessibilityTest,
    );
    writeConsoleMessage(
      `repo-guard accessibility test policy: ${policy.changed ? 'updated' : 'already current'}`,
    );
  }
  if (enabled && requestedFeatures.some((feature) => (
    feature === 'unitTest' || feature === 'coverage' || feature === 'componentInteraction'
  ))) {
    const policy = ensureUnitTestPolicy(root, loadConfig(root).unitTest);
    writeConsoleMessage(
      `repo-guard unit test policy: ${policy.changed ? 'updated' : 'already current'}`,
    );
  }
  const state = enabled ? 'enabled' : 'disabled';
  writeConsoleMessage(`repo-guard features: ${path.join(root, CONFIG_FILE)}`);
  if (result.migrated) {
    writeConsoleMessage('- configuration: migrated');
  }
  for (const feature of result.changed) {
    writeConsoleMessage(`- ${feature}: ${state}`);
  }
  for (const feature of result.unchanged) {
    writeConsoleMessage(`- ${feature}: already ${state}`);
  }
  writeConsoleMessage('- run "repo-guard doctor" to verify project dependencies and configuration');
  return 0;
}

export function runEnable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, true, cwd);
}

export function runDisable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, false, cwd);
}

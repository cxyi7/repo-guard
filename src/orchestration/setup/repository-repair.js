import { loadConfig } from '../../config/configuration-loader.js';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ARCHITECTURE_POLICY_FILE,
  ensureArchitecturePolicy,
  ensureAccessibilityTestPolicy,
  ensureExceptionPolicy,
  EXCEPTION_POLICY_FILE,
  ensureUnitTestPolicy,
  UNIT_TEST_POLICY_FILE,
} from '../../policies/managed-policies.js';
import {
  ensureProjectConfig,
  migrateProjectConfig,
} from './config-management.js';
import { installHooks } from './hook-installer.js';

export function repairRepository(root) {
  const repairs = [];
  const repairErrors = [];

  try {
    const { created } = ensureProjectConfig(root);
    if (created) {
      repairs.push('created repo-guard.config.json');
      const config = loadConfig(root, { allowExpiredExceptions: true });
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
    } else {
      const { changed, config } = migrateProjectConfig(root, {
        allowExpiredExceptions: true,
      });
      repairs.push(
        changed
          ? 'migrated repo-guard.config.json'
          : 'repo-guard.config.json is already current',
      );
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
      if (config.unitTest.enabled) {
        const policy = ensureUnitTestPolicy(root, config.unitTest);
        repairs.push(
          policy.changed
            ? `updated ${UNIT_TEST_POLICY_FILE} unit test policy`
            : `${UNIT_TEST_POLICY_FILE} unit test policy is already current`,
        );
      }
      if (config.accessibilityTest.enabled) {
        const policy = ensureAccessibilityTestPolicy(root, config.accessibilityTest);
        repairs.push(
          policy.changed
            ? `updated ${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy`
            : `${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy is already current`,
        );
      }
      if (config.architecture.enabled) {
        const policy = ensureArchitecturePolicy(root, config.architecture);
        repairs.push(
          policy.changed
            ? `updated ${ARCHITECTURE_POLICY_FILE} architecture policy`
            : `${ARCHITECTURE_POLICY_FILE} architecture policy is already current`,
        );
      }
    }
  } catch (error) {
    repairErrors.push(`configuration repair failed: ${error.message}`);
  }

  try {
    installHooks({ cwd: root, updatePackageScripts: true });
    repairs.push('reconciled managed hooks, repository files, and package scripts');
  } catch (error) {
    repairErrors.push(`installation repair failed: ${error.message}`);
  }

  return { repairErrors, repairs };
}

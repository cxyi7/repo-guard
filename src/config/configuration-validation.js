import { toRepoGuardError } from '../core/error/repo-guard-error.js';
import { validateAccessibilityConfiguration } from './accessibility-validation.js';
import { validateArchitectureConfiguration } from './architecture-validation.js';
import { validateCiConfiguration } from './ci-validation.js';
import { validateDependencyPolicyConfiguration } from './dependency-policy-validation.js';
import { validateExceptionConfiguration } from './exception-validation.js';
import { validateExecutionGateConfiguration } from './execution-gate-validation.js';
import { validateNotificationConfiguration } from './notification-validation.js';
import { validatePreCommitConfiguration } from './pre-commit-validation.js';
import {
  normalizeProtectedFileConfiguration,
  validateProtectedFileConfigurationShape,
} from './protected-file-validation.js';
import { validateRootConfigurationContract } from './root-configuration-validation.js';
import { validateUnitTestConfiguration } from './unit-test-validation.js';
import { CONFIG_FILE } from './validation-primitives.js';

export function validateConfigValue(value, configPath = CONFIG_FILE) {
  validateRootConfigurationContract(value, configPath);
  validateProtectedFileConfigurationShape(value, configPath);

  const notification = validateNotificationConfiguration(value, configPath);

  const { ci, externalGates } = validateCiConfiguration(value, configPath);

  const exceptions = validateExceptionConfiguration(value, configPath);

  const dependencyPolicy = validateDependencyPolicyConfiguration(value, configPath);

  const architecture = validateArchitectureConfiguration(value, configPath);

  const { build, lighthouse, typeCheck } = validateExecutionGateConfiguration(
    value,
    configPath,
  );

  const accessibilityTest = validateAccessibilityConfiguration(value, configPath);

  const unitTest = validateUnitTestConfiguration(value, configPath);

  const preCommit = validatePreCommitConfiguration(value, configPath);

  const { rules, exclusions } = normalizeProtectedFileConfiguration(value, configPath);

  return {
    version: 1,
    notification,
    ci,
    externalGates,
    exceptions,
    dependencyPolicy,
    architecture,
    build,
    lighthouse,
    typeCheck,
    accessibilityTest,
    unitTest,
    preCommit,
    rules,
    exclusions,
  };
}

export function validateConfig(value, configPath = CONFIG_FILE) {
  try {
    return validateConfigValue(value, configPath);
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'config/invalid',
      expected: `${configPath} must match the supported repo-guard configuration contract.`,
      remediation: {
        goal: `Correct ${configPath} without weakening enabled gates or policies.`,
        steps: ['Use the reported field path and validation message to correct the invalid value.'],
        constraints: ['Do not disable a gate solely to bypass configuration validation.'],
        verification: ['Run npm run guard:check after updating the configuration.'],
      },
    });
  }
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertExceptionRegistryCurrent } from './policies/exception-registry.js';
import { configurationError, toRepoGuardError } from './core/error/repo-guard-error.js';
import {
  globToRegExp,
  matchRule,
  normalizeGitPath,
} from './config/path-matching.js';
import {
  DEFAULT_ESLINT_PATTERN,
  DEFAULT_PRETTIER_PATTERN,
  DEFAULT_STYLELINT_PATTERN,
  DEFAULT_STYLE_COMPLEXITY_CONFIG,
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  DEFAULT_COMPONENT_INTERACTION_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_CI_CONFIG,
  DEFAULT_EXCEPTIONS_CONFIG,
} from './config/defaults.js';
import {
  assertKnownProperties,
  CONFIG_FILE,
  configValidationError,
  validateCiReportPath,
} from './config/validation-primitives.js';
import { validateAccessibilityConfiguration } from './config/accessibility-validation.js';
import { validateArchitectureConfiguration } from './config/architecture-validation.js';
import { validateCiConfiguration } from './config/ci-validation.js';
import { validateDependencyPolicyConfiguration } from './config/dependency-policy-validation.js';
import { validateExceptionConfiguration } from './config/exception-validation.js';
import { validateExecutionGateConfiguration } from './config/execution-gate-validation.js';
import { validateNotificationConfiguration } from './config/notification-validation.js';
import { validatePreCommitConfiguration } from './config/pre-commit-validation.js';
import {
  normalizeProtectedFileConfiguration,
  validateProtectedFileConfigurationShape,
} from './config/protected-file-validation.js';
import { validateUnitTestConfiguration } from './config/unit-test-validation.js';

export { SUPPORTED_LEVELS } from './config/protected-file-validation.js';
export {
  DEFAULT_ESLINT_PATTERN,
  DEFAULT_PRETTIER_PATTERN,
  DEFAULT_STYLELINT_PATTERN,
  DEFAULT_STYLE_COMPLEXITY_CONFIG,
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  DEFAULT_COMPONENT_INTERACTION_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_CI_CONFIG,
  DEFAULT_EXCEPTIONS_CONFIG,
};
export {
  globToRegExp,
  matchRule,
  normalizeGitPath,
};
export { CONFIG_FILE, validateCiReportPath };

function validateConfigValue(value, configPath = CONFIG_FILE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${configPath} must contain a JSON object`);
  }
  assertKnownProperties(
    value,
    new Set([
      '$schema',
      'version',
      'notification',
      'ci',
      'externalGates',
      'exceptions',
      'dependencyPolicy',
      'architecture',
      'accessibilityTest',
      'build',
      'lighthouse',
      'typeCheck',
      'unitTest',
      'preCommit',
      'rules',
      'exclusions',
    ]),
    configPath,
  );
  if (value.version !== 1) {
    throw configValidationError(`${configPath} uses unsupported version: ${String(value.version)}`);
  }
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

export function loadConfig(root, {
  allowExpiredExceptions = false,
  now = new Date(),
} = {}) {
  const configPath = path.join(root, CONFIG_FILE);
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw configurationError(
      'config/read-failed',
      `Unable to read ${CONFIG_FILE}: ${error.message}`,
      {
        details: { location: { path: CONFIG_FILE } },
        expected: `${CONFIG_FILE} must exist at the repository root and contain valid JSON.`,
        remediation: {
          goal: `Restore a readable, valid ${CONFIG_FILE}.`,
          steps: ['Create or correct the configuration file using the documented schema.'],
          constraints: ['Do not remove required policy sections to bypass validation.'],
          verification: ['Run npm run guard:check.'],
        },
        cause: error,
      },
    );
  }

  try {
    const config = validateConfig(parsed, CONFIG_FILE);
    if (!allowExpiredExceptions) {
      assertExceptionRegistryCurrent(config.exceptions, { now });
    }
    return config;
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'config/invalid',
    });
  }
}

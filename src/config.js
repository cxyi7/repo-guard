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
  normalizePatternList,
  validateCiReportPath,
} from './config/validation-primitives.js';
import { validateAccessibilityConfiguration } from './config/accessibility-validation.js';
import { validateArchitectureConfiguration } from './config/architecture-validation.js';
import { validateCiConfiguration } from './config/ci-validation.js';
import { validateDependencyPolicyConfiguration } from './config/dependency-policy-validation.js';
import { validateExceptionConfiguration } from './config/exception-validation.js';
import { validateExecutionGateConfiguration } from './config/execution-gate-validation.js';
import { validateFilePlacementConfiguration } from './config/file-placement-validation.js';
import { validateMaxFileLinesConfiguration } from './config/max-file-lines-validation.js';
import { validateUnitTestConfiguration } from './config/unit-test-validation.js';

export const SUPPORTED_LEVELS = new Set(['notify', 'audit']);
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
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    throw configValidationError(`${configPath} must define at least one rule`);
  }
  if (value.exclusions != null && !Array.isArray(value.exclusions)) {
    throw configValidationError(`${configPath} exclusions must be an array`);
  }

  const notificationValue = value.notification ?? {};
  if (
    !notificationValue
    || typeof notificationValue !== 'object'
    || Array.isArray(notificationValue)
  ) {
    throw configValidationError(`${configPath} notification must be an object`);
  }
  assertKnownProperties(
    notificationValue,
    new Set(['enabled']),
    `${configPath} notification`,
  );
  if (
    notificationValue.enabled != null
    && typeof notificationValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} notification.enabled must be a boolean`);
  }

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

  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw configValidationError(`${configPath} preCommit must be an object`);
  }
  assertKnownProperties(
    preCommitValue,
    new Set(['eslint', 'prettier', 'stylelint', 'maxFileLines', 'filePlacement']),
    `${configPath} preCommit`,
  );

  const filePlacement = validateFilePlacementConfiguration(preCommitValue, configPath);

  const maxFileLines = validateMaxFileLinesConfiguration(preCommitValue, configPath);

  const stylelintValue = preCommitValue.stylelint ?? {};
  if (!stylelintValue || typeof stylelintValue !== 'object' || Array.isArray(stylelintValue)) {
    throw configValidationError(`${configPath} preCommit.stylelint must be an object`);
  }
  assertKnownProperties(
    stylelintValue,
    new Set([
      'enabled',
      'pattern',
      'fix',
      'maxWarnings',
      'requireConfig',
      'complexity',
      'governance',
    ]),
    `${configPath} preCommit.stylelint`,
  );
  if (stylelintValue.enabled != null && typeof stylelintValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.stylelint.enabled must be a boolean`);
  }
  if (
    stylelintValue.pattern != null
    && (typeof stylelintValue.pattern !== 'string' || !stylelintValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} preCommit.stylelint.pattern must be a non-empty string`);
  }
  if (stylelintValue.fix != null && typeof stylelintValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.stylelint.fix must be a boolean`);
  }
  if (
    stylelintValue.maxWarnings != null
    && (!Number.isInteger(stylelintValue.maxWarnings) || stylelintValue.maxWarnings < 0)
  ) {
    throw configValidationError(`${configPath} preCommit.stylelint.maxWarnings must be a non-negative integer`);
  }
  if (
    stylelintValue.requireConfig != null
    && typeof stylelintValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(`${configPath} preCommit.stylelint.requireConfig must be a boolean`);
  }
  const styleComplexityValue = stylelintValue.complexity ?? {};
  if (!styleComplexityValue || typeof styleComplexityValue !== 'object'
    || Array.isArray(styleComplexityValue)) {
    throw configValidationError(`${configPath} preCommit.stylelint.complexity must be an object`);
  }
  assertKnownProperties(
    styleComplexityValue,
    new Set(['enabled', 'maxCompoundSelectors', 'maxNestingDepth']),
    `${configPath} preCommit.stylelint.complexity`,
  );
  if (styleComplexityValue.enabled != null
    && typeof styleComplexityValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.stylelint.complexity.enabled must be a boolean`);
  }
  for (const property of ['maxCompoundSelectors', 'maxNestingDepth']) {
    if (styleComplexityValue[property] != null
      && (!Number.isInteger(styleComplexityValue[property])
        || styleComplexityValue[property] < 0)) {
      throw configValidationError(
        `${configPath} preCommit.stylelint.complexity.${property} `
        + 'must be a non-negative integer',
      );
    }
  }
  if ((styleComplexityValue.enabled ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.enabled)
    && !(stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled)) {
    throw configValidationError(
      `${configPath} preCommit.stylelint.complexity.enabled requires `
      + 'preCommit.stylelint.enabled',
    );
  }
  const styleGovernanceValue = stylelintValue.governance ?? {};
  if (!styleGovernanceValue || typeof styleGovernanceValue !== 'object'
    || Array.isArray(styleGovernanceValue)) {
    throw configValidationError(`${configPath} preCommit.stylelint.governance must be an object`);
  }
  assertKnownProperties(
    styleGovernanceValue,
    new Set([
      'enabled',
      'maxSpecificity',
      'maxIdSelectors',
      'disallowImportant',
      'allowedGlobalStylePatterns',
    ]),
    `${configPath} preCommit.stylelint.governance`,
  );
  if (styleGovernanceValue.enabled != null
    && typeof styleGovernanceValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.stylelint.governance.enabled must be a boolean`);
  }
  if (styleGovernanceValue.maxSpecificity != null
    && (typeof styleGovernanceValue.maxSpecificity !== 'string'
      || !/^\d+,\d+,\d+$/.test(styleGovernanceValue.maxSpecificity.trim()))) {
    throw configValidationError(
      `${configPath} preCommit.stylelint.governance.maxSpecificity `
      + 'must use the "id,class,type" format, for example "0,3,0"',
    );
  }
  if (styleGovernanceValue.maxIdSelectors != null
    && (!Number.isInteger(styleGovernanceValue.maxIdSelectors)
      || styleGovernanceValue.maxIdSelectors < 0)) {
    throw configValidationError(
      `${configPath} preCommit.stylelint.governance.maxIdSelectors `
      + 'must be a non-negative integer',
    );
  }
  if (styleGovernanceValue.disallowImportant != null
    && typeof styleGovernanceValue.disallowImportant !== 'boolean') {
    throw configValidationError(
      `${configPath} preCommit.stylelint.governance.disallowImportant must be a boolean`,
    );
  }
  const allowedGlobalStylePatterns = normalizePatternList(
    styleGovernanceValue.allowedGlobalStylePatterns
      ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.allowedGlobalStylePatterns,
    `${configPath} preCommit.stylelint.governance.allowedGlobalStylePatterns`,
  );
  if ((styleGovernanceValue.enabled ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.enabled)
    && !(stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled)) {
    throw configValidationError(
      `${configPath} preCommit.stylelint.governance.enabled requires `
      + 'preCommit.stylelint.enabled',
    );
  }

  const prettierValue = preCommitValue.prettier ?? {};
  if (!prettierValue || typeof prettierValue !== 'object' || Array.isArray(prettierValue)) {
    throw configValidationError(`${configPath} preCommit.prettier must be an object`);
  }
  assertKnownProperties(
    prettierValue,
    new Set(['enabled', 'pattern', 'fix', 'requireConfig']),
    `${configPath} preCommit.prettier`,
  );
  if (prettierValue.enabled != null && typeof prettierValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.prettier.enabled must be a boolean`);
  }
  if (
    prettierValue.pattern != null
    && (typeof prettierValue.pattern !== 'string' || !prettierValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} preCommit.prettier.pattern must be a non-empty string`);
  }
  if (prettierValue.fix != null && typeof prettierValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.prettier.fix must be a boolean`);
  }
  if (
    prettierValue.requireConfig != null
    && typeof prettierValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(`${configPath} preCommit.prettier.requireConfig must be a boolean`);
  }

  const eslintValue = preCommitValue.eslint ?? {};
  if (!eslintValue || typeof eslintValue !== 'object' || Array.isArray(eslintValue)) {
    throw configValidationError(`${configPath} preCommit.eslint must be an object`);
  }
  assertKnownProperties(
    eslintValue,
    new Set(['enabled', 'preset', 'pattern', 'fix', 'maxWarnings']),
    `${configPath} preCommit.eslint`,
  );
  if (eslintValue.enabled != null && typeof eslintValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.eslint.enabled must be a boolean`);
  }
  if (eslintValue.preset != null && typeof eslintValue.preset !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.eslint.preset must be a boolean`);
  }
  if (
    eslintValue.pattern != null
    && (typeof eslintValue.pattern !== 'string' || !eslintValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} preCommit.eslint.pattern must be a non-empty string`);
  }
  if (eslintValue.fix != null && typeof eslintValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.eslint.fix must be a boolean`);
  }
  if (
    eslintValue.maxWarnings != null
    && (!Number.isInteger(eslintValue.maxWarnings) || eslintValue.maxWarnings < 0)
  ) {
    throw configValidationError(`${configPath} preCommit.eslint.maxWarnings must be a non-negative integer`);
  }

  const rules = value.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${configPath} rule ${index + 1} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set(['pattern', 'category', 'level']),
      `${configPath} rule ${index + 1}`,
    );
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw configValidationError(`${configPath} rule ${index + 1} has no pattern`);
    }
    if (typeof rule.category !== 'string' || !rule.category.trim()) {
      throw configValidationError(`${configPath} rule ${index + 1} has no category`);
    }
    if (!SUPPORTED_LEVELS.has(rule.level)) {
      throw configValidationError(
        `${configPath} rule ${index + 1} has unsupported level: ${String(rule.level)}`,
      );
    }

    const pattern = normalizeGitPath(rule.pattern.trim());
    return {
      pattern,
      category: rule.category.trim(),
      level: rule.level,
      matcher: globToRegExp(pattern),
    };
  });

  const exclusions = (value.exclusions || []).map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw configValidationError(`${configPath} exclusion ${index + 1} must be a non-empty string`);
    }
    const normalized = normalizeGitPath(pattern.trim());
    return {
      pattern: normalized,
      matcher: globToRegExp(normalized),
    };
  });

  return {
    version: 1,
    notification: {
      enabled: notificationValue.enabled ?? DEFAULT_NOTIFICATION_CONFIG.enabled,
    },
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
    preCommit: {
      filePlacement,
      maxFileLines,
      stylelint: {
        enabled: stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled,
        pattern: stylelintValue.pattern?.trim() || DEFAULT_STYLELINT_CONFIG.pattern,
        fix: stylelintValue.fix ?? DEFAULT_STYLELINT_CONFIG.fix,
        maxWarnings: stylelintValue.maxWarnings ?? DEFAULT_STYLELINT_CONFIG.maxWarnings,
        requireConfig: stylelintValue.requireConfig ?? DEFAULT_STYLELINT_CONFIG.requireConfig,
        complexity: {
          enabled: styleComplexityValue.enabled
            ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.enabled,
          maxCompoundSelectors: styleComplexityValue.maxCompoundSelectors
            ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.maxCompoundSelectors,
          maxNestingDepth: styleComplexityValue.maxNestingDepth
            ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.maxNestingDepth,
        },
        governance: {
          enabled: styleGovernanceValue.enabled
            ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.enabled,
          maxSpecificity: styleGovernanceValue.maxSpecificity?.trim()
            || DEFAULT_STYLE_GOVERNANCE_CONFIG.maxSpecificity,
          maxIdSelectors: styleGovernanceValue.maxIdSelectors
            ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.maxIdSelectors,
          disallowImportant: styleGovernanceValue.disallowImportant
            ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.disallowImportant,
          allowedGlobalStylePatterns,
        },
      },
      prettier: {
        enabled: prettierValue.enabled ?? DEFAULT_PRETTIER_CONFIG.enabled,
        pattern: prettierValue.pattern?.trim() || DEFAULT_PRETTIER_CONFIG.pattern,
        fix: prettierValue.fix ?? DEFAULT_PRETTIER_CONFIG.fix,
        requireConfig: prettierValue.requireConfig ?? DEFAULT_PRETTIER_CONFIG.requireConfig,
      },
      eslint: {
        enabled: eslintValue.enabled ?? DEFAULT_ESLINT_CONFIG.enabled,
        preset: eslintValue.preset ?? DEFAULT_ESLINT_CONFIG.preset,
        pattern: eslintValue.pattern?.trim() || DEFAULT_ESLINT_CONFIG.pattern,
        fix: eslintValue.fix ?? DEFAULT_ESLINT_CONFIG.fix,
        maxWarnings: eslintValue.maxWarnings ?? DEFAULT_ESLINT_CONFIG.maxWarnings,
      },
    },
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

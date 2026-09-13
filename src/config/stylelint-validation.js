import { validateUiTokenConfiguration } from './ui-token-validation.js';
import { validateToolOptions } from './tool-options.js';
import {
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
} from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

function validateStylelintValue(checksValue, configPath) {
  const stylelintValue = checksValue.stylelint ?? {};
  if (
    !stylelintValue ||
    typeof stylelintValue !== 'object' ||
    Array.isArray(stylelintValue)
  ) {
    throw configValidationError(`${configPath} checks.stylelint 必须是对象`);
  }
  assertKnownProperties(
    stylelintValue,
    new Set([
      'enabled',
      'pattern',
      'fix',
      'maxWarnings',
      'requireConfig',
      'uiTokens',
      'governance',
      'options',
    ]),
    `${configPath} checks.stylelint`,
  );
  if (
    stylelintValue.enabled != null &&
    typeof stylelintValue.enabled !== 'boolean'
  ) {
    throw configValidationError(
      `${configPath} checks.stylelint.enabled 必须是布尔值`,
    );
  }
  if (
    stylelintValue.pattern != null &&
    (typeof stylelintValue.pattern !== 'string' ||
      !stylelintValue.pattern.trim())
  ) {
    throw configValidationError(
      `${configPath} checks.stylelint.pattern 必须是非空字符串`,
    );
  }
  if (stylelintValue.fix != null && typeof stylelintValue.fix !== 'boolean') {
    throw configValidationError(
      `${configPath} checks.stylelint.fix 必须是布尔值`,
    );
  }
  if (
    stylelintValue.maxWarnings != null &&
    (!Number.isInteger(stylelintValue.maxWarnings) ||
      stylelintValue.maxWarnings < 0)
  ) {
    throw configValidationError(
      `${configPath} checks.stylelint.maxWarnings 必须是非负整数`,
    );
  }
  if (
    stylelintValue.requireConfig != null &&
    typeof stylelintValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(
      `${configPath} checks.stylelint.requireConfig 必须是布尔值`,
    );
  }
  return stylelintValue;
}

function validateStyleGovernanceConfiguration(value, configPath) {
  const candidate = value.governance ?? {};
  const label = configPath + ' checks.stylelint.governance';
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw configValidationError(label + ' 必须是对象');
  assertKnownProperties(
    candidate,
    new Set(['enabled', 'allowedGlobalStylePatterns']),
    label,
  );
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean')
    throw configValidationError(label + '.enabled 必须是布尔值');
  return {
    enabled: candidate.enabled ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.enabled,
    allowedGlobalStylePatterns: normalizePatternList(
      candidate.allowedGlobalStylePatterns ??
        DEFAULT_STYLE_GOVERNANCE_CONFIG.allowedGlobalStylePatterns,
      label + '.allowedGlobalStylePatterns',
    ),
  };
}

export function validateStylelintConfiguration(checksValue, configPath) {
  const stylelintValue = validateStylelintValue(checksValue, configPath);
  const enabled = stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled;
  const governance = validateStyleGovernanceConfiguration(
    stylelintValue,
    configPath,
  );
  const uiTokens = validateUiTokenConfiguration(stylelintValue, configPath);
  return {
    enabled,
    pattern: stylelintValue.pattern?.trim() || DEFAULT_STYLELINT_CONFIG.pattern,
    ...validateToolOptions('stylelint', stylelintValue.options, configPath),
    fix: stylelintValue.fix ?? DEFAULT_STYLELINT_CONFIG.fix,
    maxWarnings:
      stylelintValue.maxWarnings ?? DEFAULT_STYLELINT_CONFIG.maxWarnings,
    requireConfig:
      stylelintValue.requireConfig ?? DEFAULT_STYLELINT_CONFIG.requireConfig,
    uiTokens,
    governance,
  };
}

import {
  DEFAULT_STYLE_COMPLEXITY_CONFIG,
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
  if (!stylelintValue || typeof stylelintValue !== 'object' || Array.isArray(stylelintValue)) {
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
      'complexity',
      'governance',
    ]),
    `${configPath} checks.stylelint`,
  );
  if (stylelintValue.enabled != null && typeof stylelintValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.stylelint.enabled 必须是布尔值`);
  }
  if (
    stylelintValue.pattern != null
    && (typeof stylelintValue.pattern !== 'string' || !stylelintValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} checks.stylelint.pattern 必须是非空字符串`);
  }
  if (stylelintValue.fix != null && typeof stylelintValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} checks.stylelint.fix 必须是布尔值`);
  }
  if (
    stylelintValue.maxWarnings != null
    && (!Number.isInteger(stylelintValue.maxWarnings) || stylelintValue.maxWarnings < 0)
  ) {
    throw configValidationError(`${configPath} checks.stylelint.maxWarnings 必须是非负整数`);
  }
  if (
    stylelintValue.requireConfig != null
    && typeof stylelintValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(`${configPath} checks.stylelint.requireConfig 必须是布尔值`);
  }
  return stylelintValue;
}

function validateStyleComplexityConfiguration(stylelintValue, stylelintEnabled, configPath) {
  const styleComplexityValue = stylelintValue.complexity ?? {};
  if (!styleComplexityValue || typeof styleComplexityValue !== 'object'
    || Array.isArray(styleComplexityValue)) {
    throw configValidationError(`${configPath} checks.styleComplexity 必须是对象`);
  }
  assertKnownProperties(
    styleComplexityValue,
    new Set(['enabled', 'maxCompoundSelectors', 'maxNestingDepth']),
    `${configPath} checks.styleComplexity`,
  );
  if (styleComplexityValue.enabled != null
    && typeof styleComplexityValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.styleComplexity.enabled 必须是布尔值`);
  }
  for (const property of ['maxCompoundSelectors', 'maxNestingDepth']) {
    if (styleComplexityValue[property] != null
      && (!Number.isInteger(styleComplexityValue[property])
        || styleComplexityValue[property] < 0)) {
      throw configValidationError(
        `${configPath} checks.styleComplexity.${property} 必须是非负整数`,
      );
    }
  }
  const enabled = styleComplexityValue.enabled ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.enabled;
  if (enabled && !stylelintEnabled) {
    throw configValidationError(
      `${configPath} checks.styleComplexity.enabled 要求启用 checks.stylelint.enabled`,
    );
  }
  return {
    enabled,
    maxCompoundSelectors: styleComplexityValue.maxCompoundSelectors
      ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.maxCompoundSelectors,
    maxNestingDepth: styleComplexityValue.maxNestingDepth
      ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.maxNestingDepth,
  };
}

function validateStyleGovernanceValue(stylelintValue, configPath) {
  const styleGovernanceValue = stylelintValue.governance ?? {};
  if (!styleGovernanceValue || typeof styleGovernanceValue !== 'object'
    || Array.isArray(styleGovernanceValue)) {
    throw configValidationError(`${configPath} checks.styleGovernance 必须是对象`);
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
    `${configPath} checks.styleGovernance`,
  );
  if (styleGovernanceValue.enabled != null
    && typeof styleGovernanceValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.styleGovernance.enabled 必须是布尔值`);
  }
  if (styleGovernanceValue.maxSpecificity != null
    && (typeof styleGovernanceValue.maxSpecificity !== 'string'
      || !/^\d+,\d+,\d+$/.test(styleGovernanceValue.maxSpecificity.trim()))) {
    throw configValidationError(
      `${configPath} checks.styleGovernance.maxSpecificity 必须使用 "id,class,type" 格式，例如 "0,3,0"`,
    );
  }
  if (styleGovernanceValue.maxIdSelectors != null
    && (!Number.isInteger(styleGovernanceValue.maxIdSelectors)
      || styleGovernanceValue.maxIdSelectors < 0)) {
    throw configValidationError(
      `${configPath} checks.styleGovernance.maxIdSelectors 必须是非负整数`,
    );
  }
  if (styleGovernanceValue.disallowImportant != null
    && typeof styleGovernanceValue.disallowImportant !== 'boolean') {
    throw configValidationError(
      `${configPath} checks.styleGovernance.disallowImportant 必须是布尔值`,
    );
  }
  const allowedGlobalStylePatterns = normalizePatternList(
    styleGovernanceValue.allowedGlobalStylePatterns
      ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.allowedGlobalStylePatterns,
    `${configPath} checks.styleGovernance.allowedGlobalStylePatterns`,
  );
  return { styleGovernanceValue, allowedGlobalStylePatterns };
}

function validateStyleGovernanceConfiguration(stylelintValue, stylelintEnabled, configPath) {
  const {
    styleGovernanceValue,
    allowedGlobalStylePatterns,
  } = validateStyleGovernanceValue(stylelintValue, configPath);
  const enabled = styleGovernanceValue.enabled ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.enabled;
  if (enabled && !stylelintEnabled) {
    throw configValidationError(
      `${configPath} checks.styleGovernance.enabled 要求启用 checks.stylelint.enabled`,
    );
  }
  return {
    enabled,
    maxSpecificity: styleGovernanceValue.maxSpecificity?.trim()
      || DEFAULT_STYLE_GOVERNANCE_CONFIG.maxSpecificity,
    maxIdSelectors: styleGovernanceValue.maxIdSelectors
      ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.maxIdSelectors,
    disallowImportant: styleGovernanceValue.disallowImportant
      ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.disallowImportant,
    allowedGlobalStylePatterns,
  };
}

export function validateStylelintConfiguration(checksValue, configPath) {
  const stylelintValue = validateStylelintValue(checksValue, configPath);
  const enabled = stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled;
  const complexity = validateStyleComplexityConfiguration(
    stylelintValue,
    enabled,
    configPath,
  );
  const governance = validateStyleGovernanceConfiguration(
    stylelintValue,
    enabled,
    configPath,
  );
  return {
    enabled,
    pattern: stylelintValue.pattern?.trim() || DEFAULT_STYLELINT_CONFIG.pattern,
    fix: stylelintValue.fix ?? DEFAULT_STYLELINT_CONFIG.fix,
    maxWarnings: stylelintValue.maxWarnings ?? DEFAULT_STYLELINT_CONFIG.maxWarnings,
    requireConfig: stylelintValue.requireConfig ?? DEFAULT_STYLELINT_CONFIG.requireConfig,
    complexity,
    governance,
  };
}

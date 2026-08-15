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

function validateStylelintValue(preCommitValue, configPath) {
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
  return stylelintValue;
}

function validateStyleComplexityConfiguration(stylelintValue, stylelintEnabled, configPath) {
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
  const enabled = styleComplexityValue.enabled ?? DEFAULT_STYLE_COMPLEXITY_CONFIG.enabled;
  if (enabled && !stylelintEnabled) {
    throw configValidationError(
      `${configPath} preCommit.stylelint.complexity.enabled requires `
      + 'preCommit.stylelint.enabled',
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
      `${configPath} preCommit.stylelint.governance.enabled requires `
      + 'preCommit.stylelint.enabled',
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

export function validateStylelintConfiguration(preCommitValue, configPath) {
  const stylelintValue = validateStylelintValue(preCommitValue, configPath);
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

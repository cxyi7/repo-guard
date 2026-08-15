import path from 'node:path';
import {
  DEFAULT_COMPONENT_INTERACTION_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
} from './defaults.js';
import { normalizeGitPath } from './path-matching.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

const COVERAGE_THRESHOLD_NAMES = Object.freeze([
  'lines',
  'statements',
  'functions',
  'branches',
  'changedLines',
]);

function validateUnitTestValue(value, configPath) {
  const unitTestValue = value.unitTest ?? {};
  if (!unitTestValue || typeof unitTestValue !== 'object' || Array.isArray(unitTestValue)) {
    throw configValidationError(`${configPath} unitTest must be an object`);
  }
  assertKnownProperties(
    unitTestValue,
    new Set([
      'enabled',
      'script',
      'timeoutMs',
      'coverage',
      'componentInteraction',
      'requireTests',
      'sourcePatterns',
      'testPatterns',
      'mappings',
      'exclusions',
    ]),
    `${configPath} unitTest`,
  );
  if (unitTestValue.enabled != null && typeof unitTestValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} unitTest.enabled must be a boolean`);
  }
  if (
    unitTestValue.script != null
    && (
      typeof unitTestValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(unitTestValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} unitTest.script must be an npm script name`);
  }
  if (
    unitTestValue.timeoutMs != null
    && (!Number.isInteger(unitTestValue.timeoutMs) || unitTestValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} unitTest.timeoutMs must be a positive integer`);
  }
  return unitTestValue;
}

function normalizeCoverageThresholds(thresholdsValue, configPath) {
  if (!thresholdsValue || typeof thresholdsValue !== 'object' || Array.isArray(thresholdsValue)) {
    throw configValidationError(`${configPath} unitTest.coverage.thresholds must be an object`);
  }
  assertKnownProperties(
    thresholdsValue,
    new Set(COVERAGE_THRESHOLD_NAMES),
    `${configPath} unitTest.coverage.thresholds`,
  );
  return Object.fromEntries(COVERAGE_THRESHOLD_NAMES.map((name) => {
    const threshold = thresholdsValue[name]
      ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds[name];
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)
      || threshold < 0 || threshold > 100) {
      throw configValidationError(
        `${configPath} unitTest.coverage.thresholds.${name} must be between 0 and 100`,
      );
    }
    return [name, threshold];
  }));
}

function validateCoverageConfiguration(unitTestValue, configPath) {
  const coverageValue = unitTestValue.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  if (!coverageValue || typeof coverageValue !== 'object' || Array.isArray(coverageValue)) {
    throw configValidationError(`${configPath} unitTest.coverage must be an object`);
  }
  assertKnownProperties(
    coverageValue,
    new Set(['enabled', 'reportsDirectory', 'thresholds']),
    `${configPath} unitTest.coverage`,
  );
  if (coverageValue.enabled != null && typeof coverageValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} unitTest.coverage.enabled must be a boolean`);
  }
  const reportsDirectory = normalizeRelativePattern(
    coverageValue.reportsDirectory
      ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.reportsDirectory,
    `${configPath} unitTest.coverage.reportsDirectory`,
  );
  if (
    /[*?{}[\]]/.test(reportsDirectory)
    || reportsDirectory === '.'
    || !/coverage/i.test(path.posix.basename(reportsDirectory))
  ) {
    throw configValidationError(
      `${configPath} unitTest.coverage.reportsDirectory must be a dedicated coverage directory`,
    );
  }
  const thresholdsValue = coverageValue.thresholds
    ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds;
  return {
    enabled: coverageValue.enabled ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.enabled,
    reportsDirectory,
    thresholds: normalizeCoverageThresholds(thresholdsValue, configPath),
  };
}

function validateComponentInteractionConfiguration(
  unitTestValue,
  unitTestEnabled,
  configPath,
) {
  const componentInteractionValue = unitTestValue.componentInteraction
    ?? DEFAULT_UNIT_TEST_CONFIG.componentInteraction;
  if (!componentInteractionValue
    || typeof componentInteractionValue !== 'object'
    || Array.isArray(componentInteractionValue)) {
    throw configValidationError(`${configPath} unitTest.componentInteraction must be an object`);
  }
  assertKnownProperties(
    componentInteractionValue,
    new Set(['enabled', 'componentPatterns']),
    `${configPath} unitTest.componentInteraction`,
  );
  if (componentInteractionValue.enabled != null
    && typeof componentInteractionValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} unitTest.componentInteraction.enabled must be a boolean`);
  }
  const componentPatterns = normalizePatternList(
    componentInteractionValue.componentPatterns
      ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.componentPatterns,
    `${configPath} unitTest.componentInteraction.componentPatterns`,
  );
  const enabled = componentInteractionValue.enabled
    ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.enabled;
  if (enabled && !unitTestEnabled) {
    throw configValidationError(
      `${configPath} unitTest.componentInteraction.enabled requires unitTest.enabled`,
    );
  }
  return { enabled, componentPatterns };
}

function normalizeUnitTestPatternField(
  unitTestValue,
  field,
  defaults,
  configPath,
  { allowEmpty = false } = {},
) {
  const patterns = unitTestValue[field] ?? defaults;
  if (!Array.isArray(patterns) || (!allowEmpty && patterns.length === 0)) {
    throw configValidationError(
      `${configPath} unitTest.${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array`,
    );
  }
  return patterns.map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw configValidationError(
        `${configPath} unitTest.${field} item ${index + 1} must be a non-empty string`,
      );
    }
    return normalizeGitPath(pattern.trim());
  });
}

function normalizeUnitTestMappings(unitTestValue, configPath) {
  const mappingsValue = unitTestValue.mappings ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  if (!Array.isArray(mappingsValue) || mappingsValue.length === 0) {
    throw configValidationError(`${configPath} unitTest.mappings must be a non-empty array`);
  }
  const allowedTemplatePlaceholders = /\{(?:dir|ext|name|path)\}/g;
  return mappingsValue.map((mapping, index) => {
    const label = `${configPath} unitTest.mappings item ${index + 1}`;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw configValidationError(`${label} must be an object`);
    }
    assertKnownProperties(
      mapping,
      new Set(['sourcePattern', 'testTemplates']),
      label,
    );
    const sourcePattern = normalizeRelativePattern(
      mapping.sourcePattern,
      `${label}.sourcePattern`,
    );
    const testTemplates = normalizePatternList(
      mapping.testTemplates,
      `${label}.testTemplates`,
    ).map((template) => {
      const remainingBraces = template.replace(allowedTemplatePlaceholders, '');
      if (remainingBraces.includes('{') || remainingBraces.includes('}')) {
        throw configValidationError(
          `${label}.testTemplates contains an unsupported placeholder: ${template}`,
        );
      }
      if (!template.includes('{path}') && !template.includes('{name}')) {
        throw configValidationError(
          `${label}.testTemplates must contain {path} or {name}: ${template}`,
        );
      }
      return template;
    });
    return { sourcePattern, testTemplates };
  });
}

export function validateUnitTestConfiguration(value, configPath) {
  const unitTestValue = validateUnitTestValue(value, configPath);
  const coverage = validateCoverageConfiguration(unitTestValue, configPath);
  const enabled = unitTestValue.enabled ?? DEFAULT_UNIT_TEST_CONFIG.enabled;
  const componentInteraction = validateComponentInteractionConfiguration(
    unitTestValue,
    enabled,
    configPath,
  );
  if (
    unitTestValue.requireTests != null
    && !['newFiles', 'changedFiles'].includes(unitTestValue.requireTests)
  ) {
    throw configValidationError(
      `${configPath} unitTest.requireTests must be newFiles or changedFiles`,
    );
  }
  const sourcePatterns = normalizeUnitTestPatternField(
    unitTestValue,
    'sourcePatterns',
    DEFAULT_UNIT_TEST_CONFIG.sourcePatterns,
    configPath,
  );
  const testPatterns = normalizeUnitTestPatternField(
    unitTestValue,
    'testPatterns',
    DEFAULT_UNIT_TEST_CONFIG.testPatterns,
    configPath,
  );
  const exclusions = normalizeUnitTestPatternField(
    unitTestValue,
    'exclusions',
    DEFAULT_UNIT_TEST_CONFIG.exclusions,
    configPath,
    { allowEmpty: true },
  );
  const mappings = normalizeUnitTestMappings(unitTestValue, configPath);

  return {
    enabled,
    script: unitTestValue.script?.trim() || DEFAULT_UNIT_TEST_CONFIG.script,
    timeoutMs: unitTestValue.timeoutMs ?? DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
    coverage,
    componentInteraction,
    requireTests: unitTestValue.requireTests ?? DEFAULT_UNIT_TEST_CONFIG.requireTests,
    sourcePatterns,
    testPatterns,
    mappings,
    exclusions,
  };
}

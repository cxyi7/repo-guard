import path from 'node:path';
import {
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
    throw configValidationError(`${configPath} checks.unitTest 必须是对象`);
  }
  assertKnownProperties(
    unitTestValue,
    new Set([
      'enabled',
      'script',
      'timeoutMs',
      'coverage',
      'requireTests',
      'sourcePatterns',
      'testPatterns',
      'mappings',
      'exclusions',
    ]),
    `${configPath} checks.unitTest`,
  );
  if (unitTestValue.enabled != null && typeof unitTestValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.unitTest.enabled 必须是布尔值`);
  }
  if (
    unitTestValue.script != null
    && (
      typeof unitTestValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(unitTestValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} checks.unitTest.script 必须是 npm 脚本名称`);
  }
  if (
    unitTestValue.timeoutMs != null
    && (!Number.isInteger(unitTestValue.timeoutMs) || unitTestValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} checks.unitTest.timeoutMs 必须是正整数`);
  }
  return unitTestValue;
}

function normalizeCoverageThresholds(thresholdsValue, configPath) {
  if (!thresholdsValue || typeof thresholdsValue !== 'object' || Array.isArray(thresholdsValue)) {
    throw configValidationError(`${configPath} checks.coverage.thresholds 必须是对象`);
  }
  assertKnownProperties(
    thresholdsValue,
    new Set(COVERAGE_THRESHOLD_NAMES),
    `${configPath} checks.coverage.thresholds`,
  );
  return Object.fromEntries(COVERAGE_THRESHOLD_NAMES.map((name) => {
    const threshold = thresholdsValue[name]
      ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds[name];
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)
      || threshold < 0 || threshold > 100) {
      throw configValidationError(
        `${configPath} checks.coverage.thresholds.${name} 必须介于 0 到 100 之间`,
      );
    }
    return [name, threshold];
  }));
}

function validateCoverageConfiguration(unitTestValue, configPath) {
  const coverageValue = unitTestValue.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  if (!coverageValue || typeof coverageValue !== 'object' || Array.isArray(coverageValue)) {
    throw configValidationError(`${configPath} checks.coverage 必须是对象`);
  }
  assertKnownProperties(
    coverageValue,
    new Set(['enabled', 'reportsDirectory', 'thresholds']),
    `${configPath} checks.coverage`,
  );
  if (coverageValue.enabled != null && typeof coverageValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.coverage.enabled 必须是布尔值`);
  }
  const reportsDirectory = normalizeRelativePattern(
    coverageValue.reportsDirectory
      ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.reportsDirectory,
    `${configPath} checks.coverage.reportsDirectory`,
  );
  if (
    /[*?{}[\]]/.test(reportsDirectory)
    || reportsDirectory === '.'
    || !/coverage/i.test(path.posix.basename(reportsDirectory))
  ) {
    throw configValidationError(
      `${configPath} checks.coverage.reportsDirectory 必须是专用的覆盖率目录`,
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
      `配置项 ${configPath} checks.unitTest.${field} ${allowEmpty ? '必须是数组' : '必须是非空数组'}`,
    );
  }
  return patterns.map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw configValidationError(
        `${configPath} checks.unitTest.${field} 第 ${index + 1} 必须是非空字符串`,
      );
    }
    return normalizeGitPath(pattern.trim());
  });
}

function normalizeUnitTestMappings(unitTestValue, configPath) {
  const mappingsValue = unitTestValue.mappings ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  if (!Array.isArray(mappingsValue) || mappingsValue.length === 0) {
    throw configValidationError(`${configPath} checks.unitTest.mappings 必须是非空数组`);
  }
  const allowedTemplatePlaceholders = /\{(?:dir|ext|name|path|relativePath)\}/g;
  return mappingsValue.map((mapping, index) => {
    const label = `${configPath} checks.unitTest.mappings 第 ${index + 1}`;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(
      mapping,
      new Set(['sourcePattern', 'sourceRoot', 'testTemplates']),
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
          `${label}.testTemplates 包含不支持的占位符： ${template}`,
        );
      }
      if (!template.includes('{path}') && !template.includes('{name}') && !template.includes('{relativePath}')) {
        throw configValidationError(
          `${label}.testTemplates 必须包含 {path}、{name} 或 {relativePath}： ${template}`,
        );
      }
      return template;
    });
    const sourceRoot = mapping.sourceRoot === undefined ? undefined : normalizeRelativePattern(mapping.sourceRoot, `${label}.sourceRoot`);
    if (sourceRoot !== undefined && /[*?{}[\\\]]/.test(sourceRoot)) {
      throw configValidationError(`${label}.sourceRoot 必须是明确目录`);
    }
    if (testTemplates.some((template) => template.includes('{relativePath}')) && sourceRoot === undefined) {
      throw configValidationError(`${label}.sourceRoot 是 {relativePath} 的必需配置`);
    }
    return { sourcePattern, ...(sourceRoot === undefined ? {} : { sourceRoot }), testTemplates };
  });
}

export function validateUnitTestConfiguration(value, configPath) {
  const unitTestValue = validateUnitTestValue(value, configPath);
  const coverage = validateCoverageConfiguration(unitTestValue, configPath);
  const enabled = unitTestValue.enabled ?? DEFAULT_UNIT_TEST_CONFIG.enabled;
  if (
    unitTestValue.requireTests != null
    && !['newFiles', 'changedFiles'].includes(unitTestValue.requireTests)
  ) {
    throw configValidationError(
      `${configPath} checks.unitTest.requireTests 必须为 newFiles 或 changedFiles`,
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
    requireTests: unitTestValue.requireTests ?? DEFAULT_UNIT_TEST_CONFIG.requireTests,
    sourcePatterns,
    testPatterns,
    mappings,
    exclusions,
  };
}

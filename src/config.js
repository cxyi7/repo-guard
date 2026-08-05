import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'repo-guard.config.json';
export const SUPPORTED_LEVELS = new Set(['notify', 'audit']);
export const DEFAULT_ESLINT_PATTERN = '*.{js,jsx,ts,tsx,vue}';
export const DEFAULT_PRETTIER_PATTERN = '*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}';
export const DEFAULT_STYLELINT_PATTERN = '**/*.{css,scss,sass,less,vue}';
export const DEFAULT_ESLINT_CONFIG = Object.freeze({
  enabled: false,
  preset: false,
  pattern: DEFAULT_ESLINT_PATTERN,
  fix: true,
  maxWarnings: 0,
});
export const DEFAULT_PRETTIER_CONFIG = Object.freeze({
  enabled: false,
  pattern: DEFAULT_PRETTIER_PATTERN,
  fix: true,
  requireConfig: true,
});
export const DEFAULT_STYLELINT_CONFIG = Object.freeze({
  enabled: false,
  pattern: DEFAULT_STYLELINT_PATTERN,
  fix: true,
  maxWarnings: 0,
  requireConfig: true,
});
export const DEFAULT_MAX_FILE_LINES_CONFIG = Object.freeze({
  enabled: false,
  mode: 'strict',
  warnAt: 0.85,
  rules: Object.freeze([
    Object.freeze({ pattern: '**/*.vue', maxLines: 700 }),
    Object.freeze({ pattern: '**/*.{js,mjs,cjs,jsx}', maxLines: 1000 }),
    Object.freeze({ pattern: '**/*.{ts,tsx}', maxLines: 1000 }),
  ]),
  exclusions: Object.freeze([]),
});
export const DEFAULT_LIGHTHOUSE_CONFIG = Object.freeze({
  enabled: false,
  configFile: null,
  buildScript: 'build',
  timeoutMs: 300000,
});
export const DEFAULT_UNIT_TEST_CONFIG = Object.freeze({
  enabled: false,
  script: 'test:unit',
  timeoutMs: 120000,
  coverage: false,
  requireTests: 'newFiles',
  sourcePatterns: Object.freeze([
    'src/utils/**/*.js',
    'src/composables/**/*.js',
    'src/stores/**/*.js',
    'src/api/**/*.js',
    'src/components/**/*.vue',
  ]),
  testPatterns: Object.freeze(['**/*.spec.js']),
  exclusions: Object.freeze([
    'src/main.js',
    'src/**/index.js',
    'src/generated/**',
  ]),
});
export const DEFAULT_NOTIFICATION_CONFIG = Object.freeze({
  enabled: true,
});

export function normalizeGitPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function assertKnownProperties(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unsupported properties: ${unknown.join(', ')}`);
  }
}

export function globToRegExp(pattern) {
  const normalized = normalizeGitPath(pattern);
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '*' && normalized[index + 1] === '*') {
      const followedBySlash = normalized[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
      continue;
    }

    if (character === '*') {
      expression += '[^/]*';
      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += escapeRegExp(character);
  }

  return new RegExp(`^${expression}$`);
}

export function validateConfig(value, configPath = CONFIG_FILE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }
  assertKnownProperties(
    value,
    new Set([
      '$schema',
      'version',
      'notification',
      'lighthouse',
      'unitTest',
      'preCommit',
      'rules',
      'exclusions',
    ]),
    configPath,
  );
  if (value.version !== 1) {
    throw new Error(`${configPath} uses unsupported version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    throw new Error(`${configPath} must define at least one rule`);
  }
  if (value.exclusions != null && !Array.isArray(value.exclusions)) {
    throw new Error(`${configPath} exclusions must be an array`);
  }

  const notificationValue = value.notification ?? {};
  if (
    !notificationValue
    || typeof notificationValue !== 'object'
    || Array.isArray(notificationValue)
  ) {
    throw new Error(`${configPath} notification must be an object`);
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
    throw new Error(`${configPath} notification.enabled must be a boolean`);
  }

  const lighthouseValue = value.lighthouse ?? {};
  if (!lighthouseValue || typeof lighthouseValue !== 'object' || Array.isArray(lighthouseValue)) {
    throw new Error(`${configPath} lighthouse must be an object`);
  }
  assertKnownProperties(
    lighthouseValue,
    new Set(['enabled', 'configFile', 'buildScript', 'timeoutMs']),
    `${configPath} lighthouse`,
  );
  if (lighthouseValue.enabled != null && typeof lighthouseValue.enabled !== 'boolean') {
    throw new Error(`${configPath} lighthouse.enabled must be a boolean`);
  }
  for (const field of ['configFile', 'buildScript']) {
    const fieldValue = lighthouseValue[field];
    if (
      fieldValue != null
      && (typeof fieldValue !== 'string' || !fieldValue.trim())
    ) {
      throw new Error(`${configPath} lighthouse.${field} must be null or a non-empty string`);
    }
  }
  if (
    typeof lighthouseValue.buildScript === 'string'
    && !/^[A-Za-z0-9:_-]+$/.test(lighthouseValue.buildScript.trim())
  ) {
    throw new Error(`${configPath} lighthouse.buildScript must be an npm script name`);
  }
  if (
    lighthouseValue.timeoutMs != null
    && (!Number.isInteger(lighthouseValue.timeoutMs) || lighthouseValue.timeoutMs <= 0)
  ) {
    throw new Error(`${configPath} lighthouse.timeoutMs must be a positive integer`);
  }

  const unitTestValue = value.unitTest ?? {};
  if (!unitTestValue || typeof unitTestValue !== 'object' || Array.isArray(unitTestValue)) {
    throw new Error(`${configPath} unitTest must be an object`);
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
      'exclusions',
    ]),
    `${configPath} unitTest`,
  );
  for (const field of ['enabled', 'coverage']) {
    if (unitTestValue[field] != null && typeof unitTestValue[field] !== 'boolean') {
      throw new Error(`${configPath} unitTest.${field} must be a boolean`);
    }
  }
  if (
    unitTestValue.script != null
    && (
      typeof unitTestValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(unitTestValue.script.trim())
    )
  ) {
    throw new Error(`${configPath} unitTest.script must be an npm script name`);
  }
  if (
    unitTestValue.timeoutMs != null
    && (!Number.isInteger(unitTestValue.timeoutMs) || unitTestValue.timeoutMs <= 0)
  ) {
    throw new Error(`${configPath} unitTest.timeoutMs must be a positive integer`);
  }
  if (
    unitTestValue.requireTests != null
    && !['newFiles', 'changedFiles'].includes(unitTestValue.requireTests)
  ) {
    throw new Error(
      `${configPath} unitTest.requireTests must be newFiles or changedFiles`,
    );
  }

  const normalizePatterns = (field, defaults, { allowEmpty = false } = {}) => {
    const patterns = unitTestValue[field] ?? defaults;
    if (!Array.isArray(patterns) || (!allowEmpty && patterns.length === 0)) {
      throw new Error(
        `${configPath} unitTest.${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array`,
      );
    }
    return patterns.map((pattern, index) => {
      if (typeof pattern !== 'string' || !pattern.trim()) {
        throw new Error(
          `${configPath} unitTest.${field} item ${index + 1} must be a non-empty string`,
        );
      }
      return normalizeGitPath(pattern.trim());
    });
  };
  const unitTestSourcePatterns = normalizePatterns(
    'sourcePatterns',
    DEFAULT_UNIT_TEST_CONFIG.sourcePatterns,
  );
  const unitTestPatterns = normalizePatterns(
    'testPatterns',
    DEFAULT_UNIT_TEST_CONFIG.testPatterns,
  );
  const unitTestExclusions = normalizePatterns(
    'exclusions',
    DEFAULT_UNIT_TEST_CONFIG.exclusions,
    { allowEmpty: true },
  );

  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw new Error(`${configPath} preCommit must be an object`);
  }
  assertKnownProperties(
    preCommitValue,
    new Set(['eslint', 'prettier', 'stylelint', 'maxFileLines']),
    `${configPath} preCommit`,
  );

  const maxFileLinesValue = preCommitValue.maxFileLines ?? {};
  if (
    !maxFileLinesValue
    || typeof maxFileLinesValue !== 'object'
    || Array.isArray(maxFileLinesValue)
  ) {
    throw new Error(`${configPath} preCommit.maxFileLines must be an object`);
  }
  assertKnownProperties(
    maxFileLinesValue,
    new Set(['enabled', 'mode', 'warnAt', 'rules', 'exclusions']),
    `${configPath} preCommit.maxFileLines`,
  );
  if (
    maxFileLinesValue.enabled != null
    && typeof maxFileLinesValue.enabled !== 'boolean'
  ) {
    throw new Error(`${configPath} preCommit.maxFileLines.enabled must be a boolean`);
  }
  if (
    maxFileLinesValue.mode != null
    && !['strict', 'noRegression'].includes(maxFileLinesValue.mode)
  ) {
    throw new Error(
      `${configPath} preCommit.maxFileLines.mode must be strict or noRegression`,
    );
  }
  if (
    maxFileLinesValue.warnAt != null
    && (
      typeof maxFileLinesValue.warnAt !== 'number'
      || !Number.isFinite(maxFileLinesValue.warnAt)
      || maxFileLinesValue.warnAt <= 0
      || maxFileLinesValue.warnAt > 1
    )
  ) {
    throw new Error(`${configPath} preCommit.maxFileLines.warnAt must be greater than 0 and at most 1`);
  }

  const maxFileLineRulesValue = maxFileLinesValue.rules
    ?? DEFAULT_MAX_FILE_LINES_CONFIG.rules;
  if (!Array.isArray(maxFileLineRulesValue) || maxFileLineRulesValue.length === 0) {
    throw new Error(`${configPath} preCommit.maxFileLines.rules must be a non-empty array`);
  }
  const maxFileLineRules = maxFileLineRulesValue.map((rule, index) => {
    const label = `${configPath} preCommit.maxFileLines rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${label} must be an object`);
    }
    assertKnownProperties(rule, new Set(['pattern', 'maxLines']), label);
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw new Error(`${label}.pattern must be a non-empty string`);
    }
    if (!Number.isInteger(rule.maxLines) || rule.maxLines <= 0) {
      throw new Error(`${label}.maxLines must be a positive integer`);
    }
    return {
      pattern: normalizeGitPath(rule.pattern.trim()),
      maxLines: rule.maxLines,
    };
  });

  const maxFileLineExclusionsValue = maxFileLinesValue.exclusions
    ?? DEFAULT_MAX_FILE_LINES_CONFIG.exclusions;
  if (!Array.isArray(maxFileLineExclusionsValue)) {
    throw new Error(`${configPath} preCommit.maxFileLines.exclusions must be an array`);
  }
  const maxFileLineExclusions = maxFileLineExclusionsValue.map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error(
        `${configPath} preCommit.maxFileLines exclusion ${index + 1} must be a non-empty string`,
      );
    }
    return normalizeGitPath(pattern.trim());
  });

  const stylelintValue = preCommitValue.stylelint ?? {};
  if (!stylelintValue || typeof stylelintValue !== 'object' || Array.isArray(stylelintValue)) {
    throw new Error(`${configPath} preCommit.stylelint must be an object`);
  }
  assertKnownProperties(
    stylelintValue,
    new Set(['enabled', 'pattern', 'fix', 'maxWarnings', 'requireConfig']),
    `${configPath} preCommit.stylelint`,
  );
  if (stylelintValue.enabled != null && typeof stylelintValue.enabled !== 'boolean') {
    throw new Error(`${configPath} preCommit.stylelint.enabled must be a boolean`);
  }
  if (
    stylelintValue.pattern != null
    && (typeof stylelintValue.pattern !== 'string' || !stylelintValue.pattern.trim())
  ) {
    throw new Error(`${configPath} preCommit.stylelint.pattern must be a non-empty string`);
  }
  if (stylelintValue.fix != null && typeof stylelintValue.fix !== 'boolean') {
    throw new Error(`${configPath} preCommit.stylelint.fix must be a boolean`);
  }
  if (
    stylelintValue.maxWarnings != null
    && (!Number.isInteger(stylelintValue.maxWarnings) || stylelintValue.maxWarnings < 0)
  ) {
    throw new Error(`${configPath} preCommit.stylelint.maxWarnings must be a non-negative integer`);
  }
  if (
    stylelintValue.requireConfig != null
    && typeof stylelintValue.requireConfig !== 'boolean'
  ) {
    throw new Error(`${configPath} preCommit.stylelint.requireConfig must be a boolean`);
  }

  const prettierValue = preCommitValue.prettier ?? {};
  if (!prettierValue || typeof prettierValue !== 'object' || Array.isArray(prettierValue)) {
    throw new Error(`${configPath} preCommit.prettier must be an object`);
  }
  assertKnownProperties(
    prettierValue,
    new Set(['enabled', 'pattern', 'fix', 'requireConfig']),
    `${configPath} preCommit.prettier`,
  );
  if (prettierValue.enabled != null && typeof prettierValue.enabled !== 'boolean') {
    throw new Error(`${configPath} preCommit.prettier.enabled must be a boolean`);
  }
  if (
    prettierValue.pattern != null
    && (typeof prettierValue.pattern !== 'string' || !prettierValue.pattern.trim())
  ) {
    throw new Error(`${configPath} preCommit.prettier.pattern must be a non-empty string`);
  }
  if (prettierValue.fix != null && typeof prettierValue.fix !== 'boolean') {
    throw new Error(`${configPath} preCommit.prettier.fix must be a boolean`);
  }
  if (
    prettierValue.requireConfig != null
    && typeof prettierValue.requireConfig !== 'boolean'
  ) {
    throw new Error(`${configPath} preCommit.prettier.requireConfig must be a boolean`);
  }

  const eslintValue = preCommitValue.eslint ?? {};
  if (!eslintValue || typeof eslintValue !== 'object' || Array.isArray(eslintValue)) {
    throw new Error(`${configPath} preCommit.eslint must be an object`);
  }
  assertKnownProperties(
    eslintValue,
    new Set(['enabled', 'preset', 'pattern', 'fix', 'maxWarnings']),
    `${configPath} preCommit.eslint`,
  );
  if (eslintValue.enabled != null && typeof eslintValue.enabled !== 'boolean') {
    throw new Error(`${configPath} preCommit.eslint.enabled must be a boolean`);
  }
  if (eslintValue.preset != null && typeof eslintValue.preset !== 'boolean') {
    throw new Error(`${configPath} preCommit.eslint.preset must be a boolean`);
  }
  if (
    eslintValue.pattern != null
    && (typeof eslintValue.pattern !== 'string' || !eslintValue.pattern.trim())
  ) {
    throw new Error(`${configPath} preCommit.eslint.pattern must be a non-empty string`);
  }
  if (eslintValue.fix != null && typeof eslintValue.fix !== 'boolean') {
    throw new Error(`${configPath} preCommit.eslint.fix must be a boolean`);
  }
  if (
    eslintValue.maxWarnings != null
    && (!Number.isInteger(eslintValue.maxWarnings) || eslintValue.maxWarnings < 0)
  ) {
    throw new Error(`${configPath} preCommit.eslint.maxWarnings must be a non-negative integer`);
  }

  const rules = value.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${configPath} rule ${index + 1} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set(['pattern', 'category', 'level']),
      `${configPath} rule ${index + 1}`,
    );
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw new Error(`${configPath} rule ${index + 1} has no pattern`);
    }
    if (typeof rule.category !== 'string' || !rule.category.trim()) {
      throw new Error(`${configPath} rule ${index + 1} has no category`);
    }
    if (!SUPPORTED_LEVELS.has(rule.level)) {
      throw new Error(
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
      throw new Error(`${configPath} exclusion ${index + 1} must be a non-empty string`);
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
    lighthouse: {
      enabled: lighthouseValue.enabled ?? DEFAULT_LIGHTHOUSE_CONFIG.enabled,
      configFile: lighthouseValue.configFile?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.configFile,
      buildScript: lighthouseValue.buildScript === null
        ? null
        : lighthouseValue.buildScript?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.buildScript,
      timeoutMs: lighthouseValue.timeoutMs ?? DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
    },
    unitTest: {
      enabled: unitTestValue.enabled ?? DEFAULT_UNIT_TEST_CONFIG.enabled,
      script: unitTestValue.script?.trim() || DEFAULT_UNIT_TEST_CONFIG.script,
      timeoutMs: unitTestValue.timeoutMs ?? DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
      coverage: unitTestValue.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage,
      requireTests: unitTestValue.requireTests ?? DEFAULT_UNIT_TEST_CONFIG.requireTests,
      sourcePatterns: unitTestSourcePatterns,
      testPatterns: unitTestPatterns,
      exclusions: unitTestExclusions,
    },
    preCommit: {
      maxFileLines: {
        enabled: maxFileLinesValue.enabled ?? DEFAULT_MAX_FILE_LINES_CONFIG.enabled,
        mode: maxFileLinesValue.mode ?? DEFAULT_MAX_FILE_LINES_CONFIG.mode,
        warnAt: maxFileLinesValue.warnAt ?? DEFAULT_MAX_FILE_LINES_CONFIG.warnAt,
        rules: maxFileLineRules,
        exclusions: maxFileLineExclusions,
      },
      stylelint: {
        enabled: stylelintValue.enabled ?? DEFAULT_STYLELINT_CONFIG.enabled,
        pattern: stylelintValue.pattern?.trim() || DEFAULT_STYLELINT_CONFIG.pattern,
        fix: stylelintValue.fix ?? DEFAULT_STYLELINT_CONFIG.fix,
        maxWarnings: stylelintValue.maxWarnings ?? DEFAULT_STYLELINT_CONFIG.maxWarnings,
        requireConfig: stylelintValue.requireConfig ?? DEFAULT_STYLELINT_CONFIG.requireConfig,
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

export function loadConfig(root) {
  const configPath = path.join(root, CONFIG_FILE);
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${CONFIG_FILE}: ${error.message}`);
  }

  return validateConfig(parsed, CONFIG_FILE);
}

export function matchRule(filePath, config) {
  const normalized = normalizeGitPath(filePath);
  if (config.exclusions.some(({ matcher }) => matcher.test(normalized))) {
    return null;
  }

  const rule = config.rules.find(({ matcher }) => matcher.test(normalized));
  if (!rule) {
    return null;
  }

  return {
    pattern: rule.pattern,
    category: rule.category,
    level: rule.level,
  };
}

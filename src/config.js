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
export const DEFAULT_BUILD_CONFIG = Object.freeze({
  enabled: false,
  script: 'build',
  timeoutMs: 300000,
});
const DEFAULT_ARCHITECTURE_TEST_PATTERN = String.raw`(?:^|/)(?:__tests__|tests?)/|\.(?:spec|test)\.[cm]?[jt]sx?$`;
export const DEFAULT_ARCHITECTURE_CONFIG = Object.freeze({
  enabled: false,
  timeoutMs: 120000,
  sourcePaths: Object.freeze(['src']),
  tsConfig: null,
  exclude: String.raw`(?:^|/)(?:node_modules|dist|coverage|\.git)/`,
  rules: Object.freeze([
    Object.freeze({
      name: 'no-circular',
      comment: 'Do not create circular dependencies.',
      severity: 'error',
      from: Object.freeze({ path: '^src/' }),
      to: Object.freeze({ circular: true }),
    }),
    Object.freeze({
      name: 'no-unresolved',
      comment: 'Every project import must resolve.',
      severity: 'error',
      from: Object.freeze({ path: '^src/' }),
      to: Object.freeze({ couldNotResolve: true }),
    }),
    Object.freeze({
      name: 'no-production-to-tests',
      comment: 'Production code must not import test-only modules.',
      severity: 'error',
      from: Object.freeze({ path: '^src/', pathNot: DEFAULT_ARCHITECTURE_TEST_PATTERN }),
      to: Object.freeze({ path: DEFAULT_ARCHITECTURE_TEST_PATTERN }),
    }),
  ]),
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
export const DEFAULT_FILE_PLACEMENT_CONFIG = Object.freeze({
  enabled: true,
  mode: 'newFiles',
  rules: Object.freeze([
    Object.freeze({
      name: '资源文件',
      patterns: Object.freeze([
        '**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,bmp,tif,tiff}',
        '**/*.{woff,woff2,ttf,otf,eot}',
        '**/*.{mp3,wav,ogg,m4a,mp4,webm,mov,pdf}',
      ]),
      allowedPatterns: Object.freeze([
        'src/assets/**',
        'public/assets/**',
        'docs/assets/**',
      ]),
      exceptions: Object.freeze([
        'public/favicon.{ico,png,svg}',
      ]),
      suggestedDirectory: 'src/assets',
    }),
    Object.freeze({
      name: 'Markdown 文档',
      patterns: Object.freeze(['**/*.md']),
      allowedPatterns: Object.freeze([
        'docs/**',
        '.github/**',
        '.changeset/**',
      ]),
      exceptions: Object.freeze([
        'README*.md',
        'CHANGELOG*.md',
        'AGENTS.md',
        'SECURITY.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        'LICENSE*.md',
      ]),
      suggestedDirectory: 'docs',
    }),
  ]),
});
export const DEFAULT_LIGHTHOUSE_CONFIG = Object.freeze({
  enabled: false,
  configFile: null,
  buildScript: 'build',
  timeoutMs: 300000,
});
export const DEFAULT_TYPE_CHECK_CONFIG = Object.freeze({
  enabled: false,
  script: 'typecheck',
  timeoutMs: 180000,
});
export const DEFAULT_UNIT_TEST_COVERAGE_CONFIG = Object.freeze({
  enabled: false,
  reportsDirectory: 'coverage',
  thresholds: Object.freeze({
    lines: 80,
    statements: 80,
    functions: 80,
    branches: 80,
    changedLines: 90,
  }),
});
export const DEFAULT_UNIT_TEST_CONFIG = Object.freeze({
  enabled: false,
  script: 'test:unit',
  timeoutMs: 120000,
  coverage: DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  requireTests: 'newFiles',
  sourcePatterns: Object.freeze([
    'src/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/composables/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/stores/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/api/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/components/**/*.{js,jsx,ts,tsx,vue}',
  ]),
  testPatterns: Object.freeze([
    '**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
  ]),
  mappings: Object.freeze([
    Object.freeze({
      sourcePattern: '**/*.{js,mjs,cjs}',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{dir}/__tests__/{name}.spec.js',
        '{dir}/__tests__/{name}.test.js',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.jsx',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{path}.spec.jsx',
        '{path}.test.jsx',
        '{dir}/__tests__/{name}.spec.jsx',
        '{dir}/__tests__/{name}.test.jsx',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.{ts,mts,cts}',
      testTemplates: Object.freeze([
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.ts',
        '{dir}/__tests__/{name}.test.ts',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.tsx',
      testTemplates: Object.freeze([
        '{path}.spec.tsx',
        '{path}.test.tsx',
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.tsx',
        '{dir}/__tests__/{name}.test.tsx',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.vue',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.js',
        '{dir}/__tests__/{name}.spec.ts',
      ]),
    }),
  ]),
  exclusions: Object.freeze([
    'src/main.{js,ts}',
    'src/**/index.{js,ts}',
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

function normalizeRelativePattern(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const pattern = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value.trim())
    || pattern.startsWith('/')
    || /^[A-Za-z]:\//.test(pattern)
    || pattern.startsWith('!')
    || pattern.split('/').includes('..')
  ) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return pattern;
}

function normalizePatternList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
  }
  return value.map((pattern, index) => (
    normalizeRelativePattern(pattern, `${label} item ${index + 1}`)
  ));
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
      'architecture',
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

  const architectureValue = value.architecture ?? {};
  if (!architectureValue || typeof architectureValue !== 'object'
    || Array.isArray(architectureValue)) {
    throw new Error(`${configPath} architecture must be an object`);
  }
  assertKnownProperties(
    architectureValue,
    new Set(['enabled', 'timeoutMs', 'sourcePaths', 'tsConfig', 'exclude', 'rules']),
    `${configPath} architecture`,
  );
  if (architectureValue.enabled != null && typeof architectureValue.enabled !== 'boolean') {
    throw new Error(`${configPath} architecture.enabled must be a boolean`);
  }
  if (architectureValue.timeoutMs != null
    && (!Number.isInteger(architectureValue.timeoutMs) || architectureValue.timeoutMs <= 0)) {
    throw new Error(`${configPath} architecture.timeoutMs must be a positive integer`);
  }
  const architectureSourcePaths = normalizePatternList(
    architectureValue.sourcePaths ?? DEFAULT_ARCHITECTURE_CONFIG.sourcePaths,
    `${configPath} architecture.sourcePaths`,
  );
  let architectureTsConfig = architectureValue.tsConfig
    ?? DEFAULT_ARCHITECTURE_CONFIG.tsConfig;
  if (architectureTsConfig !== null) {
    architectureTsConfig = normalizeRelativePattern(
      architectureTsConfig,
      `${configPath} architecture.tsConfig`,
    );
  }
  const architectureExclude = architectureValue.exclude === undefined
    ? DEFAULT_ARCHITECTURE_CONFIG.exclude
    : architectureValue.exclude;
  if (architectureExclude !== null
    && (typeof architectureExclude !== 'string' || !architectureExclude.trim())) {
    throw new Error(`${configPath} architecture.exclude must be null or a non-empty regex`);
  }
  if (architectureExclude !== null) {
    try {
      new RegExp(architectureExclude);
    } catch (error) {
      throw new Error(`${configPath} architecture.exclude must be a valid regex: ${error.message}`);
    }
  }
  const architectureRulesValue = architectureValue.rules
    ?? DEFAULT_ARCHITECTURE_CONFIG.rules;
  if (!Array.isArray(architectureRulesValue) || architectureRulesValue.length === 0) {
    throw new Error(`${configPath} architecture.rules must be a non-empty array`);
  }
  const architectureRuleNames = new Set();
  const architectureRules = architectureRulesValue.map((rule, index) => {
    const label = `${configPath} architecture rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${label} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set(['name', 'comment', 'severity', 'from', 'to']),
      label,
    );
    if (typeof rule.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(rule.name)) {
      throw new Error(`${label}.name must be a kebab-case identifier`);
    }
    if (architectureRuleNames.has(rule.name)) {
      throw new Error(`${configPath} architecture rule name is duplicated: ${rule.name}`);
    }
    architectureRuleNames.add(rule.name);
    if (rule.comment != null && (typeof rule.comment !== 'string' || !rule.comment.trim())) {
      throw new Error(`${label}.comment must be a non-empty string`);
    }
    const severity = rule.severity ?? 'error';
    if (!['error', 'warn', 'info', 'ignore'].includes(severity)) {
      throw new Error(`${label}.severity must be error, warn, info, or ignore`);
    }
    for (const conditionName of ['from', 'to']) {
      const condition = rule[conditionName];
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        throw new Error(`${label}.${conditionName} must be an object`);
      }
      for (const regexField of ['path', 'pathNot']) {
        if (condition[regexField] == null) continue;
        const patterns = Array.isArray(condition[regexField])
          ? condition[regexField]
          : [condition[regexField]];
        if (patterns.length === 0 || patterns.some((pattern) => (
          typeof pattern !== 'string' || !pattern
        ))) {
          throw new Error(`${label}.${conditionName}.${regexField} must contain regex strings`);
        }
        for (const pattern of patterns) {
          try {
            new RegExp(pattern);
          } catch (error) {
            throw new Error(
              `${label}.${conditionName}.${regexField} must be a valid regex: ${error.message}`,
            );
          }
        }
      }
    }
    return {
      name: rule.name,
      ...(rule.comment == null ? {} : { comment: rule.comment.trim() }),
      severity,
      from: structuredClone(rule.from),
      to: structuredClone(rule.to),
    };
  });

  const buildValue = value.build ?? {};
  if (!buildValue || typeof buildValue !== 'object' || Array.isArray(buildValue)) {
    throw new Error(`${configPath} build must be an object`);
  }
  assertKnownProperties(
    buildValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} build`,
  );
  if (buildValue.enabled != null && typeof buildValue.enabled !== 'boolean') {
    throw new Error(`${configPath} build.enabled must be a boolean`);
  }
  if (
    buildValue.script != null
    && (
      typeof buildValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(buildValue.script.trim())
    )
  ) {
    throw new Error(`${configPath} build.script must be an npm script name`);
  }
  if (
    buildValue.timeoutMs != null
    && (!Number.isInteger(buildValue.timeoutMs) || buildValue.timeoutMs <= 0)
  ) {
    throw new Error(`${configPath} build.timeoutMs must be a positive integer`);
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

  const typeCheckValue = value.typeCheck ?? {};
  if (!typeCheckValue || typeof typeCheckValue !== 'object' || Array.isArray(typeCheckValue)) {
    throw new Error(`${configPath} typeCheck must be an object`);
  }
  assertKnownProperties(
    typeCheckValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} typeCheck`,
  );
  if (typeCheckValue.enabled != null && typeof typeCheckValue.enabled !== 'boolean') {
    throw new Error(`${configPath} typeCheck.enabled must be a boolean`);
  }
  if (
    typeCheckValue.script != null
    && (
      typeof typeCheckValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(typeCheckValue.script.trim())
    )
  ) {
    throw new Error(`${configPath} typeCheck.script must be an npm script name`);
  }
  if (
    typeCheckValue.timeoutMs != null
    && (!Number.isInteger(typeCheckValue.timeoutMs) || typeCheckValue.timeoutMs <= 0)
  ) {
    throw new Error(`${configPath} typeCheck.timeoutMs must be a positive integer`);
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
      'mappings',
      'exclusions',
    ]),
    `${configPath} unitTest`,
  );
  for (const field of ['enabled']) {
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
  const coverageValue = unitTestValue.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  let unitTestCoverage;
  if (typeof coverageValue === 'boolean') {
    unitTestCoverage = coverageValue;
  } else {
    if (!coverageValue || typeof coverageValue !== 'object' || Array.isArray(coverageValue)) {
      throw new Error(`${configPath} unitTest.coverage must be a boolean or object`);
    }
    assertKnownProperties(
      coverageValue,
      new Set(['enabled', 'reportsDirectory', 'thresholds']),
      `${configPath} unitTest.coverage`,
    );
    if (coverageValue.enabled != null && typeof coverageValue.enabled !== 'boolean') {
      throw new Error(`${configPath} unitTest.coverage.enabled must be a boolean`);
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
      throw new Error(
        `${configPath} unitTest.coverage.reportsDirectory must be a dedicated coverage directory`,
      );
    }
    const thresholdsValue = coverageValue.thresholds
      ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds;
    if (!thresholdsValue || typeof thresholdsValue !== 'object' || Array.isArray(thresholdsValue)) {
      throw new Error(`${configPath} unitTest.coverage.thresholds must be an object`);
    }
    const thresholdNames = [
      'lines',
      'statements',
      'functions',
      'branches',
      'changedLines',
    ];
    assertKnownProperties(
      thresholdsValue,
      new Set(thresholdNames),
      `${configPath} unitTest.coverage.thresholds`,
    );
    const thresholds = Object.fromEntries(thresholdNames.map((name) => {
      const threshold = thresholdsValue[name]
        ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds[name];
      if (typeof threshold !== 'number' || !Number.isFinite(threshold)
        || threshold < 0 || threshold > 100) {
        throw new Error(
          `${configPath} unitTest.coverage.thresholds.${name} must be between 0 and 100`,
        );
      }
      return [name, threshold];
    }));
    unitTestCoverage = {
      enabled: coverageValue.enabled ?? DEFAULT_UNIT_TEST_COVERAGE_CONFIG.enabled,
      reportsDirectory,
      thresholds,
    };
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
  const unitTestMappingsValue = unitTestValue.mappings
    ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  if (!Array.isArray(unitTestMappingsValue) || unitTestMappingsValue.length === 0) {
    throw new Error(`${configPath} unitTest.mappings must be a non-empty array`);
  }
  const allowedTemplatePlaceholders = /\{(?:dir|ext|name|path)\}/g;
  const unitTestMappings = unitTestMappingsValue.map((mapping, index) => {
    const label = `${configPath} unitTest.mappings item ${index + 1}`;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error(`${label} must be an object`);
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
        throw new Error(
          `${label}.testTemplates contains an unsupported placeholder: ${template}`,
        );
      }
      if (!template.includes('{path}') && !template.includes('{name}')) {
        throw new Error(
          `${label}.testTemplates must contain {path} or {name}: ${template}`,
        );
      }
      return template;
    });
    return { sourcePattern, testTemplates };
  });

  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw new Error(`${configPath} preCommit must be an object`);
  }
  assertKnownProperties(
    preCommitValue,
    new Set(['eslint', 'prettier', 'stylelint', 'maxFileLines', 'filePlacement']),
    `${configPath} preCommit`,
  );

  const filePlacementValue = preCommitValue.filePlacement ?? {};
  if (
    !filePlacementValue
    || typeof filePlacementValue !== 'object'
    || Array.isArray(filePlacementValue)
  ) {
    throw new Error(`${configPath} preCommit.filePlacement must be an object`);
  }
  assertKnownProperties(
    filePlacementValue,
    new Set(['enabled', 'mode', 'rules']),
    `${configPath} preCommit.filePlacement`,
  );
  if (
    filePlacementValue.enabled != null
    && typeof filePlacementValue.enabled !== 'boolean'
  ) {
    throw new Error(`${configPath} preCommit.filePlacement.enabled must be a boolean`);
  }
  if (
    filePlacementValue.mode != null
    && !['newFiles', 'changedFiles'].includes(filePlacementValue.mode)
  ) {
    throw new Error(
      `${configPath} preCommit.filePlacement.mode must be newFiles or changedFiles`,
    );
  }
  const filePlacementRulesValue = filePlacementValue.rules
    ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  if (!Array.isArray(filePlacementRulesValue) || filePlacementRulesValue.length === 0) {
    throw new Error(`${configPath} preCommit.filePlacement.rules must be a non-empty array`);
  }
  const filePlacementRules = filePlacementRulesValue.map((rule, index) => {
    const label = `${configPath} preCommit.filePlacement rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${label} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set([
        'name',
        'patterns',
        'allowedPatterns',
        'exceptions',
        'suggestedDirectory',
      ]),
      label,
    );
    if (typeof rule.name !== 'string' || !rule.name.trim()) {
      throw new Error(`${label}.name must be a non-empty string`);
    }
    const suggestedDirectory = normalizeRelativePattern(
      rule.suggestedDirectory,
      `${label}.suggestedDirectory`,
    ).replace(/\/$/, '');
    if (['*', '?', '{', '}', '[', ']', '!'].some((character) => (
      suggestedDirectory.includes(character)
    ))) {
      throw new Error(`${label}.suggestedDirectory must be a concrete directory`);
    }
    return {
      name: rule.name.trim(),
      patterns: normalizePatternList(rule.patterns, `${label}.patterns`),
      allowedPatterns: normalizePatternList(
        rule.allowedPatterns,
        `${label}.allowedPatterns`,
      ),
      exceptions: normalizePatternList(
        rule.exceptions ?? [],
        `${label}.exceptions`,
        { allowEmpty: true },
      ),
      suggestedDirectory,
    };
  });

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
    architecture: {
      enabled: architectureValue.enabled ?? DEFAULT_ARCHITECTURE_CONFIG.enabled,
      timeoutMs: architectureValue.timeoutMs ?? DEFAULT_ARCHITECTURE_CONFIG.timeoutMs,
      sourcePaths: architectureSourcePaths,
      tsConfig: architectureTsConfig,
      exclude: architectureExclude,
      rules: architectureRules,
    },
    build: {
      enabled: buildValue.enabled ?? DEFAULT_BUILD_CONFIG.enabled,
      script: buildValue.script?.trim() || DEFAULT_BUILD_CONFIG.script,
      timeoutMs: buildValue.timeoutMs ?? DEFAULT_BUILD_CONFIG.timeoutMs,
    },
    lighthouse: {
      enabled: lighthouseValue.enabled ?? DEFAULT_LIGHTHOUSE_CONFIG.enabled,
      configFile: lighthouseValue.configFile?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.configFile,
      buildScript: lighthouseValue.buildScript === null
        ? null
        : lighthouseValue.buildScript?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.buildScript,
      timeoutMs: lighthouseValue.timeoutMs ?? DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
    },
    typeCheck: {
      enabled: typeCheckValue.enabled ?? DEFAULT_TYPE_CHECK_CONFIG.enabled,
      script: typeCheckValue.script?.trim() || DEFAULT_TYPE_CHECK_CONFIG.script,
      timeoutMs: typeCheckValue.timeoutMs ?? DEFAULT_TYPE_CHECK_CONFIG.timeoutMs,
    },
    unitTest: {
      enabled: unitTestValue.enabled ?? DEFAULT_UNIT_TEST_CONFIG.enabled,
      script: unitTestValue.script?.trim() || DEFAULT_UNIT_TEST_CONFIG.script,
      timeoutMs: unitTestValue.timeoutMs ?? DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
      coverage: unitTestCoverage,
      requireTests: unitTestValue.requireTests ?? DEFAULT_UNIT_TEST_CONFIG.requireTests,
      sourcePatterns: unitTestSourcePatterns,
      testPatterns: unitTestPatterns,
      mappings: unitTestMappings,
      exclusions: unitTestExclusions,
    },
    preCommit: {
      filePlacement: {
        enabled: filePlacementValue.enabled ?? DEFAULT_FILE_PLACEMENT_CONFIG.enabled,
        mode: filePlacementValue.mode ?? DEFAULT_FILE_PLACEMENT_CONFIG.mode,
        rules: filePlacementRules,
      },
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

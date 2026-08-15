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
  normalizeRelativePattern,
  validateCiReportPath,
} from './config/validation-primitives.js';
import { validateCiConfiguration } from './config/ci-validation.js';
import { validateDependencyPolicyConfiguration } from './config/dependency-policy-validation.js';
import { validateExceptionConfiguration } from './config/exception-validation.js';

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

  const architectureValue = value.architecture ?? {};
  if (!architectureValue || typeof architectureValue !== 'object'
    || Array.isArray(architectureValue)) {
    throw configValidationError(`${configPath} architecture must be an object`);
  }
  assertKnownProperties(
    architectureValue,
    new Set(['enabled', 'timeoutMs', 'sourcePaths', 'tsConfig', 'exclude', 'rules']),
    `${configPath} architecture`,
  );
  if (architectureValue.enabled != null && typeof architectureValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} architecture.enabled must be a boolean`);
  }
  if (architectureValue.timeoutMs != null
    && (!Number.isInteger(architectureValue.timeoutMs) || architectureValue.timeoutMs <= 0)) {
    throw configValidationError(`${configPath} architecture.timeoutMs must be a positive integer`);
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
    throw configValidationError(`${configPath} architecture.exclude must be null or a non-empty regex`);
  }
  if (architectureExclude !== null) {
    try {
      new RegExp(architectureExclude);
    } catch (error) {
      throw configValidationError(`${configPath} architecture.exclude must be a valid regex: ${error.message}`);
    }
  }
  const architectureRulesValue = architectureValue.rules
    ?? DEFAULT_ARCHITECTURE_CONFIG.rules;
  if (!Array.isArray(architectureRulesValue) || architectureRulesValue.length === 0) {
    throw configValidationError(`${configPath} architecture.rules must be a non-empty array`);
  }
  const architectureRuleNames = new Set();
  const architectureRules = architectureRulesValue.map((rule, index) => {
    const label = `${configPath} architecture rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${label} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set(['name', 'comment', 'severity', 'from', 'to']),
      label,
    );
    if (typeof rule.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(rule.name)) {
      throw configValidationError(`${label}.name must be a kebab-case identifier`);
    }
    if (architectureRuleNames.has(rule.name)) {
      throw configValidationError(`${configPath} architecture rule name is duplicated: ${rule.name}`);
    }
    architectureRuleNames.add(rule.name);
    if (rule.comment != null && (typeof rule.comment !== 'string' || !rule.comment.trim())) {
      throw configValidationError(`${label}.comment must be a non-empty string`);
    }
    const severity = rule.severity ?? 'error';
    if (!['error', 'warn', 'info', 'ignore'].includes(severity)) {
      throw configValidationError(`${label}.severity must be error, warn, info, or ignore`);
    }
    for (const conditionName of ['from', 'to']) {
      const condition = rule[conditionName];
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        throw configValidationError(`${label}.${conditionName} must be an object`);
      }
      for (const regexField of ['path', 'pathNot']) {
        if (condition[regexField] == null) continue;
        const patterns = Array.isArray(condition[regexField])
          ? condition[regexField]
          : [condition[regexField]];
        if (patterns.length === 0 || patterns.some((pattern) => (
          typeof pattern !== 'string' || !pattern
        ))) {
          throw configValidationError(`${label}.${conditionName}.${regexField} must contain regex strings`);
        }
        for (const pattern of patterns) {
          try {
            new RegExp(pattern);
          } catch (error) {
            throw configValidationError(
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
    throw configValidationError(`${configPath} build must be an object`);
  }
  assertKnownProperties(
    buildValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} build`,
  );
  if (buildValue.enabled != null && typeof buildValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} build.enabled must be a boolean`);
  }
  if (
    buildValue.script != null
    && (
      typeof buildValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(buildValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} build.script must be an npm script name`);
  }
  if (
    buildValue.timeoutMs != null
    && (!Number.isInteger(buildValue.timeoutMs) || buildValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} build.timeoutMs must be a positive integer`);
  }

  const lighthouseValue = value.lighthouse ?? {};
  if (!lighthouseValue || typeof lighthouseValue !== 'object' || Array.isArray(lighthouseValue)) {
    throw configValidationError(`${configPath} lighthouse must be an object`);
  }
  assertKnownProperties(
    lighthouseValue,
    new Set(['enabled', 'configFile', 'buildScript', 'timeoutMs']),
    `${configPath} lighthouse`,
  );
  if (lighthouseValue.enabled != null && typeof lighthouseValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} lighthouse.enabled must be a boolean`);
  }
  for (const field of ['configFile', 'buildScript']) {
    const fieldValue = lighthouseValue[field];
    if (
      fieldValue != null
      && (typeof fieldValue !== 'string' || !fieldValue.trim())
    ) {
      throw configValidationError(`${configPath} lighthouse.${field} must be null or a non-empty string`);
    }
  }
  if (
    typeof lighthouseValue.buildScript === 'string'
    && !/^[A-Za-z0-9:_-]+$/.test(lighthouseValue.buildScript.trim())
  ) {
    throw configValidationError(`${configPath} lighthouse.buildScript must be an npm script name`);
  }
  if (
    lighthouseValue.timeoutMs != null
    && (!Number.isInteger(lighthouseValue.timeoutMs) || lighthouseValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} lighthouse.timeoutMs must be a positive integer`);
  }

  const typeCheckValue = value.typeCheck ?? {};
  if (!typeCheckValue || typeof typeCheckValue !== 'object' || Array.isArray(typeCheckValue)) {
    throw configValidationError(`${configPath} typeCheck must be an object`);
  }
  assertKnownProperties(
    typeCheckValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} typeCheck`,
  );
  if (typeCheckValue.enabled != null && typeof typeCheckValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} typeCheck.enabled must be a boolean`);
  }
  if (
    typeCheckValue.script != null
    && (
      typeof typeCheckValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(typeCheckValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} typeCheck.script must be an npm script name`);
  }
  if (
    typeCheckValue.timeoutMs != null
    && (!Number.isInteger(typeCheckValue.timeoutMs) || typeCheckValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} typeCheck.timeoutMs must be a positive integer`);
  }

  const accessibilityTestValue = value.accessibilityTest ?? {};
  if (
    !accessibilityTestValue
    || typeof accessibilityTestValue !== 'object'
    || Array.isArray(accessibilityTestValue)
  ) {
    throw configValidationError(`${configPath} accessibilityTest must be an object`);
  }
  assertKnownProperties(
    accessibilityTestValue,
    new Set(['enabled', 'script', 'timeoutMs', 'testPatterns']),
    `${configPath} accessibilityTest`,
  );
  if (
    accessibilityTestValue.enabled != null
    && typeof accessibilityTestValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} accessibilityTest.enabled must be a boolean`);
  }
  if (
    accessibilityTestValue.script != null
    && (
      typeof accessibilityTestValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(accessibilityTestValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} accessibilityTest.script must be an npm script name`);
  }
  if (
    accessibilityTestValue.timeoutMs != null
    && (
      !Number.isInteger(accessibilityTestValue.timeoutMs)
      || accessibilityTestValue.timeoutMs <= 0
    )
  ) {
    throw configValidationError(`${configPath} accessibilityTest.timeoutMs must be a positive integer`);
  }
  const accessibilityTestPatterns = normalizePatternList(
    accessibilityTestValue.testPatterns ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns,
    `${configPath} accessibilityTest.testPatterns`,
  );

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
  for (const field of ['enabled']) {
    if (unitTestValue[field] != null && typeof unitTestValue[field] !== 'boolean') {
      throw configValidationError(`${configPath} unitTest.${field} must be a boolean`);
    }
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
  const coverageValue = unitTestValue.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  let unitTestCoverage;
  {
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
    if (!thresholdsValue || typeof thresholdsValue !== 'object' || Array.isArray(thresholdsValue)) {
      throw configValidationError(`${configPath} unitTest.coverage.thresholds must be an object`);
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
        throw configValidationError(
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
  const componentInteractionPatterns = normalizePatternList(
    componentInteractionValue.componentPatterns
      ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.componentPatterns,
    `${configPath} unitTest.componentInteraction.componentPatterns`,
  );
  const unitTestEnabled = unitTestValue.enabled ?? DEFAULT_UNIT_TEST_CONFIG.enabled;
  const componentInteractionEnabled = componentInteractionValue.enabled
    ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.enabled;
  if (componentInteractionEnabled && !unitTestEnabled) {
    throw configValidationError(
      `${configPath} unitTest.componentInteraction.enabled requires unitTest.enabled`,
    );
  }
  if (
    unitTestValue.requireTests != null
    && !['newFiles', 'changedFiles'].includes(unitTestValue.requireTests)
  ) {
    throw configValidationError(
      `${configPath} unitTest.requireTests must be newFiles or changedFiles`,
    );
  }

  const normalizePatterns = (field, defaults, { allowEmpty = false } = {}) => {
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
    throw configValidationError(`${configPath} unitTest.mappings must be a non-empty array`);
  }
  const allowedTemplatePlaceholders = /\{(?:dir|ext|name|path)\}/g;
  const unitTestMappings = unitTestMappingsValue.map((mapping, index) => {
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

  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw configValidationError(`${configPath} preCommit must be an object`);
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
    throw configValidationError(`${configPath} preCommit.filePlacement must be an object`);
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
    throw configValidationError(`${configPath} preCommit.filePlacement.enabled must be a boolean`);
  }
  if (
    filePlacementValue.mode != null
    && !['newFiles', 'changedFiles'].includes(filePlacementValue.mode)
  ) {
    throw configValidationError(
      `${configPath} preCommit.filePlacement.mode must be newFiles or changedFiles`,
    );
  }
  const filePlacementRulesValue = filePlacementValue.rules
    ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  if (!Array.isArray(filePlacementRulesValue) || filePlacementRulesValue.length === 0) {
    throw configValidationError(`${configPath} preCommit.filePlacement.rules must be a non-empty array`);
  }
  const filePlacementRules = filePlacementRulesValue.map((rule, index) => {
    const label = `${configPath} preCommit.filePlacement rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${label} must be an object`);
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
      throw configValidationError(`${label}.name must be a non-empty string`);
    }
    const suggestedDirectory = normalizeRelativePattern(
      rule.suggestedDirectory,
      `${label}.suggestedDirectory`,
    ).replace(/\/$/, '');
    if (['*', '?', '{', '}', '[', ']', '!'].some((character) => (
      suggestedDirectory.includes(character)
    ))) {
      throw configValidationError(`${label}.suggestedDirectory must be a concrete directory`);
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
    throw configValidationError(`${configPath} preCommit.maxFileLines must be an object`);
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
    throw configValidationError(`${configPath} preCommit.maxFileLines.enabled must be a boolean`);
  }
  if (
    maxFileLinesValue.mode != null
    && !['strict', 'noRegression'].includes(maxFileLinesValue.mode)
  ) {
    throw configValidationError(
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
    throw configValidationError(`${configPath} preCommit.maxFileLines.warnAt must be greater than 0 and at most 1`);
  }

  const maxFileLineRulesValue = maxFileLinesValue.rules
    ?? DEFAULT_MAX_FILE_LINES_CONFIG.rules;
  if (!Array.isArray(maxFileLineRulesValue) || maxFileLineRulesValue.length === 0) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.rules must be a non-empty array`);
  }
  const maxFileLineRules = maxFileLineRulesValue.map((rule, index) => {
    const label = `${configPath} preCommit.maxFileLines rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${label} must be an object`);
    }
    assertKnownProperties(rule, new Set(['pattern', 'maxLines']), label);
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw configValidationError(`${label}.pattern must be a non-empty string`);
    }
    if (!Number.isInteger(rule.maxLines) || rule.maxLines <= 0) {
      throw configValidationError(`${label}.maxLines must be a positive integer`);
    }
    return {
      pattern: normalizeGitPath(rule.pattern.trim()),
      maxLines: rule.maxLines,
    };
  });

  const maxFileLineExclusionsValue = maxFileLinesValue.exclusions
    ?? DEFAULT_MAX_FILE_LINES_CONFIG.exclusions;
  if (!Array.isArray(maxFileLineExclusionsValue)) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.exclusions must be an array`);
  }
  const maxFileLineExclusions = maxFileLineExclusionsValue.map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw configValidationError(
        `${configPath} preCommit.maxFileLines exclusion ${index + 1} must be a non-empty string`,
      );
    }
    return normalizeGitPath(pattern.trim());
  });

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
    accessibilityTest: {
      enabled: accessibilityTestValue.enabled
        ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.enabled,
      script: accessibilityTestValue.script?.trim()
        || DEFAULT_ACCESSIBILITY_TEST_CONFIG.script,
      timeoutMs: accessibilityTestValue.timeoutMs
        ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.timeoutMs,
      testPatterns: accessibilityTestPatterns,
    },
    unitTest: {
      enabled: unitTestEnabled,
      script: unitTestValue.script?.trim() || DEFAULT_UNIT_TEST_CONFIG.script,
      timeoutMs: unitTestValue.timeoutMs ?? DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
      coverage: unitTestCoverage,
      componentInteraction: {
        enabled: componentInteractionEnabled,
        componentPatterns: componentInteractionPatterns,
      },
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

import { DEFAULT_ARCHITECTURE_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

export function validateArchitectureConfiguration(value, configPath) {
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

  return {
    enabled: architectureValue.enabled ?? DEFAULT_ARCHITECTURE_CONFIG.enabled,
    timeoutMs: architectureValue.timeoutMs ?? DEFAULT_ARCHITECTURE_CONFIG.timeoutMs,
    sourcePaths: architectureSourcePaths,
    tsConfig: architectureTsConfig,
    exclude: architectureExclude,
    rules: architectureRules,
  };
}

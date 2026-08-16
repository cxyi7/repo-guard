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
    throw configValidationError(`${configPath} architecture 必须是对象`);
  }
  assertKnownProperties(
    architectureValue,
    new Set(['enabled', 'timeoutMs', 'sourcePaths', 'tsConfig', 'exclude', 'rules']),
    `${configPath} architecture`,
  );
  if (architectureValue.enabled != null && typeof architectureValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} architecture.enabled 必须是布尔值`);
  }
  if (architectureValue.timeoutMs != null
    && (!Number.isInteger(architectureValue.timeoutMs) || architectureValue.timeoutMs <= 0)) {
    throw configValidationError(`${configPath} architecture.timeoutMs 必须是正整数`);
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
    throw configValidationError(`${configPath} architecture.exclude 必须为 null 或非空正则表达式`);
  }
  if (architectureExclude !== null) {
    try {
      new RegExp(architectureExclude);
    } catch (error) {
      throw configValidationError(`${configPath} architecture.exclude 必须是有效的正则表达式： ${error.message}`);
    }
  }
  const architectureRulesValue = architectureValue.rules
    ?? DEFAULT_ARCHITECTURE_CONFIG.rules;
  if (!Array.isArray(architectureRulesValue) || architectureRulesValue.length === 0) {
    throw configValidationError(`${configPath} architecture.rules 必须是非空数组`);
  }
  const architectureRuleNames = new Set();
  const architectureRules = architectureRulesValue.map((rule, index) => {
    const label = `${configPath} architecture 规则 ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(
      rule,
      new Set(['name', 'comment', 'severity', 'from', 'to']),
      label,
    );
    if (typeof rule.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(rule.name)) {
      throw configValidationError(`${label}.name 必须是 kebab-case 标识符`);
    }
    if (architectureRuleNames.has(rule.name)) {
      throw configValidationError(`${configPath} architecture 规则名称重复： ${rule.name}`);
    }
    architectureRuleNames.add(rule.name);
    if (rule.comment != null && (typeof rule.comment !== 'string' || !rule.comment.trim())) {
      throw configValidationError(`${label}.comment 必须是非空字符串`);
    }
    const severity = rule.severity ?? 'error';
    if (!['error', 'warn', 'info', 'ignore'].includes(severity)) {
      throw configValidationError(`${label}.severity 必须为 error、warn、info 或 ignore`);
    }
    for (const conditionName of ['from', 'to']) {
      const condition = rule[conditionName];
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        throw configValidationError(`${label}.${conditionName} 必须是对象`);
      }
      for (const regexField of ['path', 'pathNot']) {
        if (condition[regexField] == null) continue;
        const patterns = Array.isArray(condition[regexField])
          ? condition[regexField]
          : [condition[regexField]];
        if (patterns.length === 0 || patterns.some((pattern) => (
          typeof pattern !== 'string' || !pattern
        ))) {
          throw configValidationError(`${label}.${conditionName}.${regexField} 必须包含正则表达式字符串`);
        }
        for (const pattern of patterns) {
          try {
            new RegExp(pattern);
          } catch (error) {
            throw configValidationError(
              `${label}.${conditionName}.${regexField} 必须是有效的正则表达式：${error.message}`,
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

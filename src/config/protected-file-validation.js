import { globToRegExp, normalizeGitPath } from './path-matching.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export const SUPPORTED_LEVELS = new Set(['notify', 'audit', 'block']);

export function validateProtectedFileConfigurationShape(value, configPath) {
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    throw configValidationError(`${configPath} 必须至少定义一条规则`);
  }
  if (value.exclusions != null && !Array.isArray(value.exclusions)) {
    throw configValidationError(`${configPath} exclusions 必须是数组`);
  }
}

export function normalizeProtectedFileConfiguration(value, configPath) {
  const rules = value.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw configValidationError(`${configPath} 规则 ${index + 1} 必须是对象`);
    }
    assertKnownProperties(
      rule,
      new Set(['pattern', 'category', 'level']),
      `${configPath} 规则 ${index + 1}`,
    );
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw configValidationError(`${configPath} 规则 ${index + 1} 缺少 pattern`);
    }
    if (typeof rule.category !== 'string' || !rule.category.trim()) {
      throw configValidationError(`${configPath} 规则 ${index + 1} 缺少 category`);
    }
    if (!SUPPORTED_LEVELS.has(rule.level)) {
      throw configValidationError(
        `${configPath} 规则 ${index + 1} 使用了不支持的级别： ${String(rule.level)}`,
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
      throw configValidationError(`${configPath} 排除项 ${index + 1} 必须是非空字符串`);
    }
    const normalized = normalizeGitPath(pattern.trim());
    return {
      pattern: normalized,
      matcher: globToRegExp(normalized),
    };
  });

  return { rules, exclusions };
}

import { DEFAULT_CODE_PLACEMENT_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

function normalizeCodePlacementRule(rule, index, configPath) {
  const label = `${configPath} codePlacement 规则 ${index + 1}`;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    rule,
    new Set(['name', 'content', 'allowedFiles', 'scanPatterns']),
    label,
  );
  if (typeof rule.name !== 'string' || !rule.name.trim()) {
    throw configValidationError(`${label}.name 必须是非空字符串`);
  }
  if (typeof rule.content !== 'string' || !rule.content.trim()) {
    throw configValidationError(`${label}.content 必须是非空代码文本`);
  }
  return {
    name: rule.name.trim(),
    content: rule.content.replace(/\r\n?/g, '\n'),
    allowedFiles: normalizePatternList(rule.allowedFiles, `${label}.allowedFiles`),
    scanPatterns: normalizePatternList(rule.scanPatterns, `${label}.scanPatterns`),
  };
}

export function validateCodePlacementConfiguration(value, configPath) {
  const codePlacementValue = value.codePlacement ?? DEFAULT_CODE_PLACEMENT_CONFIG;
  if (
    !codePlacementValue
    || typeof codePlacementValue !== 'object'
    || Array.isArray(codePlacementValue)
  ) {
    throw configValidationError(`${configPath} codePlacement 必须是对象`);
  }
  assertKnownProperties(
    codePlacementValue,
    new Set(['enabled', 'rules']),
    `${configPath} codePlacement`,
  );
  if (
    codePlacementValue.enabled != null
    && typeof codePlacementValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} codePlacement.enabled 必须是布尔值`);
  }
  const rules = codePlacementValue.rules ?? DEFAULT_CODE_PLACEMENT_CONFIG.rules;
  if (!Array.isArray(rules)) {
    throw configValidationError(`${configPath} codePlacement.rules 必须是数组`);
  }
  const enabled = codePlacementValue.enabled ?? DEFAULT_CODE_PLACEMENT_CONFIG.enabled;
  if (enabled && rules.length === 0) {
    throw configValidationError(
      `${configPath} codePlacement.enabled 为 true 时 rules 必须至少包含一条规则`,
    );
  }
  return {
    enabled,
    rules: rules.map((rule, index) => normalizeCodePlacementRule(rule, index, configPath)),
  };
}

import { DEFAULT_PRETTIER_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validatePrettierConfiguration(checksValue, configPath) {
  const prettierValue = checksValue.prettier ?? {};
  if (!prettierValue || typeof prettierValue !== 'object' || Array.isArray(prettierValue)) {
    throw configValidationError(`${configPath} checks.prettier 必须是对象`);
  }
  assertKnownProperties(
    prettierValue,
    new Set(['enabled', 'pattern', 'fix', 'requireConfig']),
    `${configPath} checks.prettier`,
  );
  if (prettierValue.enabled != null && typeof prettierValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.prettier.enabled 必须是布尔值`);
  }
  if (
    prettierValue.pattern != null
    && (typeof prettierValue.pattern !== 'string' || !prettierValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} checks.prettier.pattern 必须是非空字符串`);
  }
  if (prettierValue.fix != null && typeof prettierValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} checks.prettier.fix 必须是布尔值`);
  }
  if (
    prettierValue.requireConfig != null
    && typeof prettierValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(`${configPath} checks.prettier.requireConfig 必须是布尔值`);
  }
  return {
    enabled: prettierValue.enabled ?? DEFAULT_PRETTIER_CONFIG.enabled,
    pattern: prettierValue.pattern?.trim() || DEFAULT_PRETTIER_CONFIG.pattern,
    fix: prettierValue.fix ?? DEFAULT_PRETTIER_CONFIG.fix,
    requireConfig: prettierValue.requireConfig ?? DEFAULT_PRETTIER_CONFIG.requireConfig,
  };
}

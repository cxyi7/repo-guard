import { DEFAULT_ESLINT_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateEslintConfiguration(checksValue, configPath) {
  const eslintValue = checksValue.eslint ?? {};
  if (!eslintValue || typeof eslintValue !== 'object' || Array.isArray(eslintValue)) {
    throw configValidationError(`${configPath} checks.eslint 必须是对象`);
  }
  assertKnownProperties(
    eslintValue,
    new Set(['enabled', 'preset', 'pattern', 'fix', 'maxWarnings']),
    `${configPath} checks.eslint`,
  );
  if (eslintValue.enabled != null && typeof eslintValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} checks.eslint.enabled 必须是布尔值`);
  }
  if (eslintValue.preset != null && typeof eslintValue.preset !== 'boolean') {
    throw configValidationError(`${configPath} checks.eslint.preset 必须是布尔值`);
  }
  if (
    eslintValue.pattern != null
    && (typeof eslintValue.pattern !== 'string' || !eslintValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} checks.eslint.pattern 必须是非空字符串`);
  }
  if (eslintValue.fix != null && typeof eslintValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} checks.eslint.fix 必须是布尔值`);
  }
  if (
    eslintValue.maxWarnings != null
    && (!Number.isInteger(eslintValue.maxWarnings) || eslintValue.maxWarnings < 0)
  ) {
    throw configValidationError(`${configPath} checks.eslint.maxWarnings 必须是非负整数`);
  }
  return {
    enabled: eslintValue.enabled ?? DEFAULT_ESLINT_CONFIG.enabled,
    preset: eslintValue.preset ?? DEFAULT_ESLINT_CONFIG.preset,
    pattern: eslintValue.pattern?.trim() || DEFAULT_ESLINT_CONFIG.pattern,
    fix: eslintValue.fix ?? DEFAULT_ESLINT_CONFIG.fix,
    maxWarnings: eslintValue.maxWarnings ?? DEFAULT_ESLINT_CONFIG.maxWarnings,
  };
}

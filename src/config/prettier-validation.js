import { DEFAULT_PRETTIER_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validatePrettierConfiguration(preCommitValue, configPath) {
  const prettierValue = preCommitValue.prettier ?? {};
  if (!prettierValue || typeof prettierValue !== 'object' || Array.isArray(prettierValue)) {
    throw configValidationError(`${configPath} preCommit.prettier 必须是对象`);
  }
  assertKnownProperties(
    prettierValue,
    new Set(['enabled', 'pattern', 'fix', 'requireConfig']),
    `${configPath} preCommit.prettier`,
  );
  if (prettierValue.enabled != null && typeof prettierValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.prettier.enabled 必须是布尔值`);
  }
  if (
    prettierValue.pattern != null
    && (typeof prettierValue.pattern !== 'string' || !prettierValue.pattern.trim())
  ) {
    throw configValidationError(`${configPath} preCommit.prettier.pattern 必须是非空字符串`);
  }
  if (prettierValue.fix != null && typeof prettierValue.fix !== 'boolean') {
    throw configValidationError(`${configPath} preCommit.prettier.fix 必须是布尔值`);
  }
  if (
    prettierValue.requireConfig != null
    && typeof prettierValue.requireConfig !== 'boolean'
  ) {
    throw configValidationError(`${configPath} preCommit.prettier.requireConfig 必须是布尔值`);
  }
  return {
    enabled: prettierValue.enabled ?? DEFAULT_PRETTIER_CONFIG.enabled,
    pattern: prettierValue.pattern?.trim() || DEFAULT_PRETTIER_CONFIG.pattern,
    fix: prettierValue.fix ?? DEFAULT_PRETTIER_CONFIG.fix,
    requireConfig: prettierValue.requireConfig ?? DEFAULT_PRETTIER_CONFIG.requireConfig,
  };
}

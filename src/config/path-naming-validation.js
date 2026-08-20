import {
  DEFAULT_PATH_NAMING_CONFIG,
  SUPPORTED_PATH_NAMING_CONVENTIONS,
} from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

export function validatePathNamingConfiguration(preCommitValue, configPath) {
  const value = preCommitValue.pathNaming ?? {};
  const label = `${configPath} preCommit.pathNaming`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    value,
    new Set(['enabled', 'convention', 'include', 'exclude']),
    label,
  );
  if (value.enabled != null && typeof value.enabled !== 'boolean') {
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  }
  const convention = value.convention ?? DEFAULT_PATH_NAMING_CONFIG.convention;
  if (!SUPPORTED_PATH_NAMING_CONVENTIONS.includes(convention)) {
    throw configValidationError(
      `${label}.convention 必须是 camelCase 或 kebab-case 中的一个字符串值`,
    );
  }
  return {
    enabled: value.enabled ?? DEFAULT_PATH_NAMING_CONFIG.enabled,
    convention,
    include: normalizePatternList(
      value.include ?? DEFAULT_PATH_NAMING_CONFIG.include,
      `${label}.include`,
    ),
    exclude: normalizePatternList(
      value.exclude ?? DEFAULT_PATH_NAMING_CONFIG.exclude,
      `${label}.exclude`,
      { allowEmpty: true },
    ),
  };
}

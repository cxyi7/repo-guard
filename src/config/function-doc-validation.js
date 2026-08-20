import {
  DEFAULT_FUNCTION_DOC_CONFIG,
  SUPPORTED_FUNCTION_DOC_EXTENSIONS,
} from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

function normalizeExtensions(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw configValidationError(`${label} 必须是非空数组`);
  }
  const supported = new Set(SUPPORTED_FUNCTION_DOC_EXTENSIONS);
  const normalized = value.map((extension, index) => {
    if (typeof extension !== 'string' || !supported.has(extension)) {
      throw configValidationError(
        `${label} 第 ${index + 1} 项必须是受支持的文件扩展名：${SUPPORTED_FUNCTION_DOC_EXTENSIONS.join(', ')}`,
      );
    }
    return extension;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw configValidationError(`${label} 不得包含重复扩展名`);
  }
  return normalized;
}

export function validateFunctionDocConfiguration(preCommitValue, configPath) {
  const value = preCommitValue.functionDocs ?? {};
  const label = `${configPath} preCommit.functionDocs`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    value,
    new Set(['enabled', 'include', 'exclude', 'extensions']),
    label,
  );
  if (value.enabled != null && typeof value.enabled !== 'boolean') {
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  }
  return {
    enabled: value.enabled ?? DEFAULT_FUNCTION_DOC_CONFIG.enabled,
    include: normalizePatternList(
      value.include ?? DEFAULT_FUNCTION_DOC_CONFIG.include,
      `${label}.include`,
    ),
    exclude: normalizePatternList(
      value.exclude ?? DEFAULT_FUNCTION_DOC_CONFIG.exclude,
      `${label}.exclude`,
      { allowEmpty: true },
    ),
    extensions: normalizeExtensions(
      value.extensions ?? DEFAULT_FUNCTION_DOC_CONFIG.extensions,
      `${label}.extensions`,
    ),
  };
}

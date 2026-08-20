import {
  DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
  SUPPORTED_ASYNC_RESOURCE_CLEANUP_EXTENSIONS,
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
  const supported = new Set(SUPPORTED_ASYNC_RESOURCE_CLEANUP_EXTENSIONS);
  const extensions = value.map((extension, index) => {
    if (typeof extension !== 'string' || !supported.has(extension)) {
      throw configValidationError(
        `${label} 第 ${index + 1} 项必须是受支持的文件扩展名：${SUPPORTED_ASYNC_RESOURCE_CLEANUP_EXTENSIONS.join(', ')}`,
      );
    }
    return extension;
  });
  if (new Set(extensions).size !== extensions.length) {
    throw configValidationError(`${label} 不得包含重复扩展名`);
  }
  return extensions;
}

function normalizeRequestFunctions(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw configValidationError(`${label} 必须是非空数组`);
  }
  const functions = value.map((name, index) => {
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name)) {
      throw configValidationError(`${label} 第 ${index + 1} 项必须是静态函数名或成员路径`);
    }
    return name;
  });
  if (new Set(functions).size !== functions.length) {
    throw configValidationError(`${label} 不得包含重复函数名`);
  }
  return functions;
}

export function validateAsyncResourceCleanupConfiguration(preCommitValue, configPath) {
  const value = preCommitValue.asyncResourceCleanup ?? {};
  const label = `${configPath} preCommit.asyncResourceCleanup`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(value, new Set([
    'enabled',
    'include',
    'exclude',
    'extensions',
    'timeoutThresholdMs',
    'requestFunctions',
  ]), label);
  if (value.enabled != null && typeof value.enabled !== 'boolean') {
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  }
  const timeoutThresholdMs = value.timeoutThresholdMs
    ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.timeoutThresholdMs;
  if (!Number.isInteger(timeoutThresholdMs) || timeoutThresholdMs < 0) {
    throw configValidationError(`${label}.timeoutThresholdMs 必须是大于或等于 0 的整数`);
  }
  return {
    enabled: value.enabled ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.enabled,
    include: normalizePatternList(
      value.include ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.include,
      `${label}.include`,
    ),
    exclude: normalizePatternList(
      value.exclude ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.exclude,
      `${label}.exclude`,
      { allowEmpty: true },
    ),
    extensions: normalizeExtensions(
      value.extensions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.extensions,
      `${label}.extensions`,
    ),
    timeoutThresholdMs,
    requestFunctions: normalizeRequestFunctions(
      value.requestFunctions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.requestFunctions,
      `${label}.requestFunctions`,
    ),
  };
}

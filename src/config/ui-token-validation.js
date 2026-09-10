import { DEFAULT_UI_TOKENS_CONFIG, UI_TOKEN_LANGUAGES } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

function booleanValue(value, fallback, label) {
  const normalized = value === undefined ? fallback : value;
  if (typeof normalized !== 'boolean') {
    throw configValidationError(`${label} 必须是布尔值`);
  }
  return normalized;
}

function stringList(value, fallback, label) {
  const normalized = value === undefined ? fallback : value;
  if (!Array.isArray(normalized) || normalized.length === 0) {
    throw configValidationError(`${label} 必须是非空字符串数组`);
  }
  if (normalized.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw configValidationError(`${label} 只能包含非空字符串`);
  }
  const trimmed = normalized.map((entry) => entry.trim());
  if (new Set(trimmed).size !== trimmed.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
  return trimmed;
}

function relativeFile(value, label) {
  const normalized = normalizeRelativePattern(value, label);
  if (/[*?{}[\]]/.test(normalized)) {
    throw configValidationError(`${label} 必须是确定文件路径，不得包含 glob`);
  }
  return normalized;
}

export function validateUiTokenConfiguration(value, configPath) {
  const uiTokensValue = value.uiTokens === undefined ? {} : value.uiTokens;
  if (!uiTokensValue || typeof uiTokensValue !== 'object' || Array.isArray(uiTokensValue)) {
    throw configValidationError(`${configPath} checks.uiTokens 必须是对象`);
  }
  assertKnownProperties(
    uiTokensValue,
    new Set(['enabled', 'languages', 'manifestFile', 'include', 'exclude', 'iconSelectors']),
    `${configPath} checks.uiTokens`,
  );
  const languages = stringList(
    uiTokensValue.languages,
    DEFAULT_UI_TOKENS_CONFIG.languages,
    `${configPath} checks.uiTokens.languages`,
  );
  if (languages.some((language) => !UI_TOKEN_LANGUAGES.includes(language))) {
    throw configValidationError(
      `${configPath} checks.uiTokens.languages 仅支持 ${UI_TOKEN_LANGUAGES.join('、')}`,
    );
  }
  const enabled = booleanValue(
    uiTokensValue.enabled,
    DEFAULT_UI_TOKENS_CONFIG.enabled,
    `${configPath} checks.uiTokens.enabled`,
  );
  return {
    enabled,
    languages,
    manifestFile: relativeFile(
      uiTokensValue.manifestFile === undefined ? DEFAULT_UI_TOKENS_CONFIG.manifestFile : uiTokensValue.manifestFile,
      `${configPath} checks.uiTokens.manifestFile`,
    ),
    include: normalizePatternList(
      uiTokensValue.include === undefined ? DEFAULT_UI_TOKENS_CONFIG.include : uiTokensValue.include,
      `${configPath} checks.uiTokens.include`,
    ),
    exclude: normalizePatternList(
      uiTokensValue.exclude === undefined ? DEFAULT_UI_TOKENS_CONFIG.exclude : uiTokensValue.exclude,
      `${configPath} checks.uiTokens.exclude`,
      { allowEmpty: true },
    ),
    iconSelectors: stringList(
      uiTokensValue.iconSelectors,
      DEFAULT_UI_TOKENS_CONFIG.iconSelectors,
      `${configPath} checks.uiTokens.iconSelectors`,
    ),
  };
}

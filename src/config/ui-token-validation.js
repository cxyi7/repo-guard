import { DEFAULT_UI_TOKENS_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

function booleanValue(value, fallback, label) {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'boolean') {
    throw configValidationError(`${label} 必须是布尔值`);
  }
  return normalized;
}

function stringList(value, fallback, label) {
  const normalized = value ?? fallback;
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

function validateSassAdapter(value, configPath) {
  const adapter = value ?? {};
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw configValidationError(`${configPath} uiTokens.adapters.sass 必须是对象`);
  }
  assertKnownProperties(
    adapter,
    new Set(['enabled']),
    `${configPath} uiTokens.adapters.sass`,
  );
  return {
    enabled: booleanValue(
      adapter.enabled,
      DEFAULT_UI_TOKENS_CONFIG.adapters.sass.enabled,
      `${configPath} uiTokens.adapters.sass.enabled`,
    ),
  };
}

function validateUnoCssAdapter(value, configPath) {
  const adapter = value ?? {};
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw configValidationError(`${configPath} uiTokens.adapters.unocss 必须是对象`);
  }
  assertKnownProperties(
    adapter,
    new Set(['enabled', 'configFiles', 'attributify', 'variantGroups']),
    `${configPath} uiTokens.adapters.unocss`,
  );
  return {
    enabled: booleanValue(
      adapter.enabled,
      DEFAULT_UI_TOKENS_CONFIG.adapters.unocss.enabled,
      `${configPath} uiTokens.adapters.unocss.enabled`,
    ),
    configFiles: stringList(
      adapter.configFiles,
      DEFAULT_UI_TOKENS_CONFIG.adapters.unocss.configFiles,
      `${configPath} uiTokens.adapters.unocss.configFiles`,
    ).map((file, index) => relativeFile(
      file,
      `${configPath} uiTokens.adapters.unocss.configFiles 第 ${index + 1} 项`,
    )),
    attributify: booleanValue(
      adapter.attributify,
      DEFAULT_UI_TOKENS_CONFIG.adapters.unocss.attributify,
      `${configPath} uiTokens.adapters.unocss.attributify`,
    ),
    variantGroups: booleanValue(
      adapter.variantGroups,
      DEFAULT_UI_TOKENS_CONFIG.adapters.unocss.variantGroups,
      `${configPath} uiTokens.adapters.unocss.variantGroups`,
    ),
  };
}

function validateIconConfig(value, configPath) {
  const icon = value ?? {};
  if (!icon || typeof icon !== 'object' || Array.isArray(icon)) {
    throw configValidationError(`${configPath} uiTokens.icon 必须是对象`);
  }
  assertKnownProperties(
    icon,
    new Set(['components', 'nativeSvg', 'sassSelectors']),
    `${configPath} uiTokens.icon`,
  );
  return {
    components: stringList(
      icon.components,
      DEFAULT_UI_TOKENS_CONFIG.icon.components,
      `${configPath} uiTokens.icon.components`,
    ),
    nativeSvg: booleanValue(
      icon.nativeSvg,
      DEFAULT_UI_TOKENS_CONFIG.icon.nativeSvg,
      `${configPath} uiTokens.icon.nativeSvg`,
    ),
    sassSelectors: stringList(
      icon.sassSelectors,
      DEFAULT_UI_TOKENS_CONFIG.icon.sassSelectors,
      `${configPath} uiTokens.icon.sassSelectors`,
    ),
  };
}

export function validateUiTokenConfiguration(value, configPath) {
  const uiTokensValue = value.uiTokens ?? {};
  if (!uiTokensValue || typeof uiTokensValue !== 'object' || Array.isArray(uiTokensValue)) {
    throw configValidationError(`${configPath} uiTokens 必须是对象`);
  }
  assertKnownProperties(
    uiTokensValue,
    new Set(['enabled', 'manifestFile', 'include', 'exclude', 'adapters', 'icon']),
    `${configPath} uiTokens`,
  );
  const adaptersValue = uiTokensValue.adapters ?? {};
  if (!adaptersValue || typeof adaptersValue !== 'object' || Array.isArray(adaptersValue)) {
    throw configValidationError(`${configPath} uiTokens.adapters 必须是对象`);
  }
  assertKnownProperties(
    adaptersValue,
    new Set(['sass', 'unocss']),
    `${configPath} uiTokens.adapters`,
  );
  const adapters = {
    sass: validateSassAdapter(adaptersValue.sass, configPath),
    unocss: validateUnoCssAdapter(adaptersValue.unocss, configPath),
  };
  const enabled = booleanValue(
    uiTokensValue.enabled,
    DEFAULT_UI_TOKENS_CONFIG.enabled,
    `${configPath} uiTokens.enabled`,
  );
  if (enabled && !Object.values(adapters).some((adapter) => adapter.enabled)) {
    throw configValidationError(
      `${configPath} uiTokens 启用时至少要启用 sass 或 unocss 适配器`,
    );
  }
  return {
    enabled,
    manifestFile: relativeFile(
      uiTokensValue.manifestFile ?? DEFAULT_UI_TOKENS_CONFIG.manifestFile,
      `${configPath} uiTokens.manifestFile`,
    ),
    include: normalizePatternList(
      uiTokensValue.include ?? DEFAULT_UI_TOKENS_CONFIG.include,
      `${configPath} uiTokens.include`,
    ),
    exclude: normalizePatternList(
      uiTokensValue.exclude ?? DEFAULT_UI_TOKENS_CONFIG.exclude,
      `${configPath} uiTokens.exclude`,
      { allowEmpty: true },
    ),
    adapters,
    icon: validateIconConfig(uiTokensValue.icon, configPath),
  };
}

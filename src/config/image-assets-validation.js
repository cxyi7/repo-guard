import {
  DEFAULT_IMAGE_ASSETS_CONFIG,
  SUPPORTED_IMAGE_ASSET_EXTENSIONS,
  SUPPORTED_PATH_NAMING_CONVENTIONS,
} from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

const ACTIONS = Object.freeze(['off', 'report', 'error']);

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  return value;
}

function booleanValue(value, fallback, label) {
  if (value != null && typeof value !== 'boolean') {
    throw configValidationError(`${label} 必须是布尔值`);
  }
  return value ?? fallback;
}

function integerValue(value, fallback, label, { min, max }) {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw configValidationError(`${label} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return normalized;
}

function enumValue(value, fallback, allowed, label) {
  const normalized = value ?? fallback;
  if (!allowed.includes(normalized)) {
    throw configValidationError(`${label} 必须是 ${allowed.join('、')} 中的一项`);
  }
  return normalized;
}

function uniqueStrings(value, fallback, label, allowed = null) {
  const normalized = value ?? fallback;
  if (!Array.isArray(normalized) || normalized.length === 0
    || normalized.some((item) => typeof item !== 'string' || !item.trim())) {
    throw configValidationError(`${label} 必须是非空字符串数组`);
  }
  const result = normalized.map((item) => item.trim());
  if (new Set(result).size !== result.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
  if (allowed && result.some((item) => !allowed.includes(item))) {
    throw configValidationError(`${label} 包含不支持的值`);
  }
  return result;
}

function validateNaming(value, label) {
  const naming = objectValue(value ?? {}, label);
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG.naming;
  assertKnownProperties(
    naming,
    new Set([
      'enabled',
      'convention',
      'lowercaseExtension',
      'densitySuffixes',
      'allowNinePatch',
    ]),
    label,
  );
  const convention = enumValue(
    naming.convention,
    defaults.convention,
    SUPPORTED_PATH_NAMING_CONVENTIONS,
    `${label}.convention`,
  );
  const densitySuffixes = uniqueStrings(
    naming.densitySuffixes,
    defaults.densitySuffixes,
    `${label}.densitySuffixes`,
  );
  if (densitySuffixes.some((suffix) => !/^@[2-9]x$/.test(suffix))) {
    throw configValidationError(`${label}.densitySuffixes 只能使用 @2x 到 @9x`);
  }
  return {
    enabled: booleanValue(naming.enabled, defaults.enabled, `${label}.enabled`),
    convention,
    lowercaseExtension: booleanValue(
      naming.lowercaseExtension,
      defaults.lowercaseExtension,
      `${label}.lowercaseExtension`,
    ),
    densitySuffixes,
    allowNinePatch: booleanValue(
      naming.allowNinePatch,
      defaults.allowNinePatch,
      `${label}.allowNinePatch`,
    ),
  };
}

function validateDuplicates(value, label) {
  const duplicates = objectValue(value ?? {}, label);
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG.duplicates;
  assertKnownProperties(duplicates, new Set(['exact', 'pixel', 'canonicalRoots']), label);
  return {
    exact: enumValue(duplicates.exact, defaults.exact, ['off', 'error'], `${label}.exact`),
    pixel: enumValue(duplicates.pixel, defaults.pixel, ACTIONS, `${label}.pixel`),
    canonicalRoots: uniqueStrings(
      duplicates.canonicalRoots,
      defaults.canonicalRoots,
      `${label}.canonicalRoots`,
    ).map((root, index) => normalizeRelativePattern(root, `${label}.canonicalRoots ${index + 1}`)),
  };
}

function validateConversion(value, label) {
  const conversion = objectValue(value ?? {}, label);
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion;
  assertKnownProperties(
    conversion,
    new Set([
      'enabled',
      'target',
      'sourceFormats',
      'action',
      'minInputBytes',
      'minSavingsBytes',
      'minSavingsPercent',
      'pngMode',
      'jpegQuality',
      'effort',
      'exactAlpha',
      'allowFallbackOriginal',
    ]),
    label,
  );
  return {
    enabled: booleanValue(conversion.enabled, defaults.enabled, `${label}.enabled`),
    target: enumValue(conversion.target, defaults.target, ['webp'], `${label}.target`),
    sourceFormats: uniqueStrings(
      conversion.sourceFormats,
      defaults.sourceFormats,
      `${label}.sourceFormats`,
      ['png', 'jpg', 'jpeg'],
    ),
    action: enumValue(conversion.action, defaults.action, ['report', 'error'], `${label}.action`),
    minInputBytes: integerValue(
      conversion.minInputBytes,
      defaults.minInputBytes,
      `${label}.minInputBytes`,
      { min: 0, max: 200000000 },
    ),
    minSavingsBytes: integerValue(
      conversion.minSavingsBytes,
      defaults.minSavingsBytes,
      `${label}.minSavingsBytes`,
      { min: 1, max: 200000000 },
    ),
    minSavingsPercent: integerValue(
      conversion.minSavingsPercent,
      defaults.minSavingsPercent,
      `${label}.minSavingsPercent`,
      { min: 1, max: 99 },
    ),
    pngMode: enumValue(conversion.pngMode, defaults.pngMode, ['lossless', 'lossy'], `${label}.pngMode`),
    jpegQuality: integerValue(
      conversion.jpegQuality,
      defaults.jpegQuality,
      `${label}.jpegQuality`,
      { min: 1, max: 100 },
    ),
    effort: integerValue(conversion.effort, defaults.effort, `${label}.effort`, { min: 0, max: 6 }),
    exactAlpha: booleanValue(conversion.exactAlpha, defaults.exactAlpha, `${label}.exactAlpha`),
    allowFallbackOriginal: booleanValue(
      conversion.allowFallbackOriginal,
      defaults.allowFallbackOriginal,
      `${label}.allowFallbackOriginal`,
    ),
  };
}

function validateCompression(value, label) {
  const compression = objectValue(value ?? {}, label);
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG.compression;
  assertKnownProperties(
    compression,
    new Set([
      'enabled',
      'action',
      'minInputBytes',
      'minSavingsBytes',
      'minSavingsPercent',
      'raster',
      'svg',
      'conversion',
    ]),
    label,
  );
  const raster = objectValue(compression.raster ?? {}, `${label}.raster`);
  assertKnownProperties(raster, new Set(['enabled', 'allowLossy', 'metadata']), `${label}.raster`);
  const svg = objectValue(compression.svg ?? {}, `${label}.svg`);
  assertKnownProperties(svg, new Set(['enabled', 'allowWrite']), `${label}.svg`);
  return {
    enabled: booleanValue(compression.enabled, defaults.enabled, `${label}.enabled`),
    action: enumValue(compression.action, defaults.action, ['report', 'error'], `${label}.action`),
    minInputBytes: integerValue(compression.minInputBytes, defaults.minInputBytes, `${label}.minInputBytes`, { min: 0, max: 200000000 }),
    minSavingsBytes: integerValue(compression.minSavingsBytes, defaults.minSavingsBytes, `${label}.minSavingsBytes`, { min: 1, max: 200000000 }),
    minSavingsPercent: integerValue(compression.minSavingsPercent, defaults.minSavingsPercent, `${label}.minSavingsPercent`, { min: 1, max: 99 }),
    raster: {
      enabled: booleanValue(raster.enabled, defaults.raster.enabled, `${label}.raster.enabled`),
      allowLossy: booleanValue(raster.allowLossy, defaults.raster.allowLossy, `${label}.raster.allowLossy`),
      metadata: enumValue(raster.metadata, defaults.raster.metadata, ['preserve', 'strip'], `${label}.raster.metadata`),
    },
    svg: {
      enabled: booleanValue(svg.enabled, defaults.svg.enabled, `${label}.svg.enabled`),
      allowWrite: booleanValue(svg.allowWrite, defaults.svg.allowWrite, `${label}.svg.allowWrite`),
    },
    conversion: validateConversion(compression.conversion, `${label}.conversion`),
  };
}

function validateLimits(value, label) {
  const limits = objectValue(value ?? {}, label);
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG.limits;
  assertKnownProperties(limits, new Set(['maxInputBytes', 'maxPixels', 'maxFrames']), label);
  return {
    maxInputBytes: integerValue(limits.maxInputBytes, defaults.maxInputBytes, `${label}.maxInputBytes`, { min: 1024, max: 200000000 }),
    maxPixels: integerValue(limits.maxPixels, defaults.maxPixels, `${label}.maxPixels`, { min: 1, max: 100000000 }),
    maxFrames: integerValue(limits.maxFrames, defaults.maxFrames, `${label}.maxFrames`, { min: 1, max: 1000 }),
  };
}

export function validateImageAssetsConfiguration(value, configPath) {
  const imageAssets = objectValue(value.imageAssets ?? {}, `${configPath} imageAssets`);
  const label = `${configPath} imageAssets`;
  assertKnownProperties(
    imageAssets,
    new Set([
      'enabled',
      'enforcement',
      'include',
      'exclude',
      'extensions',
      'naming',
      'duplicates',
      'compression',
      'limits',
    ]),
    label,
  );
  const defaults = DEFAULT_IMAGE_ASSETS_CONFIG;
  return {
    enabled: booleanValue(imageAssets.enabled, defaults.enabled, `${label}.enabled`),
    enforcement: enumValue(imageAssets.enforcement, defaults.enforcement, ['changedFiles', 'allFiles'], `${label}.enforcement`),
    include: normalizePatternList(imageAssets.include ?? defaults.include, `${label}.include`),
    exclude: normalizePatternList(imageAssets.exclude ?? defaults.exclude, `${label}.exclude`, { allowEmpty: true }),
    extensions: uniqueStrings(imageAssets.extensions, defaults.extensions, `${label}.extensions`, SUPPORTED_IMAGE_ASSET_EXTENSIONS),
    naming: validateNaming(imageAssets.naming, `${label}.naming`),
    duplicates: validateDuplicates(imageAssets.duplicates, `${label}.duplicates`),
    compression: validateCompression(imageAssets.compression, `${label}.compression`),
    limits: validateLimits(imageAssets.limits, `${label}.limits`),
  };
}

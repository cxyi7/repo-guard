import { DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizeRelativePattern,
} from './validation-primitives.js';

const PC_LIMIT_KEYS = Object.freeze([
  'totalRawBytes',
  'initialJsRawBytes',
  'initialJsGzipBytes',
  'initialJsBrotliBytes',
  'initialCssRawBytes',
  'initialCssGzipBytes',
  'initialCssBrotliBytes',
  'maxChunkRawBytes',
  'maxChunkCount',
  'maxAssetRawBytes',
]);
const MINI_PROGRAM_LIMIT_KEYS = Object.freeze([
  'mainPackageBytes',
  'defaultSubPackageBytes',
  'totalPackageBytes',
  'maxSingleFileBytes',
  'maxPreloadBytes',
]);
const WEIXIN_NON_UPLOAD_FILES = new Set([
  '.DS_Store',
  'project.config.json',
  'project.private.config.json',
]);
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function normalizePlainRelativePath(value, label) {
  const normalized = normalizeRelativePattern(value, label);
  if (
    normalized === '.'
    || normalized.endsWith('/')
    || normalized.includes('//')
    || [...'<>:"|?*[]{}'].some((character) => normalized.includes(character))
    || normalized.split('/').some((segment) => segment === '.' || WINDOWS_RESERVED_SEGMENT.test(segment))
  ) {
    throw configValidationError(`${label} 必须是不含 glob、空路径段或系统保留名称的仓库相对路径`);
  }
  return normalized;
}

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  return value;
}

function optionalPositiveInteger(value, label) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw configValidationError(`${label} 必须是正整数或 null`);
  }
  return value;
}

function normalizeLimits(value, label, keys, { requireOne = true } = {}) {
  const limits = objectValue(value ?? {}, label);
  assertKnownProperties(limits, new Set(keys), label);
  const normalized = Object.fromEntries(keys.map((key) => [
    key,
    optionalPositiveInteger(limits[key], `${label}.${key}`),
  ]));
  if (requireOne && Object.values(normalized).every((item) => item == null)) {
    throw configValidationError(`${label} 至少需要配置一个限制`);
  }
  return normalized;
}

function normalizeStringList(value, label, allowed = null) {
  if (!Array.isArray(value) || value.length === 0) {
    throw configValidationError(`${label} 必须是非空数组`);
  }
  const result = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw configValidationError(`${label} 第 ${index + 1} 项必须是非空字符串`);
    }
    const normalized = item.trim();
    if (allowed && !allowed.includes(normalized)) {
      throw configValidationError(`${label} 第 ${index + 1} 项必须是以下值之一：${allowed.join('、')}`);
    }
    return normalized;
  });
  if (new Set(result).size !== result.length) {
    throw configValidationError(`${label} 不得包含重复项`);
  }
  return result;
}

function normalizePc(value, label) {
  const pc = objectValue(value, label);
  assertKnownProperties(
    pc,
    new Set(['analyzer', 'manifest', 'sourceMaps', 'compression', 'limits']),
    label,
  );
  const analyzer = pc.analyzer ?? 'viteManifest';
  if (!['viteManifest', 'directory'].includes(analyzer)) {
    throw configValidationError(`${label}.analyzer 必须为 viteManifest 或 directory`);
  }
  const manifest = normalizePlainRelativePath(pc.manifest ?? '.vite/manifest.json', `${label}.manifest`);
  const sourceMaps = pc.sourceMaps ?? 'forbid';
  if (!['allow', 'forbid'].includes(sourceMaps)) {
    throw configValidationError(`${label}.sourceMaps 必须为 allow 或 forbid`);
  }
  const compression = normalizeStringList(
    pc.compression ?? ['raw', 'gzip', 'brotli'],
    `${label}.compression`,
    ['raw', 'gzip', 'brotli'],
  );
  const limits = normalizeLimits(pc.limits, `${label}.limits`, PC_LIMIT_KEYS);
  const hasInitialLimit = Object.keys(limits).some((key) => key.startsWith('initial') && limits[key] != null);
  if (analyzer === 'directory' && hasInitialLimit) {
    throw configValidationError(`${label}.analyzer 为 directory 时不得配置 initialJs 或 initialCss 限制`);
  }
  for (const [key, limit] of Object.entries(limits)) {
    if (limit == null) continue;
    const compressionKind = key.includes('Gzip') ? 'gzip' : key.includes('Brotli') ? 'brotli' : 'raw';
    if (!compression.includes(compressionKind)) {
      throw configValidationError(`${label}.limits.${key} 要求 compression 包含 ${compressionKind}`);
    }
  }
  return { analyzer, manifest, sourceMaps, compression, limits };
}

function normalizeMiniProgram(value, label) {
  const miniProgram = objectValue(value, label);
  assertKnownProperties(
    miniProgram,
    new Set(['provider', 'appConfig', 'limits', 'subPackages', 'expectedSubPackages', 'exclusions']),
    label,
  );
  const provider = miniProgram.provider ?? 'weixin';
  if (provider !== 'weixin') {
    throw configValidationError(`${label}.provider 当前仅支持 weixin`);
  }
  const appConfig = normalizePlainRelativePath(miniProgram.appConfig ?? 'app.json', `${label}.appConfig`);
  const limits = normalizeLimits(miniProgram.limits, `${label}.limits`, MINI_PROGRAM_LIMIT_KEYS);
  for (const required of ['mainPackageBytes', 'defaultSubPackageBytes', 'totalPackageBytes']) {
    if (limits[required] == null) {
      throw configValidationError(`${label}.limits.${required} 必须显式配置`);
    }
  }
  const subPackages = (miniProgram.subPackages ?? []).map((entry, index) => {
    const entryLabel = `${label}.subPackages 第 ${index + 1} 项`;
    objectValue(entry, entryLabel);
    assertKnownProperties(entry, new Set(['root', 'maxBytes']), entryLabel);
    return {
      root: normalizePlainRelativePath(entry.root, `${entryLabel}.root`),
      maxBytes: optionalPositiveInteger(entry.maxBytes, `${entryLabel}.maxBytes`),
    };
  });
  const roots = subPackages.map(({ root }) => root);
  if (new Set(roots).size !== roots.length) {
    throw configValidationError(`${label}.subPackages.root 不得重复`);
  }
  const expectedSubPackages = (miniProgram.expectedSubPackages ?? []).map((root, index) => (
    normalizePlainRelativePath(root, `${label}.expectedSubPackages 第 ${index + 1} 项`)
  ));
  if (new Set(expectedSubPackages).size !== expectedSubPackages.length) {
    throw configValidationError(`${label}.expectedSubPackages 不得重复`);
  }
  const exclusions = (miniProgram.exclusions ?? []).map((entry, index) => {
    const entryLabel = `${label}.exclusions 第 ${index + 1} 项`;
    objectValue(entry, entryLabel);
    assertKnownProperties(entry, new Set(['patterns', 'reason']), entryLabel);
    const patterns = normalizeStringList(entry.patterns, `${entryLabel}.patterns`).map((pattern, patternIndex) => (
      normalizeRelativePattern(pattern, `${entryLabel}.patterns 第 ${patternIndex + 1} 项`)
    ));
    const unsupportedPattern = patterns.find((pattern) => !WEIXIN_NON_UPLOAD_FILES.has(pattern));
    if (unsupportedPattern) {
      throw configValidationError(
        `${entryLabel}.patterns 只能排除微信开发者工具非上传文件：${unsupportedPattern}`,
      );
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw configValidationError(`${entryLabel}.reason 必须是非空字符串`);
    }
    return { patterns, reason: entry.reason.trim() };
  });
  return { provider, appConfig, limits, subPackages, expectedSubPackages, exclusions };
}

export function validateBuildArtifactBudgetConfiguration(value, configPath) {
  const label = `${configPath} build.artifactBudget`;
  const artifactBudget = objectValue(value ?? {}, label);
  assertKnownProperties(
    artifactBudget,
    new Set([
      'enabled', 'platform', 'outputDirectory', 'cleanScript', 'action', 'mode',
      'baselineFile', 'scanLimits', 'pc', 'miniProgram',
    ]),
    label,
  );
  if (artifactBudget.enabled != null && typeof artifactBudget.enabled !== 'boolean') {
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  }
  const enabled = artifactBudget.enabled ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.enabled;
  const platform = artifactBudget.platform ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.platform;
  if (platform != null && !['pc', 'miniProgram'].includes(platform)) {
    throw configValidationError(`${label}.platform 必须为 pc 或 miniProgram`);
  }
  if (enabled && platform == null) {
    throw configValidationError(`${label}.enabled 为 true 时必须选择 platform`);
  }
  const outputDirectory = normalizePlainRelativePath(
    artifactBudget.outputDirectory ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.outputDirectory,
    `${label}.outputDirectory`,
  );
  if (outputDirectory === '.' || outputDirectory === 'src' || outputDirectory.startsWith('src/')) {
    throw configValidationError(`${label}.outputDirectory 不得为仓库根目录或 src 目录`);
  }
  const outputRoot = outputDirectory.split('/')[0];
  if (['.git', '.githooks', '.repo-guard', 'node_modules'].includes(outputRoot)) {
    throw configValidationError(`${label}.outputDirectory 不得位于受保护的仓库或依赖目录中`);
  }
  const cleanScript = artifactBudget.cleanScript ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.cleanScript;
  if (cleanScript != null && (
    typeof cleanScript !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(cleanScript.trim())
  )) {
    throw configValidationError(`${label}.cleanScript 必须为 null 或 npm 脚本名称`);
  }
  const action = artifactBudget.action ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.action;
  if (!['report', 'error'].includes(action)) {
    throw configValidationError(`${label}.action 必须为 report 或 error`);
  }
  const mode = artifactBudget.mode ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.mode;
  if (!['strict', 'baseline'].includes(mode)) {
    throw configValidationError(`${label}.mode 必须为 strict 或 baseline`);
  }
  if (mode === 'baseline' && action !== 'error') {
    throw configValidationError(`${label}.mode=baseline 时必须使用 action=error`);
  }
  if (platform === 'miniProgram' && (action !== 'error' || mode !== 'strict')) {
    throw configValidationError(`${label} 小程序平台限制必须使用 action=error 和 mode=strict`);
  }
  const baselineFile = normalizePlainRelativePath(
    artifactBudget.baselineFile ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.baselineFile,
    `${label}.baselineFile`,
  );
  if (!baselineFile.startsWith('.repo-guard/') || !baselineFile.endsWith('.json')) {
    throw configValidationError(`${label}.baselineFile 必须是 .repo-guard/ 内的 JSON 文件`);
  }
  if (baselineFile === outputDirectory || baselineFile.startsWith(`${outputDirectory}/`)) {
    throw configValidationError(`${label}.baselineFile 不得位于构建产物目录内`);
  }
  const scanLimitsValue = objectValue(artifactBudget.scanLimits ?? {}, `${label}.scanLimits`);
  assertKnownProperties(
    scanLimitsValue,
    new Set(['maxFiles', 'maxTotalBytes', 'maxCompressionInputBytes']),
    `${label}.scanLimits`,
  );
  const scanLimits = {
    maxFiles: optionalPositiveInteger(
      scanLimitsValue.maxFiles ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.scanLimits.maxFiles,
      `${label}.scanLimits.maxFiles`,
    ),
    maxTotalBytes: optionalPositiveInteger(
      scanLimitsValue.maxTotalBytes ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.scanLimits.maxTotalBytes,
      `${label}.scanLimits.maxTotalBytes`,
    ),
    maxCompressionInputBytes: optionalPositiveInteger(
      scanLimitsValue.maxCompressionInputBytes
        ?? DEFAULT_BUILD_ARTIFACT_BUDGET_CONFIG.scanLimits.maxCompressionInputBytes,
      `${label}.scanLimits.maxCompressionInputBytes`,
    ),
  };
  const pc = artifactBudget.pc == null ? null : normalizePc(artifactBudget.pc, `${label}.pc`);
  const miniProgram = artifactBudget.miniProgram == null
    ? null
    : normalizeMiniProgram(artifactBudget.miniProgram, `${label}.miniProgram`);
  if (platform === 'pc' && (!pc || miniProgram)) {
    throw configValidationError(`${label}.platform=pc 时必须且只能配置 pc`);
  }
  if (platform === 'miniProgram' && (!miniProgram || pc)) {
    throw configValidationError(`${label}.platform=miniProgram 时必须且只能配置 miniProgram`);
  }
  if (platform == null && (pc || miniProgram)) {
    throw configValidationError(`${label} 未选择 platform 时不得配置平台详情`);
  }
  return {
    enabled,
    platform,
    outputDirectory,
    cleanScript: cleanScript?.trim() || null,
    action,
    mode,
    baselineFile,
    scanLimits,
    pc,
    miniProgram,
  };
}

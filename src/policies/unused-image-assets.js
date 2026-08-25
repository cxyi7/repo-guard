import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError } from '../core/error/repo-guard-error.js';
import { extractImageReferenceFacts } from '../integrations/images/references.js';
import { selectImageAssetPaths } from './image-assets.js';

export const UNUSED_IMAGE_ASSET_RULE = 'assets/unused';

function matchesAny(filePath, patterns) {
  return patterns.length > 0 && micromatch.isMatch(filePath, patterns, { dot: true, nocase: true });
}

export function selectImageReferenceSourcePaths(paths, config) {
  const extensions = new Set(config.sourceExtensions);
  return paths
    .map((candidate) => (typeof candidate === 'string' ? candidate : candidate.path))
    .map((candidate) => candidate.replaceAll('\\', '/'))
    .filter((candidate) => extensions.has(path.posix.extname(candidate).toLowerCase()))
    .filter((candidate) => matchesAny(candidate, config.sourceInclude))
    .filter((candidate) => !matchesAny(candidate, config.sourceExclude));
}

function isExternalReference(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
}

function cleanReference(value) {
  const trimmed = value.trim();
  if (!trimmed || isExternalReference(trimmed) || /[{}$]/.test(trimmed)) return null;
  const clean = trimmed.split(/[?#]/, 1)[0].replaceAll('\\', '/');
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function insideRepository(candidate) {
  const normalized = path.posix.normalize(candidate).replace(/^\.\//, '');
  return normalized !== '..' && !normalized.startsWith('../') && !path.posix.isAbsolute(normalized)
    ? normalized
    : null;
}

function resolveAlias(reference, aliases) {
  const alias = aliases
    .filter(({ prefix }) => reference.startsWith(prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
  return alias ? insideRepository(path.posix.join(alias.directory, reference.slice(alias.prefix.length))) : null;
}

function resolvePublic(reference, publicRoots) {
  if (!reference.startsWith('/')) return null;
  const root = publicRoots
    .filter(({ urlPrefix }) => (
      urlPrefix === '/'
      || reference === urlPrefix
      || reference.startsWith(`${urlPrefix}/`)
    ))
    .sort((left, right) => right.urlPrefix.length - left.urlPrefix.length)[0];
  if (!root) return null;
  const suffix = root.urlPrefix === '/' ? reference.slice(1) : reference.slice(root.urlPrefix.length + 1);
  return insideRepository(path.posix.join(root.directory, suffix));
}

export function resolveImageReference(reference, sourcePath, config) {
  const clean = cleanReference(reference);
  if (!clean) return null;
  if (clean.startsWith('/')) return resolvePublic(clean, config.publicRoots);
  const aliased = resolveAlias(clean, config.aliases);
  if (aliased) return aliased;
  return insideRepository(path.posix.join(path.posix.dirname(sourcePath), clean));
}

function resolveGlob(pattern, sourcePath, config) {
  const negative = pattern.trim().startsWith('!');
  const clean = cleanReference(negative ? pattern.trim().slice(1) : pattern);
  if (!clean) return null;
  if (clean.startsWith('/')) {
    const resolved = resolvePublic(clean, config.publicRoots);
    return resolved ? { negative, pattern: resolved } : null;
  }
  const aliased = resolveAlias(clean, config.aliases);
  if (aliased) return { negative, pattern: aliased };
  const resolved = insideRepository(path.posix.join(path.posix.dirname(sourcePath), clean));
  return resolved ? { negative, pattern: resolved } : null;
}

function assertDynamicDeclarationsCurrent(config, sourcePaths, assetPaths) {
  for (const [index, declaration] of config.dynamicReferences.entries()) {
    const sourceMatches = sourcePaths.filter((sourcePath) => matchesAny(sourcePath, declaration.sourcePatterns));
    const assetMatches = assetPaths.filter((assetPath) => matchesAny(assetPath, declaration.assetPatterns));
    if (sourceMatches.length === 0 || assetMatches.length === 0) {
      const missing = [
        ...(sourceMatches.length === 0 ? ['sourcePatterns 未匹配源文件'] : []),
        ...(assetMatches.length === 0 ? ['assetPatterns 未匹配图片'] : []),
      ].join('；');
      throw configurationError(
        'unused-image-assets/stale-dynamic-reference',
        `imageAssets.unused.dynamicReferences 第 ${index + 1} 项已经失效：${missing}`,
      );
    }
  }
}

export function analyzeUnusedImageAssets({
  entries,
  readSource,
  imageConfig,
  validateDynamicDeclarations = true,
}) {
  const assetPaths = selectImageAssetPaths(entries, imageConfig);
  const sourcePaths = selectImageReferenceSourcePaths(entries, imageConfig.unused);
  if (validateDynamicDeclarations) {
    assertDynamicDeclarationsCurrent(imageConfig.unused, sourcePaths, assetPaths);
  }
  const assetSet = new Set(assetPaths);
  const used = new Set();
  let referenceCount = 0;
  let dynamicGlobCount = 0;
  for (const sourcePath of sourcePaths) {
    const facts = extractImageReferenceFacts(readSource(sourcePath), sourcePath);
    for (const reference of facts.references) {
      const resolved = resolveImageReference(reference.value, sourcePath, imageConfig.unused);
      if (resolved && assetSet.has(resolved)) {
        referenceCount += 1;
        used.add(resolved);
      }
    }
    const resolvedGlobs = facts.dynamicGlobs
      .map((dynamicGlob) => resolveGlob(dynamicGlob.value, sourcePath, imageConfig.unused))
      .filter(Boolean);
    const positiveGlobs = resolvedGlobs.filter(({ negative }) => !negative).map(({ pattern }) => pattern);
    const negativeGlobs = resolvedGlobs.filter(({ negative }) => negative).map(({ pattern }) => pattern);
    if (positiveGlobs.length > 0) {
      dynamicGlobCount += positiveGlobs.length;
      for (const assetPath of micromatch(assetPaths, positiveGlobs, { dot: true })) {
        if (!micromatch.isMatch(assetPath, negativeGlobs, { dot: true })) used.add(assetPath);
      }
    }
  }
  for (const declaration of imageConfig.unused.dynamicReferences) {
    for (const assetPath of assetPaths.filter((candidate) => matchesAny(candidate, declaration.assetPatterns))) {
      used.add(assetPath);
    }
  }
  return Object.freeze({
    assetPaths: Object.freeze(assetPaths),
    sourcePaths: Object.freeze(sourcePaths),
    usedPaths: Object.freeze([...used]),
    unusedPaths: Object.freeze(assetPaths.filter((assetPath) => !used.has(assetPath))),
    referenceCount,
    dynamicGlobCount,
  });
}

export function unusedImageAssetFinding(filePath, action) {
  return Object.freeze({
    rule: UNUSED_IMAGE_ASSET_RULE,
    issue: 'unused-image-assets/unreferenced',
    path: filePath,
    line: 1,
    column: 1,
    severity: action === 'error' ? 'error' : 'warning',
    message: `${filePath} 未被配置范围内的源码静态引用，也未被有效的动态引用声明覆盖`,
    expected: '图片资源必须存在可解析的静态引用，或通过带原因且可验证的 dynamicReferences 声明动态引用。',
    remediation: '先确认运行时确实不再使用该图片，再人工删除；若由动态路径加载，请添加范围最小的 dynamicReferences 声明。repo-guard 不会自动删除图片。',
  });
}

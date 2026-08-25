import { createHash } from 'node:crypto';
import path from 'node:path';
import micromatch from 'micromatch';

export const IMAGE_ASSET_RULES = Object.freeze([
  'assets/image-name',
  'assets/case-collision',
  'assets/extension-content-mismatch',
  'assets/exact-duplicate',
  'assets/pixel-duplicate',
  'assets/compression-opportunity',
  'assets/webp-conversion-opportunity',
  'assets/analysis-limit',
]);

const NAME_PATTERNS = Object.freeze({
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  'kebab-case': /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
});

export function imageAssetExtension(filePath) {
  return path.posix.extname(filePath).slice(1).toLowerCase();
}

export function selectImageAssetPaths(paths, config) {
  return paths
    .map((candidate) => (typeof candidate === 'string' ? candidate : candidate.path))
    .map((candidate) => candidate.replaceAll('\\', '/'))
    .filter((candidate) => config.extensions.includes(imageAssetExtension(candidate)))
    .filter((candidate) => micromatch.isMatch(candidate, config.include, { dot: true, nocase: true }))
    .filter((candidate) => !micromatch.isMatch(candidate, config.exclude, { dot: true, nocase: true }));
}

function fileNameParts(filePath, naming) {
  let basename = path.posix.basename(filePath);
  const extension = path.posix.extname(basename);
  basename = basename.slice(0, -extension.length);
  let ninePatch = false;
  if (basename.endsWith('.9')) {
    ninePatch = true;
    basename = basename.slice(0, -2);
  }
  const density = naming.densitySuffixes.find((suffix) => basename.endsWith(suffix)) ?? null;
  if (density) basename = basename.slice(0, -density.length);
  return { basename, density, extension: extension.slice(1), ninePatch };
}

export function inspectImageAssetNames(paths, config, { governedPaths = paths } = {}) {
  if (!config.naming.enabled) return [];
  const pattern = NAME_PATTERNS[config.naming.convention];
  const governed = new Set(governedPaths);
  const findings = [];
  for (const filePath of paths.filter((candidate) => governed.has(candidate))) {
    const parts = fileNameParts(filePath, config.naming);
    if (!pattern.test(parts.basename)
      || (parts.ninePatch && !config.naming.allowNinePatch)) {
      findings.push({
        rule: 'assets/image-name',
        issue: 'image-assets/invalid-name',
        path: filePath,
        message: `${filePath} 不符合图片资源的 ${config.naming.convention} 命名规范`,
        expected: `图片主文件名使用 ${config.naming.convention}；倍率后缀只能使用 ${config.naming.densitySuffixes.join('、')}`,
        remediation: '重命名图片并同步更新引用；不要通过混用第二种命名风格绕过检查。',
      });
    }
    if (config.naming.lowercaseExtension && parts.extension !== parts.extension.toLowerCase()) {
      findings.push({
        rule: 'assets/image-name',
        issue: 'image-assets/uppercase-extension',
        path: filePath,
        message: `${filePath} 的扩展名必须使用小写`,
        remediation: '将图片扩展名改为小写并同步更新引用。',
      });
    }
  }
  const collisions = new Map();
  for (const filePath of paths) {
    const key = filePath.toLocaleLowerCase('en-US');
    const group = collisions.get(key) ?? [];
    collisions.set(key, [...group, filePath]);
  }
  for (const group of collisions.values()) {
    if (group.length < 2) continue;
    for (const filePath of group.filter((candidate) => governed.has(candidate))) {
      findings.push({
        rule: 'assets/case-collision',
        issue: 'image-assets/case-collision',
        path: filePath,
        message: `${filePath} 与 ${group.filter((candidate) => candidate !== filePath).join('、')} 仅大小写不同`,
        remediation: '保留唯一且符合项目命名规范的文件名，并同步更新全部引用。',
      });
    }
  }
  return findings;
}

export function detectImageFormat(buffer) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buffer.length >= 16 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const declaredBoxSize = buffer.readUInt32BE(0);
    const boxEnd = Math.min(
      buffer.length,
      declaredBoxSize >= 16 ? declaredBoxSize : buffer.length,
    );
    const brands = [buffer.subarray(8, 12).toString('ascii')];
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
      brands.push(buffer.subarray(offset, offset + 4).toString('ascii'));
    }
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'ico';
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'bmp';
  if (buffer.length >= 4 && (
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0]))
    || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0, 0x2a]))
  )) return 'tiff';
  const text = buffer.subarray(0, Math.min(buffer.length, 65536)).toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart();
  if (/^(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(text)) return 'svg';
  return null;
}

export function formatMatchesExtension(format, extension) {
  if (format === 'jpeg') return extension === 'jpg' || extension === 'jpeg';
  if (format === 'tiff') return extension === 'tif' || extension === 'tiff';
  return format === extension;
}

export function contentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function canonicalRank(filePath, roots) {
  const rootIndex = roots.findIndex((root) => (
    filePath === root
    || filePath.startsWith(`${root}/`)
    || micromatch.isMatch(filePath, root, { dot: true })
  ));
  return [rootIndex < 0 ? roots.length : rootIndex, filePath.split('/').length, filePath];
}

function compareRank(left, right, roots) {
  const leftRank = canonicalRank(left, roots);
  const rightRank = canonicalRank(right, roots);
  return leftRank[0] - rightRank[0]
    || leftRank[1] - rightRank[1]
    || leftRank[2].localeCompare(rightRank[2]);
}

export function inspectDuplicateGroups(entries, {
  changedPaths,
  enforcement,
  canonicalRoots,
  identity = ({ oid, hash }) => oid ?? hash,
}) {
  const groups = new Map();
  for (const entry of entries) {
    const key = identity(entry);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    groups.set(key, [...group, entry.path]);
  }
  const findings = [];
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort((left, right) => compareRank(left, right, canonicalRoots));
    const unchanged = sorted.filter((candidate) => !changedPaths.has(candidate));
    const canonical = enforcement === 'allFiles' || unchanged.length === 0
      ? sorted[0]
      : unchanged[0];
    const targets = enforcement === 'allFiles'
      ? sorted.filter((candidate) => candidate !== canonical)
      : sorted.filter((candidate) => changedPaths.has(candidate) && candidate !== canonical);
    for (const target of targets) {
      findings.push({ path: target, canonical, duplicates: sorted.filter((item) => item !== target) });
    }
  }
  return findings;
}

export function savings(originalBytes, candidateBytes) {
  const savedBytes = originalBytes - candidateBytes;
  return {
    savedBytes,
    savedPercent: originalBytes === 0 ? 0 : (savedBytes / originalBytes) * 100,
  };
}

export function meetsSavingsThreshold(originalBytes, candidateBytes, config) {
  const result = savings(originalBytes, candidateBytes);
  return originalBytes >= config.minInputBytes
    && result.savedBytes >= config.minSavingsBytes
    && result.savedPercent >= config.minSavingsPercent;
}

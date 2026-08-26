import { brotliCompressSync, gzipSync } from 'node:zlib';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';

const STALE_SENTINEL = '.repo-guard-build-sentinel';
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const STYLE_EXTENSIONS = new Set(['.css']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.gif', '.ico', '.bmp']);
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const ABNORMAL_PATH = /(?:^|\/)(?:__tests__|tests?|coverage|reports?|tmp|temp)(?:\/|$)|\.(?:spec|test)\.[^/]+$/i;

function repositoryPath(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function readJson(target, label, root) {
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw configurationError(
      'build-artifact/invalid-json',
      `${label} 不是有效的 JSON：${repositoryPath(root, target)}`,
      { cause: error, details: { location: { path: repositoryPath(root, target) } } },
    );
  }
}

function assertNoSymbolicLinks(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw securityError(
        'build-artifact/symlink-output-path',
        `构建产物目录不得穿过符号链接：${repositoryPath(root, current)}`,
      );
    }
  }
}

export function resolveBuildArtifactOutput(root, config) {
  const outputDirectory = path.resolve(root, config.outputDirectory);
  const relative = repositoryPath(root, outputDirectory);
  if (
    relative === ''
    || relative === '.'
    || relative === '..'
    || relative.startsWith('../')
    || path.isAbsolute(relative)
    || relative === 'src'
    || relative.startsWith('src/')
  ) {
    throw securityError(
      'build-artifact/unsafe-output-directory',
      `构建产物目录必须位于仓库内部且不得覆盖源码：${config.outputDirectory}`,
    );
  }
  assertNoSymbolicLinks(root, outputDirectory);
  const tracked = runGit(
    ['ls-files', '-z', '--', config.outputDirectory],
    { allowFailure: true, cwd: root },
  ).stdout.split('\0').filter(Boolean);
  if (tracked.length > 0) {
    throw securityError(
      'build-artifact/tracked-output',
      `构建产物目录包含 Git 已跟踪文件：${tracked[0]}`,
      { details: { location: { path: tracked[0] } } },
    );
  }
  return Object.freeze({ outputDirectory, relative });
}

export function createStaleOutputSentinel(root, config) {
  const setup = resolveBuildArtifactOutput(root, config);
  if (!existsSync(setup.outputDirectory)) return Object.freeze({ ...setup, sentinel: null });
  if (!lstatSync(setup.outputDirectory).isDirectory()) {
    throw configurationError(
      'build-artifact/output-not-directory',
      `构建产物路径必须是目录：${config.outputDirectory}`,
    );
  }
  const sentinel = path.join(setup.outputDirectory, STALE_SENTINEL);
  assertNoSymbolicLinks(root, sentinel);
  if (existsSync(sentinel)) {
    throw securityError(
      'build-artifact/sentinel-collision',
      `构建产物目录已存在 repo-guard 清理探针同名文件：${repositoryPath(root, sentinel)}`,
    );
  }
  writeFileSync(sentinel, 'repo-guard stale output probe\n', { flag: 'wx' });
  return Object.freeze({ ...setup, sentinel });
}

export function removeStaleOutputSentinel(sentinel) {
  if (sentinel && existsSync(sentinel)) unlinkSync(sentinel);
}

export function staleOutputSentinelExists(sentinel) {
  return Boolean(sentinel && existsSync(sentinel));
}

export function buildArtifactOutputIsEmpty(root, config) {
  const setup = resolveBuildArtifactOutput(root, config);
  if (!existsSync(setup.outputDirectory)) return true;
  if (!lstatSync(setup.outputDirectory).isDirectory()) return false;
  return readdirSync(setup.outputDirectory).length === 0;
}

function collectFiles(root, outputDirectory, scanLimits) {
  if (!existsSync(outputDirectory) || !lstatSync(outputDirectory).isDirectory()) {
    throw configurationError(
      'build-artifact/missing-output-directory',
      `构建完成后找不到产物目录：${repositoryPath(root, outputDirectory)}`,
    );
  }
  const files = [];
  let totalBytes = 0;
  const pending = [outputDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw securityError(
          'build-artifact/symlink-inside-output',
          `构建产物不得包含符号链接：${repositoryPath(root, target)}`,
        );
      }
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = lstatSync(target).size;
      totalBytes += bytes;
      files.push(Object.freeze({
        absolutePath: target,
        path: repositoryPath(outputDirectory, target),
        bytes,
        extension: path.extname(entry.name).toLowerCase(),
      }));
      if (files.length > scanLimits.maxFiles) {
        throw securityError(
          'build-artifact/too-many-files',
          `构建产物文件数超过安全扫描上限 ${scanLimits.maxFiles}`,
        );
      }
      if (totalBytes > scanLimits.maxTotalBytes) {
        throw securityError(
          'build-artifact/scan-bytes-exceeded',
          `构建产物总体积超过安全扫描上限 ${scanLimits.maxTotalBytes} 字节`,
        );
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({ files: Object.freeze(files), totalBytes });
}

function compressedBytes(file, kinds, maxInputBytes) {
  const result = { raw: file.bytes };
  if (!kinds.includes('gzip') && !kinds.includes('brotli')) return result;
  if (file.bytes > maxInputBytes) {
    throw securityError(
      'build-artifact/compression-input-too-large',
      `拒绝压缩计算超出安全上限的产物：${file.path}（${file.bytes} 字节）`,
    );
  }
  const content = readFileSync(file.absolutePath);
  if (kinds.includes('gzip')) result.gzip = gzipSync(content).byteLength;
  if (kinds.includes('brotli')) result.brotli = brotliCompressSync(content).byteLength;
  return result;
}

function normalizeManifestFile(value, label) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.split('/').includes('..')) {
    throw configurationError('build-artifact/unsafe-manifest-entry', `${label} 包含不安全的产物路径`);
  }
  return value.replaceAll('\\', '/');
}

function initialManifestFiles(manifest) {
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk?.isEntry === true);
  const visited = new Set();
  const result = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk || typeof chunk !== 'object') {
      throw configurationError('build-artifact/missing-manifest-import', `Vite 产物清单引用了不存在的入口：${key}`);
    }
    if (chunk.file) result.add(normalizeManifestFile(chunk.file, `Vite manifest ${key}.file`));
    for (const css of chunk.css ?? []) result.add(normalizeManifestFile(css, `Vite manifest ${key}.css`));
    for (const asset of chunk.assets ?? []) result.add(normalizeManifestFile(asset, `Vite manifest ${key}.assets`));
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  for (const [key] of entries) visit(key);
  if (entries.length === 0) {
    throw configurationError('build-artifact/missing-manifest-entry', 'Vite 产物清单中没有生产入口标记');
  }
  return result;
}

function sumCompression(files, kinds, maxInputBytes) {
  const totals = { raw: 0, gzip: 0, brotli: 0 };
  for (const file of files) {
    const sizes = compressedBytes(file, kinds, maxInputBytes);
    for (const kind of kinds) totals[kind] += sizes[kind];
  }
  return totals;
}

function sumRawBytes(files, extensions) {
  return files
    .filter(({ extension }) => extensions.has(extension))
    .reduce((sum, file) => sum + file.bytes, 0);
}

export function inspectPcBuildArtifacts(root, config) {
  const setup = resolveBuildArtifactOutput(root, config);
  const scan = collectFiles(root, setup.outputDirectory, config.scanLimits);
  const fileByPath = new Map(scan.files.map((file) => [file.path, file]));
  let initialFiles = [];
  if (config.pc.analyzer === 'viteManifest') {
    const manifestPath = path.join(setup.outputDirectory, config.pc.manifest);
    assertNoSymbolicLinks(root, manifestPath);
    if (!existsSync(manifestPath)) {
      throw configurationError(
        'build-artifact/missing-vite-manifest',
        `找不到 Vite 产物清单：${repositoryPath(root, manifestPath)}`,
      );
    }
    const manifest = readJson(manifestPath, 'Vite manifest', root);
    initialFiles = [...initialManifestFiles(manifest)].map((filePath) => {
      const file = fileByPath.get(filePath);
      if (!file) {
        throw configurationError(
          'build-artifact/missing-manifest-file',
          `Vite 产物清单引用的文件不存在：${filePath}`,
        );
      }
      return file;
    });
  }
  const scripts = scan.files.filter(({ extension }) => SCRIPT_EXTENSIONS.has(extension));
  const assets = scan.files.filter(({ extension }) => (
    !SCRIPT_EXTENSIONS.has(extension) && !STYLE_EXTENSIONS.has(extension) && extension !== '.map'
  ));
  const initialScripts = initialFiles.filter(({ extension }) => SCRIPT_EXTENSIONS.has(extension));
  const initialStyles = initialFiles.filter(({ extension }) => STYLE_EXTENSIONS.has(extension));
  const initialScriptSizes = sumCompression(
    initialScripts,
    config.pc.compression,
    config.scanLimits.maxCompressionInputBytes,
  );
  const initialStyleSizes = sumCompression(
    initialStyles,
    config.pc.compression,
    config.scanLimits.maxCompressionInputBytes,
  );
  return Object.freeze({
    platform: 'pc',
    outputDirectory: setup.relative,
    files: scan.files,
    metrics: Object.freeze({
      totalRawBytes: scan.totalBytes,
      initialJsRawBytes: initialScriptSizes.raw,
      initialJsGzipBytes: initialScriptSizes.gzip,
      initialJsBrotliBytes: initialScriptSizes.brotli,
      initialCssRawBytes: initialStyleSizes.raw,
      initialCssGzipBytes: initialStyleSizes.gzip,
      initialCssBrotliBytes: initialStyleSizes.brotli,
      maxChunkRawBytes: Math.max(0, ...scripts.map(({ bytes }) => bytes)),
      maxChunkCount: scripts.length,
      maxAssetRawBytes: Math.max(0, ...assets.map(({ bytes }) => bytes)),
      jsRawBytes: sumRawBytes(scan.files, SCRIPT_EXTENSIONS),
      cssRawBytes: sumRawBytes(scan.files, STYLE_EXTENSIONS),
      imageRawBytes: sumRawBytes(scan.files, IMAGE_EXTENSIONS),
      fontRawBytes: sumRawBytes(scan.files, FONT_EXTENSIONS),
      fileCount: scan.files.length,
    }),
    sourceMaps: Object.freeze(scan.files.filter(({ extension }) => extension === '.map').map(({ path: filePath }) => filePath)),
    abnormalFiles: Object.freeze(scan.files.filter(({ path: filePath }) => ABNORMAL_PATH.test(filePath)).map(({ path: filePath }) => filePath)),
  });
}

function normalizedPackageRoots(appConfig) {
  const source = appConfig.subPackages ?? appConfig.subpackages ?? [];
  if (!Array.isArray(source)) {
    throw configurationError('build-artifact/invalid-subpackages', '小程序 app.json 的 subPackages 必须是数组');
  }
  return source.map((entry, index) => {
    const root = normalizeManifestFile(entry?.root, `app.json subPackages 第 ${index + 1} 项 root`).replace(/\/$/, '');
    if (!root) throw configurationError('build-artifact/empty-subpackage-root', '小程序分包 root 不得为空');
    if (entry.pages != null && !Array.isArray(entry.pages)) {
      throw configurationError(
        'build-artifact/invalid-subpackage-pages',
        `小程序分包 ${root} 的 pages 必须是数组`,
      );
    }
    const pages = (entry.pages ?? []).map((page, pageIndex) => (
      normalizeManifestFile(page, `小程序分包 ${root} pages 第 ${pageIndex + 1} 项`)
    ));
    return Object.freeze({ root, independent: entry.independent === true, pages: Object.freeze(pages) });
  });
}

function assertDisjointRoots(roots) {
  const seen = new Set();
  for (const root of roots) {
    const key = root.toLowerCase();
    if (seen.has(key)) {
      throw configurationError('build-artifact/duplicate-subpackage-root', `小程序分包 root 重复：${root}`);
    }
    if ([...seen].some((other) => key.startsWith(`${other}/`) || other.startsWith(`${key}/`))) {
      throw configurationError('build-artifact/nested-subpackage-root', `小程序分包 root 不得互相嵌套：${root}`);
    }
    seen.add(key);
  }
}

function isExcluded(filePath, exclusions) {
  return exclusions.some(({ patterns }) => micromatch.isMatch(filePath, patterns, { dot: true }));
}

export function inspectMiniProgramBuildArtifacts(root, config) {
  const setup = resolveBuildArtifactOutput(root, config);
  const scan = collectFiles(root, setup.outputDirectory, config.scanLimits);
  const appConfigPath = path.join(setup.outputDirectory, config.miniProgram.appConfig);
  assertNoSymbolicLinks(root, appConfigPath);
  if (!existsSync(appConfigPath)) {
    throw configurationError(
      'build-artifact/missing-mini-program-app-config',
      `找不到小程序产物配置：${repositoryPath(root, appConfigPath)}`,
    );
  }
  const appConfig = readJson(appConfigPath, '小程序 app.json', root);
  if (!Array.isArray(appConfig.pages) || appConfig.pages.length === 0) {
    throw configurationError('build-artifact/invalid-main-pages', '小程序 app.json 的 pages 必须是非空数组');
  }
  const mainPages = appConfig.pages.map((page, index) => (
    normalizeManifestFile(page, `小程序 app.json pages 第 ${index + 1} 项`)
  ));
  const packageRoots = normalizedPackageRoots(appConfig);
  assertDisjointRoots(packageRoots.map(({ root: packageRoot }) => packageRoot));
  const includedFiles = scan.files.filter(({ path: filePath }) => (
    filePath !== STALE_SENTINEL && !isExcluded(filePath, config.miniProgram.exclusions)
  ));
  const packages = packageRoots.map(({ root: packageRoot, independent, pages }) => {
    const files = includedFiles.filter(({ path: filePath }) => filePath.startsWith(`${packageRoot}/`));
    return Object.freeze({
      root: packageRoot,
      independent,
      pages,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files: Object.freeze(files),
    });
  });
  const subPackageFiles = new Set(packages.flatMap(({ files }) => files.map(({ path: filePath }) => filePath)));
  const mainFiles = includedFiles.filter(({ path: filePath }) => !subPackageFiles.has(filePath));
  const preloadRules = appConfig.preloadRule ?? {};
  if (!preloadRules || typeof preloadRules !== 'object' || Array.isArray(preloadRules)) {
    throw configurationError('build-artifact/invalid-preload-rule', '小程序 app.json 的 preloadRule 必须是对象');
  }
  const preloadFindings = [];
  const knownPages = new Set([
    ...mainPages,
    ...packageRoots.flatMap(({ root: packageRoot, pages }) => (
      pages.map((page) => `${packageRoot}/${page}`)
    )),
  ]);
  let maxPreloadBytes = 0;
  for (const [page, rule] of Object.entries(preloadRules)) {
    if (!knownPages.has(page)) {
      preloadFindings.push(Object.freeze({ page, packageRoot: null, reason: 'unknown-page' }));
    }
    const names = rule?.packages;
    if (!Array.isArray(names)) {
      preloadFindings.push(Object.freeze({ page, packageRoot: null, reason: 'invalid-packages' }));
      continue;
    }
    let bytes = 0;
    for (const packageRoot of names) {
      if (packageRoot === '__APP__') {
        bytes += mainFiles.reduce((sum, file) => sum + file.bytes, 0);
        continue;
      }
      const target = packages.find(({ root: candidate }) => candidate === packageRoot);
      if (!target) preloadFindings.push(Object.freeze({ page, packageRoot: String(packageRoot), reason: 'unknown-package' }));
      else bytes += target.bytes;
    }
    maxPreloadBytes = Math.max(maxPreloadBytes, bytes);
  }
  return Object.freeze({
    platform: 'miniProgram',
    outputDirectory: setup.relative,
    files: Object.freeze(includedFiles),
    packages: Object.freeze(packages),
    packageRoots: Object.freeze(packageRoots.map(({ root: packageRoot }) => packageRoot)),
    preloadFindings: Object.freeze(preloadFindings),
    metrics: Object.freeze({
      mainPackageBytes: mainFiles.reduce((sum, file) => sum + file.bytes, 0),
      totalPackageBytes: includedFiles.reduce((sum, file) => sum + file.bytes, 0),
      maxSingleFileBytes: Math.max(0, ...includedFiles.map(({ bytes }) => bytes)),
      maxPreloadBytes,
      subPackageCount: packages.length,
      jsRawBytes: sumRawBytes(includedFiles, SCRIPT_EXTENSIONS),
      cssRawBytes: sumRawBytes(includedFiles, STYLE_EXTENSIONS),
      imageRawBytes: sumRawBytes(includedFiles, IMAGE_EXTENSIONS),
      fontRawBytes: sumRawBytes(includedFiles, FONT_EXTENSIONS),
      fileCount: includedFiles.length,
    }),
  });
}

export function ensureArtifactBaselineDirectory(root, baselineFile) {
  const target = path.resolve(root, baselineFile);
  assertNoSymbolicLinks(root, target);
  mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

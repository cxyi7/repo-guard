import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { validateUiTokenManifest } from '../../config/ui-token-manifest-validation.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function assertRepositoryFile(root, relativePath, label, maxBytes) {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw configurationError('ui-token/path-outside-repository', `${label} 必须位于仓库内部`);
  }
  const segments = relative.split('/');
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      throw configurationError('ui-token/file-missing', `${label} 不存在：${relative}`);
    }
    if (lstatSync(current).isSymbolicLink()) {
      throw configurationError('ui-token/symbolic-link-rejected', `${label} 不得经过符号链接：${relative}`);
    }
  }
  const stat = lstatSync(target);
  if (!stat.isFile()) {
    throw configurationError('ui-token/not-a-file', `${label} 必须是普通文件：${relative}`);
  }
  if (stat.size > maxBytes) {
    throw configurationError('ui-token/file-too-large', `${label} 超过安全上限：${relative}`);
  }
  return { absolute: target, relative };
}

function parseManifest(file) {
  try {
    return JSON.parse(readFileSync(file.absolute, 'utf8'));
  } catch (error) {
    throw configurationError(
      'ui-token/manifest-invalid-json',
      `无法解析 UI Token Manifest ${file.relative}：${error.message}`,
    );
  }
}

function sourceDigest(absolute) {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

export function loadUiTokenManifest(root, config) {
  const file = assertRepositoryFile(
    root,
    config.manifestFile,
    'UI Token Manifest',
    MAX_MANIFEST_BYTES,
  );
  const manifest = validateUiTokenManifest(parseManifest(file), file.relative);
  if (manifest.sources.some(({ path: sourcePath }) => sourcePath === file.relative)) {
    throw configurationError(
      'ui-token/manifest-self-reference',
      `UI Token Manifest 不得把自身列为来源文件：${file.relative}`,
    );
  }
  const sources = manifest.sources.map((source) => {
    const resolved = assertRepositoryFile(
      root,
      source.path,
      'UI Token 来源文件',
      MAX_SOURCE_BYTES,
    );
    return {
      ...source,
      absolute: resolved.absolute,
      actualSha256: sourceDigest(resolved.absolute),
    };
  });
  return Object.freeze({
    ...manifest,
    file,
    sources: Object.freeze(sources.map((source) => Object.freeze(source))),
  });
}

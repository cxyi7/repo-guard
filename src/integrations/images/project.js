import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { configurationError } from '../../core/error/repo-guard-error.js';

async function importProjectPackage(root, packageName, displayName) {
  const metadata = resolveProjectPackageMetadata(root, packageName, displayName);
  const module = await import(pathToFileURL(metadata.entryPath).href);
  return { module, version: metadata.version };
}

export function assertImagePathHasNoSymbolicLink(root, target, displayPath) {
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw configurationError(
        'image-assets/symlink-rejected',
        `图片路径不得经过符号链接：${displayPath}`,
      );
    }
  }
}

export async function loadProjectSharp(root) {
  const resolved = await importProjectPackage(root, 'sharp', '图片资源 Sharp 集成');
  const sharp = resolved.module.default ?? resolved.module;
  if (typeof sharp !== 'function') {
    throw configurationError(
      'image-assets/invalid-sharp-entry',
      '消费项目安装的 sharp 没有提供可调用的默认入口',
    );
  }
  return { sharp, version: resolved.version };
}

export async function loadProjectSvgo(root) {
  const resolved = await importProjectPackage(root, 'svgo', '图片资源 SVGO 集成');
  const optimize = resolved.module.optimize;
  if (typeof optimize !== 'function') {
    throw configurationError(
      'image-assets/invalid-svgo-entry',
      '消费项目安装的 svgo 没有提供 optimize API',
    );
  }
  return { optimize, version: resolved.version };
}

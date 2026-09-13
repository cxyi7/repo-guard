import { planImageReferenceUpdates } from './image-reference-updates.js';
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import {
  createRasterCompressionCandidate,
  createSvgCompressionCandidate,
  createWebpCandidate,
} from '../../integrations/images/optimization.js';
import {
  assertImagePathHasNoSymbolicLink,
  loadProjectSharp,
  loadProjectSvgo,
} from '../../integrations/images/project.js';
import {
  detectImageFormat,
  formatMatchesExtension,
  imageAssetExtension,
  meetsSavingsThreshold,
  savings,
  selectImageAssetPaths,
} from '../../policies/image-assets.js';

function pathEntryExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw executionError(
      'image-optimize/path-inspection-failed',
      '无法检查图片写入路径状态',
      { cause: error },
    );
  }
}

function normalizeTarget(root, requestedPath, config) {
  const absolute = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw configurationError('image-optimize/path-outside-repository', `图片路径必须位于所选应用目录内：${requestedPath}`);
  }
  if (!existsSync(absolute)) {
    throw configurationError('image-optimize/file-missing', `图片文件不存在：${relative}`);
  }
  assertImagePathHasNoSymbolicLink(root, absolute, relative);
  if (selectImageAssetPaths([relative], config).length !== 1) {
    throw configurationError('image-optimize/file-out-of-scope', `图片不在 imageAssets include/exclude 范围内：${relative}`);
  }
  return { absolute, relative };
}

function assertCleanTrackedFile(root, relative) {
  const tracked = runGit(['ls-files', '--error-unmatch', '--', relative], {
    allowFailure: true,
    cwd: root,
  });
  if (tracked.status !== 0) {
    throw configurationError('image-optimize/untracked-file', `拒绝覆盖未被 Git 跟踪的图片：${relative}`);
  }
  const status = runGit(['status', '--porcelain=v1', '-z', '--', relative], { cwd: root }).stdout;
  if (status) {
    throw configurationError(
      'image-optimize/dirty-file',
      `拒绝覆盖存在暂存或未暂存修改的图片：${relative}`,
    );
  }
}

function safelyReplace(target, candidate, onInstalled = () => {}) {
  const temporary = `${target}.repo-guard-${process.pid}.tmp`;
  const backup = `${target}.repo-guard-${process.pid}.backup`;
  if (pathEntryExists(temporary) || pathEntryExists(backup)) {
    throw configurationError(
      'image-optimize/temporary-path-collision',
      '图片安全替换的临时路径或备份路径已存在，请检查同名残留文件后重试',
    );
  }
  const sourceMode = lstatSync(target).mode;
  writeFileSync(temporary, candidate, { flag: 'wx' });
  try {
    chmodSync(temporary, sourceMode);
    renameSync(target, backup);
    try {
      renameSync(temporary, target);
      rmSync(backup);
      onInstalled();
    } catch (error) {
      if (pathEntryExists(target)) {
        if (lstatSync(target).isSymbolicLink() || !readFileSync(target).equals(candidate)) throw executionError('image-optimize/restore-conflict', `恢复时目标出现外部修改，原文件备份保留在 ${backup}`, { cause: error });
        rmSync(target);
      }
      renameSync(backup, target);
      throw executionError(
        'image-optimize/replace-failed',
        `图片安全替换失败：${error.message}`,
        { cause: error },
      );
    }
  } finally {
    if (pathEntryExists(temporary)) rmSync(temporary);
    // 恢复失败时保留原始备份，不能仅因目标存在就清理备份。
  }
}

function safelyCreate(target, candidate, displayPath, onInstalled) {
  if (pathEntryExists(target)) {
    throw configurationError('image-optimize/output-exists', `拒绝覆盖已经存在的目标图片：${displayPath}`);
  }
  const temporary = `${target}.repo-guard-${process.pid}.tmp`;
  if (pathEntryExists(temporary)) {
    throw configurationError(
      'image-optimize/temporary-path-collision',
      `目标图片的临时路径已存在，请检查同名残留文件后重试：${displayPath}`,
    );
  }
  writeFileSync(temporary, candidate, { flag: 'wx' });
  try {
    linkSync(temporary, target);
    onInstalled();
  } finally {
    if (pathEntryExists(temporary)) rmSync(temporary);
  }
}

async function createCandidate({ root, buffer, format, to, config, allowLossy, write }) {
  if (to === 'webp') {
    const conversion = config.compression.conversion;
    if (!conversion.enabled) {
      throw configurationError('image-optimize/webp-disabled', 'imageAssets.compression.conversion 尚未启用');
    }
    const allowedSource = format === 'jpeg'
      ? conversion.sourceFormats.includes('jpg') || conversion.sourceFormats.includes('jpeg')
      : conversion.sourceFormats.includes(format);
    if (!allowedSource) {
      throw configurationError('image-optimize/unsupported-webp-source', `当前配置不允许把 ${format} 转为 WebP`);
    }
    const isLossy = format !== 'png' || conversion.pngMode === 'lossy';
    if (isLossy && write && (!config.compression.raster.allowLossy || !allowLossy)) {
      throw configurationError(
        'image-optimize/lossy-not-confirmed',
        '有损 WebP 转换必须同时配置 raster.allowLossy=true 并传入 --allow-lossy',
      );
    }
    const project = await loadProjectSharp(root);
    const result = await createWebpCandidate({
      sharp: project.sharp,
      buffer,
      format,
      config: conversion,
      limits: config.limits,
      metadataPolicy: config.compression.raster.metadata,
    });
    return { ...result, threshold: conversion, tool: `sharp ${project.version}` };
  }
  if (format === 'svg') {
    if (!config.compression.svg.enabled) {
      throw configurationError('image-optimize/svg-disabled', 'SVG 压缩尚未启用');
    }
    if (write && !config.compression.svg.allowWrite) {
      throw configurationError('image-optimize/svg-write-disabled', 'SVG 写入必须显式配置 svg.allowWrite=true');
    }
    const project = await loadProjectSvgo(root);
    return {
      candidate: createSvgCompressionCandidate(project.optimize, buffer),
      threshold: config.compression,
      tool: `svgo ${project.version}`,
    };
  }
  if (!config.compression.raster.enabled) throw configurationError('image-optimize/raster-disabled', '位图压缩尚未启用，不能执行原格式优化。');
  const project = await loadProjectSharp(root);
  const isLossy = ['jpeg', 'webp'].includes(format);
  if (isLossy && !config.compression.raster.allowLossy) {
    throw configurationError(
      'image-optimize/lossy-disabled',
      '有损图片压缩必须先配置 raster.allowLossy=true',
    );
  }
  if (isLossy && write && !allowLossy) {
    throw configurationError(
      'image-optimize/lossy-not-confirmed',
      '有损图片压缩必须同时配置 raster.allowLossy=true 并传入 --allow-lossy',
    );
  }
  const result = await createRasterCompressionCandidate({
    sharp: project.sharp,
    buffer,
    format,
    config: config.compression,
    limits: config.limits,
  });
  if (!result.candidate) {
    throw configurationError('image-optimize/unsupported-format', `当前压缩策略不支持写入 ${format} 图片`);
  }
  return { ...result, threshold: config.compression, tool: `sharp ${project.version}` };
}

export async function executeImageOptimization({
  paths,
  to = null,
  write = false,
  allowLossy = false,
  updateReferences = false,
  cwd = process.cwd(),
  root: applicationRoot,
  config: projectConfig,
}) {
  const root = applicationRoot ?? findRepositoryRoot(cwd);
  const fullConfig = projectConfig ?? loadConfig(root);
  const config = fullConfig.checks.imageAssets;
  if (updateReferences && to !== "webp") throw configurationError("image-optimize/reference-target", "引用更新只支持显式 WebP 转换");
  if (!config.enabled) {
    throw configurationError('image-optimize/feature-disabled', '图片资源治理尚未启用');
  }
  if (!config.compression.enabled) {
    throw configurationError('image-optimize/compression-disabled', '图片压缩尚未启用');
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw configurationError('image-optimize/paths-required', '必须在 -- 后明确指定至少一个图片路径');
  }
  if (to != null && to !== 'webp') {
    throw configurationError('image-optimize/unsupported-target', '--to 当前只支持 webp');
  }

  const messages = [];
  const planned = [];
  for (const requestedPath of paths) {
    const target = normalizeTarget(root, requestedPath, config);
    if (lstatSync(target.absolute).size > config.limits.maxInputBytes) throw configurationError('image-optimize/input-too-large', `${target.relative} 超过安全输入上限`);
    const buffer = readFileSync(target.absolute);
    if (buffer.length > config.limits.maxInputBytes) {
      throw configurationError('image-optimize/input-too-large', `${target.relative} 超过安全输入上限`);
    }
    const format = detectImageFormat(buffer);
    if (!format || !formatMatchesExtension(format, imageAssetExtension(target.relative))) {
      throw configurationError(
        'image-optimize/format-mismatch',
        `${target.relative} 的扩展名与真实图片格式不一致或内容已经损坏`,
      );
    }
    const result = await createCandidate({ root, buffer, format, to, config, allowLossy, write });
    if (!result.candidate) throw configurationError('image-optimize/candidate-unavailable', '图片未能生成候选，请检查帧数上限与编码支持；原文件未修改。');
    if (!meetsSavingsThreshold(buffer.length, result.candidate.length, result.threshold)) {
      const saving = savings(buffer.length, result.candidate.length);
      messages.push(`${target.relative} 未达到写入阈值：预计节省 ${saving.savedBytes} 字节（${saving.savedPercent.toFixed(1)}%）`);
      continue;
    }
    const outputRelative = to === 'webp'
      ? `${target.relative.slice(0, -path.posix.extname(target.relative).length)}.webp`
      : target.relative;
    const outputAbsolute = path.join(root, ...outputRelative.split('/'));
    const saving = savings(buffer.length, result.candidate.length);
    messages.push(`${target.relative} -> ${outputRelative}：${buffer.length} -> ${result.candidate.length} 字节，节省 ${saving.savedPercent.toFixed(1)}%（${result.tool}）`);
    planned.push({ inputRelative: target.relative, outputRelative, absolute: target.absolute, outputAbsolute, buffer, candidate: result.candidate });
  }
  if (updateReferences) {
    const updates = planImageReferenceUpdates(root, planned, fullConfig.checks.unusedImageAssets);
    planned.push(...updates);
    messages.push(...updates.map((entry) => `静态引用更新：${entry.inputRelative}`));
    messages.push('动态接口引用、无法精确定位的引用和原图均保留，请人工核对。');
  }
  if (!write) return messages;
  const outputs = new Set();
  for (const entry of planned) {
    assertCleanTrackedFile(root, entry.inputRelative);
    if (!readFileSync(entry.absolute).equals(entry.buffer)) throw configurationError('image-optimize/source-changed', '规划后源文件发生变化，请重新执行');
    if (outputs.has(entry.outputAbsolute)) throw configurationError('image-optimize/output-collision', '多张图片生成同一输出路径，拒绝写入');
    outputs.add(entry.outputAbsolute);
    if (entry.outputAbsolute !== entry.absolute && pathEntryExists(entry.outputAbsolute)) throw configurationError('image-optimize/output-exists', '拒绝覆盖已经存在的目标图片');
  }
  const written = [];
  try {
    for (const entry of planned) {
      assertCleanTrackedFile(root, entry.inputRelative);
      if (!readFileSync(entry.absolute).equals(entry.buffer)) throw configurationError('image-optimize/source-changed', '写入前源文件发生变化，请重新执行');
      const onInstalled = () => written.push(entry);
      if (entry.outputAbsolute === entry.absolute) safelyReplace(entry.absolute, entry.candidate, onInstalled);
      else safelyCreate(entry.outputAbsolute, entry.candidate, entry.outputRelative, onInstalled);
      messages.push(`已安全写入 ${entry.outputRelative}；请检查 Git 差异和图片效果。`);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const entry of written.reverse()) {
      try {
        assertImagePathHasNoSymbolicLink(root, entry.outputAbsolute, entry.outputRelative);
        if (!readFileSync(entry.outputAbsolute).equals(entry.candidate)) throw executionError('image-optimize/rollback-conflict', '回滚时检测到外部修改，已停止覆盖，请人工恢复');
        if (entry.outputAbsolute === entry.absolute) safelyReplace(entry.absolute, entry.buffer);
        else rmSync(entry.outputAbsolute);
      } catch { rollbackFailures.push(entry.outputRelative); }
    }
    if (rollbackFailures.length) throw executionError('image-optimize/rollback-incomplete', `部分文件无法自动恢复，请人工检查：${rollbackFailures.join('、')}`, { cause: error });
    throw executionError('image-optimize/batch-failed', '批量图片优化失败，已恢复本批写入内容', { cause: error });
  }
  return messages;
}

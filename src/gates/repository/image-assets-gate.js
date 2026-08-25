import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  listIndexBinaryEntries,
  listRevisionBinaryEntries,
  readGitBlob,
} from '../../git/binary-content.js';
import {
  assertImagePathHasNoSymbolicLink,
  loadProjectSharp,
  loadProjectSvgo,
} from '../../integrations/images/project.js';
import {
  createRasterCompressionCandidate,
  createSvgCompressionCandidate,
  createWebpCandidate,
  normalizedPixelHash,
} from '../../integrations/images/optimization.js';
import {
  contentHash,
  detectImageFormat,
  formatMatchesExtension,
  IMAGE_ASSET_RULES,
  imageAssetExtension,
  inspectDuplicateGroups,
  inspectImageAssetNames,
  meetsSavingsThreshold,
  savings,
  selectImageAssetPaths,
} from '../../policies/image-assets.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import {
  findingFromPolicy,
  passedResult,
  skippedResult,
  violationResult,
} from '../native-result.js';

export const IMAGE_ASSETS_GATE_ID = 'repository.image-assets';

function snapshotEntries({ root, environment, revision, files }) {
  if (environment === 'pre-commit') return listIndexBinaryEntries(root);
  if (environment.startsWith('ci-') || environment === 'release-ready') {
    return listRevisionBinaryEntries(root, revision?.head ?? 'HEAD');
  }
  return files.map((candidate) => ({
    path: (typeof candidate === 'string' ? candidate : candidate.relative).replaceAll('\\', '/'),
    oid: null,
  })).map((entry) => {
    const absolute = path.resolve(root, entry.path);
    const relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw executionError('image-assets/path-outside-repository', `图片路径越出仓库范围：${entry.path}`);
    }
    assertImagePathHasNoSymbolicLink(root, absolute, entry.path);
    return { ...entry, size: lstatSync(absolute).size };
  });
}

function changedImagePaths(changes, selectedPaths, environment, enforcement) {
  if (environment === 'manual' || enforcement === 'allFiles') return new Set(selectedPaths);
  const selected = new Set(selectedPaths);
  return new Set(changeSetEntries(changes)
    .filter(({ status }) => !status.startsWith('D'))
    .map(({ path: filePath }) => filePath)
    .filter((filePath) => selected.has(filePath)));
}

function createBufferReader(root, entries, environment, limits) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return (filePath) => {
    const entry = byPath.get(filePath);
    let buffer;
    if (environment === 'manual') {
      const absolute = path.resolve(root, filePath);
      const relative = path.relative(root, absolute);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw executionError('image-assets/path-outside-repository', `图片路径越出仓库范围：${filePath}`);
      }
      assertImagePathHasNoSymbolicLink(root, absolute, filePath);
      buffer = readFileSync(absolute);
    } else {
      buffer = readGitBlob(root, entry.oid, { maxBuffer: limits.maxInputBytes + 1024 });
    }
    return buffer;
  };
}

function policyFinding(rule, issue, filePath, message, remediation, extra = {}) {
  return {
    rule,
    issue,
    path: filePath,
    line: 1,
    column: 1,
    message,
    remediation,
    ...extra,
  };
}

function applyExceptions(findings, exceptions) {
  const approved = [];
  const violations = [];
  for (const finding of findings) {
    const normalized = { line: 1, column: 1, ...finding };
    const exception = findStructuredException(exceptions, normalized);
    if (exception) approved.push({ ...normalized, exception });
    else violations.push(normalized);
  }
  return { approved, violations };
}

function exactDuplicateFindings(entries, changedPaths, config) {
  if (config.duplicates.exact === 'off') return [];
  const groups = inspectDuplicateGroups(entries, {
    changedPaths,
    enforcement: config.enforcement,
    canonicalRoots: config.duplicates.canonicalRoots,
  });
  return groups.map(({ path: filePath, canonical, duplicates }) => policyFinding(
    'assets/exact-duplicate',
    'image-assets/exact-duplicate',
    filePath,
    `${filePath} 与 ${duplicates.join('、')} 的文件内容完全相同`,
    `优先保留 ${canonical}；人工确认引用后删除多余资源，repo-guard 不会自动删除或改写引用。`,
    { evidence: `建议保留路径：${canonical}` },
  ));
}

function conversionFallbackPair(left, right, config) {
  if (!config.compression.conversion.allowFallbackOriginal) return false;
  const leftParsed = path.posix.parse(left);
  const rightParsed = path.posix.parse(right);
  if (leftParsed.dir !== rightParsed.dir || leftParsed.name !== rightParsed.name) return false;
  return [leftParsed.ext, rightParsed.ext].includes('.webp');
}

async function inspectPixelDuplicates({ sharp, entries, readBuffer, changedPaths, config }) {
  if (config.duplicates.pixel === 'off') return [];
  const supported = entries.filter(({ path: filePath }) => (
    ['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(imageAssetExtension(filePath))
  )).filter(({ size }) => size == null || size <= config.limits.maxInputBytes);
  const hashed = [];
  for (const entry of supported) {
    const result = await normalizedPixelHash(sharp, readBuffer(entry.path), config.limits);
    if (!result.hash) continue;
    hashed.push({
      path: entry.path,
      hash: `${result.width}x${result.height}:${result.animationKey}:${result.hash}`,
    });
  }
  const groups = inspectDuplicateGroups(hashed, {
    changedPaths,
    enforcement: config.enforcement,
    canonicalRoots: config.duplicates.canonicalRoots,
  });
  return groups
    .map(({ path: filePath, canonical, duplicates }) => {
      const governedDuplicates = duplicates.filter(
        (duplicate) => !conversionFallbackPair(filePath, duplicate, config),
      );
      return {
        path: filePath,
        canonical: conversionFallbackPair(filePath, canonical, config)
          ? governedDuplicates[0]
          : canonical,
        duplicates: governedDuplicates,
      };
    })
    .filter(({ duplicates }) => duplicates.length > 0)
    .map(({ path: filePath, canonical, duplicates }) => policyFinding(
      'assets/pixel-duplicate',
      'image-assets/pixel-duplicate',
      filePath,
      `${filePath} 与 ${duplicates.join('、')} 解码后的静态像素一致`,
      `确认资源语义后优先保留 ${canonical}；不要自动删除或批量替换动态引用。`,
    ));
}

async function inspectCandidates({
  root,
  entries,
  readBuffer,
  changedPaths,
  config,
}) {
  const findings = [];
  const targetEntries = entries.filter(({ path: filePath }) => changedPaths.has(filePath));
  const buffers = new Map();
  for (const entry of targetEntries) {
    if (entry.size != null && entry.size > config.limits.maxInputBytes) {
      findings.push(policyFinding(
        'assets/analysis-limit',
        'image-assets/input-too-large',
        entry.path,
        `${entry.path} 大小为 ${entry.size} 字节，超过安全分析上限 ${config.limits.maxInputBytes} 字节`,
        '压缩或拆分图片，或者在人工评审资源风险后调整受限范围内的安全上限。',
      ));
      continue;
    }
    const buffer = readBuffer(entry.path);
    buffers.set(entry.path, buffer);
    if (buffer.length > config.limits.maxInputBytes) {
      findings.push(policyFinding(
        'assets/analysis-limit',
        'image-assets/input-too-large',
        entry.path,
        `${entry.path} 大小为 ${buffer.length} 字节，超过安全分析上限 ${config.limits.maxInputBytes} 字节`,
        '压缩或拆分图片，或者在人工评审资源风险后调整受限范围内的安全上限。',
      ));
      continue;
    }
    const format = detectImageFormat(buffer);
    const extension = imageAssetExtension(entry.path);
    if (!format || !formatMatchesExtension(format, extension)) {
      findings.push(policyFinding(
        'assets/extension-content-mismatch',
        'image-assets/format-mismatch',
        entry.path,
        `${entry.path} 的扩展名与真实图片格式不一致或内容已经损坏`,
        '使用正确的图片编码重新导出文件；不要只修改扩展名。',
        { evidence: `扩展名=${extension}；检测格式=${format ?? '无法识别'}` },
      ));
    }
  }

  const analyzable = targetEntries.filter(({ path: filePath }) => {
    const buffer = buffers.get(filePath);
    return buffer && buffer.length <= config.limits.maxInputBytes
      && formatMatchesExtension(detectImageFormat(buffer), imageAssetExtension(filePath));
  });
  const rasterEntries = analyzable.filter(({ path: filePath }) => (
    ['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(imageAssetExtension(filePath))
  ));
  const svgEntries = analyzable.filter(({ path: filePath }) => imageAssetExtension(filePath) === 'svg');
  const needsSharp = rasterEntries.length > 0 && (
    config.duplicates.pixel !== 'off'
    || (config.compression.enabled && (
      config.compression.raster.enabled
      || config.compression.conversion.enabled
    ))
  );
  const sharpProject = needsSharp ? await loadProjectSharp(root) : null;
  const svgoProject = config.compression.enabled
    && config.compression.svg.enabled
    && svgEntries.length > 0
    ? await loadProjectSvgo(root)
    : null;

  if (config.compression.enabled && config.compression.raster.enabled && sharpProject) {
    for (const entry of rasterEntries) {
      const format = detectImageFormat(buffers.get(entry.path));
      const result = await createRasterCompressionCandidate({
        sharp: sharpProject.sharp,
        buffer: buffers.get(entry.path),
        format,
        config: config.compression,
        limits: config.limits,
      });
      if (result.candidate && meetsSavingsThreshold(
        buffers.get(entry.path).length,
        result.candidate.length,
        config.compression,
      )) {
        const saving = savings(buffers.get(entry.path).length, result.candidate.length);
        findings.push(policyFinding(
          'assets/compression-opportunity',
          'image-assets/compression-opportunity',
          entry.path,
          `${entry.path} 可安全减少 ${saving.savedBytes} 字节（${saving.savedPercent.toFixed(1)}%）`,
          `运行 repo-guard image-optimize --write -- ${entry.path}，并在提交前检查图片差异。`,
          { severity: config.compression.action === 'error' ? 'error' : 'warning' },
        ));
      }
    }
  }
  if (svgoProject) {
    for (const entry of svgEntries) {
      const candidate = createSvgCompressionCandidate(svgoProject.optimize, buffers.get(entry.path));
      if (meetsSavingsThreshold(
        buffers.get(entry.path).length,
        candidate.length,
        config.compression,
      )) {
        const saving = savings(buffers.get(entry.path).length, candidate.length);
        findings.push(policyFinding(
          'assets/compression-opportunity',
          'image-assets/svg-compression-opportunity',
          entry.path,
          `${entry.path} 经 SVGO 分析可减少 ${saving.savedBytes} 字节（${saving.savedPercent.toFixed(1)}%）`,
          `运行 repo-guard image-optimize --write -- ${entry.path}；SVG 写入还必须显式启用 allowWrite。`,
          { severity: config.compression.action === 'error' ? 'error' : 'warning' },
        ));
      }
    }
  }
  if (config.compression.enabled && config.compression.conversion.enabled && sharpProject) {
    const conversion = config.compression.conversion;
    for (const entry of rasterEntries.filter(({ path: filePath }) => (
      conversion.sourceFormats.includes(imageAssetExtension(filePath))
    ))) {
      const format = detectImageFormat(buffers.get(entry.path));
      const result = await createWebpCandidate({
        sharp: sharpProject.sharp,
        buffer: buffers.get(entry.path),
        format,
        config: conversion,
        limits: config.limits,
        metadataPolicy: config.compression.raster.metadata,
      });
      if (result.candidate && meetsSavingsThreshold(
        buffers.get(entry.path).length,
        result.candidate.length,
        conversion,
      )) {
        const saving = savings(buffers.get(entry.path).length, result.candidate.length);
        findings.push(policyFinding(
          'assets/webp-conversion-opportunity',
          'image-assets/webp-conversion-opportunity',
          entry.path,
          `${entry.path} 转为 ${result.lossless ? '无损' : '有损'} WebP 后可减少 ${saving.savedBytes} 字节（${saving.savedPercent.toFixed(1)}%）`,
          `运行 repo-guard image-optimize --to webp --write -- ${entry.path}；工具不会自动删除原图或修改引用。`,
          { severity: conversion.action === 'error' ? 'error' : 'warning' },
        ));
      }
    }
  }
  return { findings, sharpProject, buffers };
}

export const imageAssetsGate = defineGate({
  id: IMAGE_ASSETS_GATE_ID,
  configKey: 'imageAssets',
  featureName: 'imageAssets',
  featureOrder: 42,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'image-assets',
  manualOrder: 152,
  doctorOrder: 152,
  packageScript: 'guard:image-assets',
  rules: IMAGE_ASSET_RULES,
  requiredTools: ['sharp', 'svgo'],
  requiredScripts: [],
  requiredEnvironment: [],
  requiredSecrets: [],
  artifactTypes: [],
  supportsFix: false,
  supportsCancellation: false,
  async inspectSetup({ root, config }) {
    if (!config.imageAssets.enabled) {
      return {
        status: 'ready',
        summary: '图片资源治理已禁用，可运行 repo-guard enable imageAssets 启用',
      };
    }
    const rasterEnabled = config.imageAssets.extensions.some((extension) => (
      ['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(extension)
    ));
    const needsSharp = rasterEnabled && (
      config.imageAssets.duplicates.pixel !== 'off'
      || (config.imageAssets.compression.enabled
        && (
          config.imageAssets.compression.raster.enabled
          || config.imageAssets.compression.conversion.enabled
        ))
    );
    const needsSvgo = config.imageAssets.extensions.includes('svg')
      && config.imageAssets.compression.enabled
      && config.imageAssets.compression.svg.enabled;
    const [sharpProject, svgoProject] = await Promise.all([
      needsSharp ? loadProjectSharp(root) : null,
      needsSvgo ? loadProjectSvgo(root) : null,
    ]);
    const tools = [
      sharpProject ? `sharp ${sharpProject.version}` : null,
      svgoProject ? `svgo ${svgoProject.version}` : null,
    ].filter(Boolean);
    return {
      status: 'ready',
      summary: `图片资源治理已启用；Hook 和 CI 保持只读${tools.length > 0 ? `；工具=${tools.join('、')}` : ''}`,
    };
  },
  plan({ root, config, environment, revision, changes, files }) {
    const enabled = environment === 'manual' || config.imageAssets.enabled;
    const entries = enabled ? snapshotEntries({ root, environment, revision, files }) : [];
    const selectedPaths = selectImageAssetPaths(entries, config.imageAssets);
    const selected = new Set(selectedPaths);
    const selectedEntries = entries.filter(({ path: filePath }) => selected.has(filePath));
    const changedPaths = changedImagePaths(
      changes,
      selectedPaths,
      environment,
      config.imageAssets.enforcement,
    );
    return Object.freeze({
      enabled,
      entries: Object.freeze(selectedEntries.map((entry) => Object.freeze({ ...entry }))),
      changedPaths: Object.freeze([...changedPaths]),
      environment,
    });
  },
  async run({ root, config, plan }) {
    const startedAt = Date.now();
    if (!plan.enabled) return skippedResult(IMAGE_ASSETS_GATE_ID, '图片资源治理已禁用');
    if (plan.entries.length === 0) return skippedResult(IMAGE_ASSETS_GATE_ID, '没有匹配配置范围的图片资源');
    try {
      const changedPaths = new Set(plan.changedPaths);
      const readBuffer = createBufferReader(
        root,
        plan.entries,
        plan.environment,
        config.imageAssets.limits,
      );
      const entries = plan.entries.map((entry) => ({
        ...entry,
        ...(entry.oid ? {} : { hash: contentHash(readBuffer(entry.path)) }),
      }));
      const findings = [
        ...inspectImageAssetNames(
          entries.map(({ path: filePath }) => filePath),
          config.imageAssets,
          { governedPaths: [...changedPaths] },
        ),
        ...exactDuplicateFindings(entries, changedPaths, config.imageAssets),
      ];
      const candidateInspection = await inspectCandidates({
        root,
        entries,
        readBuffer,
        changedPaths,
        config: config.imageAssets,
      });
      findings.push(...candidateInspection.findings);
      if (config.imageAssets.duplicates.pixel !== 'off'
        && !['pre-commit', 'ci-policy'].includes(plan.environment)) {
        const sharpProject = candidateInspection.sharpProject ?? await loadProjectSharp(root);
        findings.push(...await inspectPixelDuplicates({
          sharp: sharpProject.sharp,
          entries,
          readBuffer,
          changedPaths,
          config: config.imageAssets,
        }));
      }
      const exceptionResult = applyExceptions(findings, config.exceptions);
      const errorFindings = exceptionResult.violations.filter(({ severity = 'error' }) => severity === 'error');
      const warningFindings = exceptionResult.violations.filter(({ severity = 'error' }) => severity !== 'error');
      const normalized = exceptionResult.violations.map((finding) => findingFromPolicy(finding, {
        severity: finding.severity ?? 'error',
      }));
      const diagnostics = exceptionResult.approved.map(({ path: filePath, rule, exception }) => ({
        level: 'warn',
        message: `图片资源规则已使用批准例外：${filePath} ${rule}（${exception.id}，到期日=${exception.expiresOn}）`,
      }));
      const resultOptions = {
        diagnostics,
        findings: normalized,
        metrics: {
          checkedFiles: entries.length,
          changedFiles: changedPaths.size,
          violations: errorFindings.length,
          warnings: warningFindings.length,
          approvedExceptions: exceptionResult.approved.length,
        },
        durationMs: Date.now() - startedAt,
      };
      return errorFindings.length > 0
        ? violationResult(IMAGE_ASSETS_GATE_ID, `图片资源治理发现 ${errorFindings.length} 项阻断错误`, resultOptions)
        : passedResult(IMAGE_ASSETS_GATE_ID, `图片资源治理已通过，共检查 ${entries.length} 个文件`, resultOptions);
    } catch (error) {
      const typedError = toRepoGuardError(error, {
        kind: 'execution',
        code: 'image-assets/analysis-failed',
      });
      return createGateResult({
        gateId: IMAGE_ASSETS_GATE_ID,
        status: typedError.kind === 'configuration' ? 'configuration-error' : 'execution-error',
        summary: typedError.message,
        error: typedError,
        durationMs: Date.now() - startedAt,
      });
    }
  },
});

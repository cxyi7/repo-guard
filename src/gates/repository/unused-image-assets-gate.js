import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { validateConfig } from '../../config/configuration-validation.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import {
  errorStatus,
  executionError,
  rangeError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  listRevisionBlobEntries,
  readGitBlobs,
} from '../../git/binary-content.js';
import { readFileAtRevision } from '../../git/revision-content.js';
import { assertImagePathHasNoSymbolicLink } from '../../integrations/images/project.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import { selectImageAssetPaths } from '../../policies/image-assets.js';
import {
  analyzeUnusedImageAssets,
  selectImageReferenceSourcePaths,
  UNUSED_IMAGE_ASSET_RULE,
  unusedImageAssetFinding,
} from '../../policies/unused-image-assets.js';
import {
  findingFromPolicy,
  passedResult,
  skippedResult,
  violationResult,
} from '../native-result.js';

export const UNUSED_IMAGE_ASSETS_GATE_ID = 'repository.unused-image-assets';

function normalizedPath(candidate) {
  return (typeof candidate === 'string' ? candidate : candidate.relative).replaceAll('\\', '/');
}

function assertSourceLimits(entries, config) {
  if (entries.length > config.limits.maxSourceFiles) {
    throw executionError(
      'unused-image-assets/source-count-limit',
      `无效图片资源门禁需要分析 ${entries.length} 个源码文件，超过安全上限 ${config.limits.maxSourceFiles}`,
    );
  }
  const oversized = entries.find(({ size }) => size > config.limits.maxSourceBytes);
  if (oversized) {
    throw executionError(
      'unused-image-assets/source-size-limit',
      `${oversized.path} 大小为 ${oversized.size} 字节，超过源码分析上限 ${config.limits.maxSourceBytes} 字节`,
    );
  }
  const total = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (total > config.limits.maxTotalSourceBytes) {
    throw executionError(
      'unused-image-assets/source-total-limit',
      `无效图片资源门禁待读取源码共 ${total} 字节，超过安全上限 ${config.limits.maxTotalSourceBytes} 字节`,
    );
  }
}

function worktreeSnapshot(root, files, imageConfig) {
  const candidates = files.map((candidate) => ({ path: normalizedPath(candidate) }));
  const relevantPaths = new Set([
    ...selectImageAssetPaths(candidates, imageConfig),
    ...selectImageReferenceSourcePaths(candidates, imageConfig.unused),
  ]);
  const entries = candidates
    .filter(({ path: filePath }) => relevantPaths.has(filePath))
    .map((entry) => {
      const filePath = entry.path;
      const absolute = path.resolve(root, filePath);
      const relative = path.relative(root, absolute);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw executionError('unused-image-assets/path-outside-repository', `源码路径越出仓库范围：${filePath}`);
      }
      assertImagePathHasNoSymbolicLink(root, absolute, filePath);
      return { ...entry, size: lstatSync(absolute).size, absolute };
    });
  const sourceSet = new Set(selectImageReferenceSourcePaths(entries, imageConfig.unused));
  const sourceEntries = entries.filter(({ path: filePath }) => sourceSet.has(filePath));
  assertSourceLimits(sourceEntries, imageConfig.unused);
  const content = new Map(sourceEntries.map((entry) => [entry.path, readFileSync(entry.absolute, 'utf8')]));
  return {
    entries,
    readSource(filePath) {
      return content.get(filePath);
    },
  };
}

function revisionSnapshot(root, revision, imageConfig) {
  const entries = listRevisionBlobEntries(root, revision);
  const sourceSet = new Set(selectImageReferenceSourcePaths(entries, imageConfig.unused));
  const sourceEntries = entries.filter(({ path: filePath }) => sourceSet.has(filePath));
  assertSourceLimits(sourceEntries, imageConfig.unused);
  const content = readGitBlobs(root, sourceEntries, {
    maxTotalBytes: imageConfig.unused.limits.maxTotalSourceBytes,
  });
  return {
    entries,
    readSource(filePath) {
      return content.get(filePath)?.toString('utf8');
    },
  };
}

function inspectSnapshot(snapshot, imageConfig, validateDynamicDeclarations) {
  return analyzeUnusedImageAssets({
    entries: snapshot.entries,
    readSource: snapshot.readSource,
    imageConfig,
    validateDynamicDeclarations,
  });
}

function baselineImageConfig(root, revision, fallback) {
  const snapshot = readFileAtRevision(root, revision, CONFIG_FILE);
  if (!snapshot.exists) return fallback;
  try {
    return validateConfig(JSON.parse(snapshot.content), `${CONFIG_FILE}@${revision.slice(0, 12)}`).imageAssets;
  } catch (error) {
    throw executionError(
      'unused-image-assets/baseline-config-invalid',
      `无法使用基线提交 ${revision.slice(0, 12)} 中的 ${CONFIG_FILE} 计算无效图片债务：${error.message}`,
      { cause: error },
    );
  }
}

function findingsWithExceptions(paths, config) {
  const approved = [];
  const violations = [];
  for (const filePath of paths) {
    const finding = unusedImageAssetFinding(filePath, config.imageAssets.unused.action);
    const exception = findStructuredException(config.exceptions, finding);
    if (exception) approved.push({ finding, exception });
    else violations.push(finding);
  }
  return { approved, violations };
}

export const unusedImageAssetsGate = defineGate({
  id: UNUSED_IMAGE_ASSETS_GATE_ID,
  configKey: 'imageAssets.unused',
  featureName: 'unusedImageAssets',
  featureOrder: 43,
  configVersions: [1],
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  ciScopes: ['all-files'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'unused-image-assets',
  manualOrder: 153,
  doctorOrder: 153,
  packageScript: 'guard:unused-image-assets',
  rules: [UNUSED_IMAGE_ASSET_RULE],
  requiredTools: [],
  requiredScripts: [],
  requiredEnvironment: [],
  requiredSecrets: [],
  artifactTypes: [],
  supportsFix: false,
  supportsCancellation: false,
  inspectSetup({ config }) {
    return {
      status: 'ready',
      summary: config.imageAssets.unused.enabled
        ? `无效图片资源门禁已启用（${config.imageAssets.enforcement === 'changedFiles' ? '只阻止新增债务' : '阻止全部存量'}）`
        : '无效图片资源门禁已禁用，可使用 repo-guard enable unusedImageAssets 启用',
    };
  },
  plan({ config, environment, revision, files }) {
    return Object.freeze({
      enabled: environment === 'manual'
        || config.imageAssets.unused.enabled,
      environment,
      files: Object.freeze([...(files ?? [])]),
      revision: revision ? Object.freeze({ ...revision }) : null,
    });
  },
  run({ root, config, plan }) {
    const startedAt = Date.now();
    if (!plan.enabled) return skippedResult(UNUSED_IMAGE_ASSETS_GATE_ID, '无效图片资源门禁已禁用');
    try {
      const currentSnapshot = plan.environment === 'manual'
        ? worktreeSnapshot(root, plan.files, config.imageAssets)
        : revisionSnapshot(root, plan.revision?.head ?? 'HEAD', config.imageAssets);
      const current = inspectSnapshot(currentSnapshot, config.imageAssets, true);
      if (current.assetPaths.length === 0) {
        return skippedResult(UNUSED_IMAGE_ASSETS_GATE_ID, '没有匹配配置范围的图片资源');
      }
      let governedPaths = current.unusedPaths;
      let baselineUnusedCount = 0;
      if (plan.environment !== 'manual' && config.imageAssets.enforcement === 'changedFiles') {
        if (!plan.revision?.base) {
          throw rangeError(
            'unused-image-assets/revision-required',
            '增量无效图片资源门禁需要明确且可信的 Git 基线与当前提交范围',
          );
        }
        const baselineConfig = baselineImageConfig(
          root,
          plan.revision.base,
          config.imageAssets,
        );
        const baseline = inspectSnapshot(
          revisionSnapshot(root, plan.revision.base, baselineConfig),
          baselineConfig,
          false,
        );
        const baselineUnused = new Set(baseline.unusedPaths);
        baselineUnusedCount = baselineUnused.size;
        governedPaths = current.unusedPaths.filter((filePath) => !baselineUnused.has(filePath));
      }
      const result = findingsWithExceptions(governedPaths, config);
      const errors = result.violations.filter(({ severity }) => severity === 'error');
      const warnings = result.violations.filter(({ severity }) => severity === 'warning');
      const diagnostics = result.approved.map(({ finding, exception }) => ({
        level: 'warn',
        message: `无效图片资源规则已使用批准例外：${finding.path}（${exception.id}，到期日期=${exception.expiresOn}）`,
      }));
      const options = {
        diagnostics,
        findings: result.violations.map((finding) => findingFromPolicy(finding, {
          severity: finding.severity,
        })),
        metrics: {
          assets: current.assetPaths.length,
          sourceFiles: current.sourcePaths.length,
          references: current.referenceCount,
          dynamicGlobs: current.dynamicGlobCount,
          currentUnused: current.unusedPaths.length,
          baselineUnused: baselineUnusedCount,
          governedUnused: governedPaths.length,
          warnings: warnings.length,
          approvedExceptions: result.approved.length,
        },
        durationMs: Date.now() - startedAt,
      };
      return errors.length > 0
        ? violationResult(UNUSED_IMAGE_ASSETS_GATE_ID, `无效图片资源门禁发现 ${errors.length} 项阻断错误`, options)
        : passedResult(UNUSED_IMAGE_ASSETS_GATE_ID, `无效图片资源门禁已通过，共检查 ${current.assetPaths.length} 个图片资源`, options);
    } catch (error) {
      const typedError = toRepoGuardError(error, {
        kind: 'execution',
        code: 'unused-image-assets/analysis-failed',
      });
      return createGateResult({
        gateId: UNUSED_IMAGE_ASSETS_GATE_ID,
        status: errorStatus(typedError),
        summary: typedError.message,
        error: typedError,
        durationMs: Date.now() - startedAt,
      });
    }
  },
});

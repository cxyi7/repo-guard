import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import {
  configurationError,
  executionError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import {
  ASYNC_RESOURCE_CLEANUP_RULE,
  inspectAsyncResourceCleanup,
  selectAsyncResourceCleanupFiles,
} from '../../policies/async-resource-cleanup.js';

export const ASYNC_RESOURCE_CLEANUP_GATE_ID = 'quality.vue-async-resource-cleanup';

function normalizedFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replaceAll('\\', '/'),
    };
  });
}

export const vueAsyncResourceCleanupGate = defineGate({
  id: ASYNC_RESOURCE_CLEANUP_GATE_ID,
  configKey: 'preCommit.asyncResourceCleanup',
  featureName: 'asyncResourceCleanup',
  featureOrder: 35,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'async-resource-cleanup',
  manualOrder: 75,
  doctorOrder: 75,
  packageScript: 'guard:async-resource-cleanup',
  rules: [ASYNC_RESOURCE_CLEANUP_RULE],
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
      summary: config.preCommit.asyncResourceCleanup.enabled
        ? `Vue 异步资源清理门禁已启用（阻断级，规则=${ASYNC_RESOURCE_CLEANUP_RULE}）`
        : 'Vue 异步资源清理门禁已禁用，可使用 repo-guard enable asyncResourceCleanup 启用',
    };
  },
  plan({ root, config, environment, files }) {
    if (!Array.isArray(files)) {
      throw configurationError(
        'async-resource-cleanup/file-scope-required',
        '异步资源清理门禁要求明确的文件范围',
      );
    }
    const featureConfig = environment === 'manual'
      ? { ...config.preCommit.asyncResourceCleanup, enabled: true }
      : config.preCommit.asyncResourceCleanup;
    const immutableConfig = Object.freeze({
      ...featureConfig,
      include: Object.freeze([...featureConfig.include]),
      exclude: Object.freeze([...featureConfig.exclude]),
      extensions: Object.freeze([...featureConfig.extensions]),
      requestFunctions: Object.freeze([...featureConfig.requestFunctions]),
    });
    return Object.freeze({
      config: immutableConfig,
      files: Object.freeze(selectAsyncResourceCleanupFiles(
        normalizedFiles(root, files),
        featureConfig,
      ).map((file) => Object.freeze({ ...file }))),
    });
  },
  run({ root, config, plan }) {
    const startedAt = Date.now();
    if (!plan || !Array.isArray(plan.files)) {
      throw executionError(
        'async-resource-cleanup/execution-plan-required',
        '异步资源清理门禁要求执行计划',
      );
    }
    if (!plan.config.enabled) {
      return skippedResult(ASYNC_RESOURCE_CLEANUP_GATE_ID, 'Vue 异步资源清理门禁已禁用');
    }
    try {
      const inspection = inspectAsyncResourceCleanup({
        root,
        files: plan.files,
        config: plan.config,
        exceptions: config.exceptions,
      });
      const metrics = {
        checkedFiles: inspection.checkedCount,
        approvedExceptions: inspection.approved.length,
        violations: inspection.violations.length,
      };
      const diagnostics = inspection.approved.map((finding) => ({
        level: 'warn',
        message: `异步资源清理已批准例外：${finding.path}:${finding.line}:${finding.column}（${finding.exception.id}，到期日期=${finding.exception.expiresOn}）`,
      }));
      if (inspection.violations.length === 0) {
        return passedResult(
          ASYNC_RESOURCE_CLEANUP_GATE_ID,
          `${inspection.checkedCount} 个文件通过异步资源清理检查`,
          { diagnostics, metrics, durationMs: Date.now() - startedAt },
        );
      }
      return violationResult(
        ASYNC_RESOURCE_CLEANUP_GATE_ID,
        `异步资源清理检查发现 ${inspection.violations.length} 项阻断错误`,
        {
          diagnostics,
          metrics,
          findings: inspection.violations.map((finding) => findingFromPolicy(finding)),
          durationMs: Date.now() - startedAt,
        },
      );
    } catch (error) {
      const typedError = toRepoGuardError(error, {
        kind: 'execution',
        code: 'async-resource-cleanup/analysis-failed',
      });
      return createGateResult({
        gateId: ASYNC_RESOURCE_CLEANUP_GATE_ID,
        status: 'execution-error',
        summary: typedError.message,
        durationMs: Date.now() - startedAt,
        error: typedError,
      });
    }
  },
});

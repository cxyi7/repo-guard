import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import {
  configurationError,
  executionError,
  securityError,
} from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { skippedResult } from '../native-result.js';
import { runExactNpmScript, containsSensitiveExternalData } from '../../integrations/npm/external-script.js';
import { assertReleaseScriptReadOnly } from '../../integrations/npm/release-environment.js';
import { runGit } from '../../git/execution.js';

const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const SAFE_GENERATED_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const HAN_TEXT = /\p{Script=Han}/u;

function localizedExternalText(value, fallback, diagnostics, label, level = 'info') {
  if (value == null || HAN_TEXT.test(value)) return value;
  diagnostics.push({
    source: 'external-report',
    stream: level === 'info' ? 'stdout' : 'stderr',
    level,
    message: `${label}原文：${value}`,
  });
  return fallback;
}

function externalReportError(code, message, options = {}) {
  return executionError(`external-gate/${code}`, message, {
    expected: '外部门禁生成符合 repo-guard-json-v1 契约且与进程退出状态一致的报告。',
    remediation: {
      goal: '修复外部门禁脚本或报告生成器，使报告完整、最新且可验证',
      steps: ['根据错误码和消息修复报告字段、退出码或 artifact 输出'],
      constraints: ['不得伪造通过状态、删除错误级问题项或跳过报告校验'],
      verification: ['重新运行同一 project.* 门禁并验证报告通过 Schema 与安全检查'],
    },
    ...options,
  });
}

function externalReportSecurityError(code, message, options = {}) {
  return securityError(`external-gate/${code}`, message, {
    expected: '外部门禁报告和 artifact 只写入安全的未跟踪 reports/ 路径，且不包含敏感数据。',
    remediation: {
      goal: '移除不安全路径或敏感内容后重新生成报告',
      steps: ['检查报告路径、符号链接、tracked 状态和敏感数据来源'],
      constraints: ['不得放宽路径或敏感信息校验'],
      verification: ['重新运行门禁并确认所有生成文件通过安全检查'],
    },
    ...options,
  });
}

function isSafeGeneratedSegment(segment) {
  return SAFE_GENERATED_SEGMENT.test(segment) && !WINDOWS_RESERVED_NAME.test(segment);
}

function assertSafeGeneratedPath(root, relative, label, { mustExist = true } = {}) {
  nonEmpty(relative, label);
  const segments = relative.split('/');
  if (relative.includes('\\')
    || segments[0] !== 'reports'
    || segments.length < 2
    || segments.some((segment) => !isSafeGeneratedSegment(segment))) {
    throw externalReportSecurityError('unsafe-report-path', `${label} 必须使用 reports/ 内的规范化路径`);
  }
  const target = path.resolve(root, relative);
  const reportsRoot = path.resolve(root, 'reports');
  if (target === reportsRoot || !target.startsWith(`${reportsRoot}${path.sep}`)) {
    throw externalReportSecurityError('report-path-escape', `${label} 必须位于 reports/ 内`);
  }
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw externalReportSecurityError('symlink-traversal', `${label} 不得穿过符号链接： ${relative}`, {
        details: { location: { path: relative } },
      });
    }
  }
  if (mustExist && (!existsSync(target) || !lstatSync(target).isFile())) {
    throw externalReportError('missing-generated-file', `${label} 未生成为常规文件： ${relative}`, {
      details: { location: { path: relative } },
    });
  }
  const relativeKey = relative.toLowerCase();
  const tracked = runGit(['ls-files', '-z'], { cwd: root }).stdout
    .split('\0')
    .some((trackedPath) => trackedPath.toLowerCase() === relativeKey);
  if (tracked) throw externalReportSecurityError('tracked-file-overwrite', `${label} 不得覆盖已跟踪文件： ${relative}`, {
    details: { location: { path: relative } },
  });
  return target;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw externalReportError('invalid-field', `${label} 必须是非空字符串`);
  return value;
}

function repositoryPath(value, label) {
  const normalized = nonEmpty(value, label);
  const segments = normalized.split('/');
  if (normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw externalReportSecurityError('unsafe-artifact-path', `${label} 必须是规范化的仓库相对路径`);
  }
  return normalized;
}

function assertExactProperties(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw externalReportError('invalid-object', `${label} 必须是对象`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw externalReportError('unknown-fields', `${label} 包含未知字段： ${unknown.join(', ')}`);
}

function validateReport(config, raw, root, startedAt, execution) {
  if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) {
    throw externalReportError('report-too-large', `外部门禁报告超过 ${MAX_REPORT_BYTES} 字节`);
  }
  if (containsSensitiveExternalData(raw)) {
    throw externalReportSecurityError('sensitive-report-data', `外部门禁 ${config.id} 的报告包含敏感数据`);
  }
  let report;
  try { report = JSON.parse(raw); } catch (error) {
    throw externalReportError('invalid-json', `外部门禁 ${config.id} 的报告不是有效 JSON：${error.message}`, { cause: error });
  }
  assertExactProperties(
    report,
    ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts'],
    `外部门禁 ${config.id} 的报告`,
  );
  for (const field of ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts']) {
    if (!Object.hasOwn(report, field)) throw externalReportError('missing-field', `外部门禁 ${config.id} 的报告缺少 ${field}`);
  }
  if (report.schemaVersion !== 1) throw externalReportError('unsupported-schema', `外部门禁 ${config.id} 要求报告的 schemaVersion 为 1`);
  if (report.gateId !== config.id) throw externalReportError('gate-id-mismatch', `外部门禁报告 gateId 必须为 ${config.id}`);
  if (!['passed', 'violation'].includes(report.status)) {
    throw externalReportError('invalid-status', `外部门禁 ${config.id} 报告的 status 必须为 passed 或 violation`);
  }
  const expectedExitCode = report.status === 'passed' ? 0 : 2;
  if (execution.status !== expectedExitCode) {
    throw externalReportError(
      'exit-status-mismatch',
      `外部门禁 ${config.id} 报告的 status 为 ${report.status} 时，脚本退出码必须为 `
      + `${expectedExitCode}；实际收到 ${String(execution.status)}`,
    );
  }
  nonEmpty(report.summary, `外部门禁 ${config.id} 的报告摘要`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.artifacts)) {
    throw externalReportError('invalid-collections', `外部门禁 ${config.id} 的 findings 和 artifacts 必须是数组`);
  }
  if (report.artifacts.length > MAX_ARTIFACTS) {
    throw externalReportError('too-many-artifacts', `外部门禁 ${config.id} 的报告超过 ${MAX_ARTIFACTS} 个产物`);
  }
  if (!report.metrics || typeof report.metrics !== 'object' || Array.isArray(report.metrics)) {
    throw externalReportError('invalid-metrics', `外部门禁 ${config.id} 的 metrics 必须是对象`);
  }
  const diagnostics = processOutputDiagnostics(execution, {
    source: `external-gate:${config.id}`,
    root,
  });
  const findings = report.findings.map((finding, index) => {
    assertExactProperties(
      finding,
      ['ruleId', 'severity', 'message', 'location', 'evidence', 'remediation'],
      `外部门禁问题项 ${index + 1}`,
    );
    const level = finding.severity === 'error'
      ? 'error'
      : finding.severity === 'warning' ? 'warn' : 'info';
    const localizedFinding = {
      ...finding,
      message: localizedExternalText(
        finding.message,
        `外部门禁规则 ${finding.ruleId} 报告了问题`,
        diagnostics,
        `外部门禁问题项 ${index + 1} 的消息`,
        level,
      ),
      evidence: localizedExternalText(
        finding.evidence,
        '外部门禁提供了原始证据，请查看诊断信息。',
        diagnostics,
        `外部门禁问题项 ${index + 1} 的证据`,
        level,
      ),
      remediation: localizedExternalText(
        finding.remediation,
        `请修复规则 ${finding.ruleId} 对应的问题后重新运行外部门禁。`,
        diagnostics,
        `外部门禁问题项 ${index + 1} 的修复说明`,
        level,
      ),
    };
    if (finding.location != null) {
      assertExactProperties(
        finding.location,
        ['path', 'line', 'column', 'endLine', 'endColumn'],
        `外部门禁问题项 ${index + 1} 的位置`,
      );
      return {
        ...localizedFinding,
        location: {
          ...finding.location,
          path: repositoryPath(
            finding.location.path,
            `外部门禁问题项 ${index + 1} 的位置路径`,
          ),
        },
      };
    }
    return localizedFinding;
  });
  const hasErrorFinding = findings.some(({ severity }) => severity === 'error');
  if (report.status === 'passed' && hasErrorFinding) {
    throw externalReportError('passed-with-error-findings', `外部门禁 ${config.id} 的 passed 报告不得包含 error 级问题项`);
  }
  if (report.status === 'violation' && !hasErrorFinding) {
    throw externalReportError('violation-without-error-finding', `外部门禁 ${config.id} 的 violation 报告必须包含 error 级问题项`);
  }
  const artifacts = report.artifacts.map((artifact, index) => {
    assertExactProperties(
      artifact,
      ['path', 'type', 'description'],
      `外部门禁产物 ${index + 1}`,
    );
    const artifactPath = nonEmpty(artifact?.path, `外部门禁产物 ${index + 1} 的路径`);
    const target = assertSafeGeneratedPath(root, artifactPath, `外部门禁产物 ${index + 1}`);
    if (statSync(target).size > MAX_ARTIFACT_BYTES) {
      throw externalReportError('artifact-too-large', `外部门禁产物超过 ${MAX_ARTIFACT_BYTES} 字节：${artifactPath}`, {
        details: { location: { path: artifactPath } },
      });
    }
    if (containsSensitiveExternalData(readFileSync(target))) {
      throw externalReportSecurityError('sensitive-artifact-data', `外部门禁产物包含敏感数据： ${artifactPath}`, {
        details: { location: { path: artifactPath } },
      });
    }
    return {
      ...artifact,
      description: localizedExternalText(
        artifact.description,
        `外部门禁产物 ${index + 1}`,
        diagnostics,
        `外部门禁产物 ${index + 1} 的说明`,
      ),
    };
  });
  const artifactPaths = artifacts.map(({ path: artifactPath }) => artifactPath.toLowerCase());
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw externalReportError('duplicate-artifacts', `外部门禁 ${config.id} 的报告包含重复的产物路径`);
  }
  if (artifactPaths.includes(config.report.path.toLowerCase())) {
    throw externalReportError('primary-report-repeated', `外部门禁 ${config.id} 的产物不得重复使用主报告路径`);
  }
  return createGateResult({
    gateId: config.id,
    status: report.status,
    summary: localizedExternalText(
      report.summary,
      report.status === 'passed'
        ? `外部门禁 ${config.id} 已通过`
        : `外部门禁 ${config.id} 发现违规`,
      diagnostics,
      '外部门禁报告摘要',
      report.status === 'passed' ? 'info' : 'error',
    ),
    findings,
    metrics: report.metrics,
    artifacts: [
      { path: config.report.path, type: 'repo-guard-json-v1', description: '外部门禁报告' },
      ...artifacts,
    ],
    durationMs: Date.now() - startedAt,
    diagnostics,
  });
}

function readPackage(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function runtimeExternalGateConfig(projectConfig, fallback) {
  return projectConfig.externalGates.find(({ id }) => id === fallback.id) ?? fallback;
}

export function defineExternalGate(config) {
  return defineGate({
    id: config.id,
    configKey: `externalGates.${config.id}`,
    configVersions: [1],
    environments: config.environments,
    mutation: 'read-only',
    defaultTimeoutMs: config.timeoutMs,
    requiredScripts: [config.script],
    artifactTypes: ['repo-guard-json-v1'],
    supportsCancellation: true,
    inspectSetup({ root, config: projectConfig, environment }) {
      const runtimeConfig = runtimeExternalGateConfig(projectConfig, config);
      if (!runtimeConfig.enabled) return { status: 'ready', summary: `${config.id} 已禁用` };
      if (!config.environments.includes(environment)) {
        return { status: 'misconfigured', summary: `${config.id} 不支持 ${environment}` };
      }
      const command = readPackage(root).scripts?.[config.script];
      if (typeof command !== 'string' || !command.trim()) {
        throw configurationError('external-gate/missing-script', `外部门禁 ${config.id} 要求 package.json 提供脚本“${config.script}”`, {
          details: { location: { path: 'package.json' } },
        });
      }
      if (environment === 'release-ready') {
        assertReleaseScriptReadOnly(readPackage(root).scripts ?? {}, config.script);
      }
      assertSafeGeneratedPath(root, config.report.path, '外部门禁报告', { mustExist: false });
      return { status: 'ready', summary: `${config.id} 使用 npm 脚本 ${config.script}` };
    },
    plan: ({ root, config: projectConfig }) => ({
      enabled: runtimeExternalGateConfig(projectConfig, config).enabled,
      reportPath: assertSafeGeneratedPath(root, config.report.path, '外部门禁报告', { mustExist: false }),
    }),
    async run({ root, signal, plan }) {
      if (!plan.enabled) return skippedResult(config.id, `${config.id} 已禁用`);
      if (existsSync(plan.reportPath)) unlinkSync(plan.reportPath);
      const startedAt = Date.now();
      const execution = await runExactNpmScript({ root, script: config.script, signal });
      if (!existsSync(plan.reportPath)) throw externalReportError('report-not-generated', `外部门禁 ${config.id} 未生成 ${config.report.path}`, {
        details: { location: { path: config.report.path } },
      });
      const verifiedReportPath = assertSafeGeneratedPath(root, config.report.path, '外部门禁报告');
      const reportStat = statSync(verifiedReportPath);
      if (reportStat.mtimeMs < startedAt - 1000) throw externalReportError('stale-report', `外部门禁 ${config.id} 的报告已过期`, {
        details: { location: { path: config.report.path } },
      });
      return validateReport(config, readFileSync(verifiedReportPath, 'utf8'), root, startedAt, execution);
    },
  });
}

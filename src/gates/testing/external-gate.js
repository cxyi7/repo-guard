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

function externalReportError(code, message, options = {}) {
  return executionError(`external-gate/${code}`, message, {
    expected: '外部门禁生成符合 repo-guard-json-v1 契约且与进程退出状态一致的报告。',
    remediation: {
      goal: '修复外部门禁脚本或报告生成器，使报告完整、最新且可验证',
      steps: ['根据错误码和消息修复报告字段、退出码或 artifact 输出'],
      constraints: ['不得伪造 passed 状态、删除 error finding 或跳过报告校验'],
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
    throw externalReportSecurityError('unsafe-report-path', `${label} must use a normalized path inside reports/`);
  }
  const target = path.resolve(root, relative);
  const reportsRoot = path.resolve(root, 'reports');
  if (target === reportsRoot || !target.startsWith(`${reportsRoot}${path.sep}`)) {
    throw externalReportSecurityError('report-path-escape', `${label} must stay inside reports/`);
  }
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw externalReportSecurityError('symlink-traversal', `${label} must not traverse a symbolic link: ${relative}`, {
        details: { location: { path: relative } },
      });
    }
  }
  if (mustExist && (!existsSync(target) || !lstatSync(target).isFile())) {
    throw externalReportError('missing-generated-file', `${label} was not generated as a regular file: ${relative}`, {
      details: { location: { path: relative } },
    });
  }
  const relativeKey = relative.toLowerCase();
  const tracked = runGit(['ls-files', '-z'], { cwd: root }).stdout
    .split('\0')
    .some((trackedPath) => trackedPath.toLowerCase() === relativeKey);
  if (tracked) throw externalReportSecurityError('tracked-file-overwrite', `${label} must not overwrite a tracked file: ${relative}`, {
    details: { location: { path: relative } },
  });
  return target;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw externalReportError('invalid-field', `${label} must be a non-empty string`);
  return value;
}

function repositoryPath(value, label) {
  const normalized = nonEmpty(value, label);
  const segments = normalized.split('/');
  if (normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw externalReportSecurityError('unsafe-artifact-path', `${label} must be a normalized repository-relative path`);
  }
  return normalized;
}

function assertExactProperties(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw externalReportError('invalid-object', `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw externalReportError('unknown-fields', `${label} contains unknown field(s): ${unknown.join(', ')}`);
}

function validateReport(config, raw, root, startedAt, execution) {
  if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) {
    throw externalReportError('report-too-large', `External gate report exceeded ${MAX_REPORT_BYTES} bytes`);
  }
  if (containsSensitiveExternalData(raw)) {
    throw externalReportSecurityError('sensitive-report-data', `External gate ${config.id} report contains sensitive data`);
  }
  let report;
  try { report = JSON.parse(raw); } catch (error) {
    throw externalReportError('invalid-json', `External gate ${config.id} report is invalid JSON: ${error.message}`, { cause: error });
  }
  assertExactProperties(
    report,
    ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts'],
    `External gate ${config.id} report`,
  );
  for (const field of ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts']) {
    if (!Object.hasOwn(report, field)) throw externalReportError('missing-field', `External gate ${config.id} report is missing ${field}`);
  }
  if (report.schemaVersion !== 1) throw externalReportError('unsupported-schema', `External gate ${config.id} requires report schemaVersion 1`);
  if (report.gateId !== config.id) throw externalReportError('gate-id-mismatch', `External gate report gateId must be ${config.id}`);
  if (!['passed', 'violation'].includes(report.status)) {
    throw externalReportError('invalid-status', `External gate ${config.id} report status must be passed or violation`);
  }
  const expectedExitCode = report.status === 'passed' ? 0 : 2;
  if (execution.status !== expectedExitCode) {
    throw externalReportError(
      'exit-status-mismatch',
      `External gate ${config.id} report status ${report.status} requires script exit code `
      + `${expectedExitCode}; received ${String(execution.status)}`,
    );
  }
  nonEmpty(report.summary, `External gate ${config.id} report summary`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.artifacts)) {
    throw externalReportError('invalid-collections', `External gate ${config.id} findings and artifacts must be arrays`);
  }
  if (report.artifacts.length > MAX_ARTIFACTS) {
    throw externalReportError('too-many-artifacts', `External gate ${config.id} report exceeds ${MAX_ARTIFACTS} artifacts`);
  }
  if (!report.metrics || typeof report.metrics !== 'object' || Array.isArray(report.metrics)) {
    throw externalReportError('invalid-metrics', `External gate ${config.id} metrics must be an object`);
  }
  const findings = report.findings.map((finding, index) => {
    assertExactProperties(
      finding,
      ['ruleId', 'severity', 'message', 'location', 'evidence', 'remediation'],
      `External gate finding ${index + 1}`,
    );
    if (finding.location != null) {
      assertExactProperties(
        finding.location,
        ['path', 'line', 'column', 'endLine', 'endColumn'],
        `External gate finding ${index + 1} location`,
      );
      return {
        ...finding,
        location: {
          ...finding.location,
          path: repositoryPath(
            finding.location.path,
            `External gate finding ${index + 1} location path`,
          ),
        },
      };
    }
    return finding;
  });
  const hasErrorFinding = findings.some(({ severity }) => severity === 'error');
  if (report.status === 'passed' && hasErrorFinding) {
    throw externalReportError('passed-with-error-findings', `External gate ${config.id} passed report must not contain error findings`);
  }
  if (report.status === 'violation' && !hasErrorFinding) {
    throw externalReportError('violation-without-error-finding', `External gate ${config.id} violation report requires an error finding`);
  }
  const artifacts = report.artifacts.map((artifact, index) => {
    assertExactProperties(
      artifact,
      ['path', 'type', 'description'],
      `External gate artifact ${index + 1}`,
    );
    const artifactPath = nonEmpty(artifact?.path, `External gate artifact ${index + 1} path`);
    const target = assertSafeGeneratedPath(root, artifactPath, `External gate artifact ${index + 1}`);
    if (statSync(target).size > MAX_ARTIFACT_BYTES) {
      throw externalReportError('artifact-too-large', `External gate artifact exceeds ${MAX_ARTIFACT_BYTES} bytes: ${artifactPath}`, {
        details: { location: { path: artifactPath } },
      });
    }
    if (containsSensitiveExternalData(readFileSync(target))) {
      throw externalReportSecurityError('sensitive-artifact-data', `External gate artifact contains sensitive data: ${artifactPath}`, {
        details: { location: { path: artifactPath } },
      });
    }
    return artifact;
  });
  const artifactPaths = artifacts.map(({ path: artifactPath }) => artifactPath.toLowerCase());
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw externalReportError('duplicate-artifacts', `External gate ${config.id} report contains duplicate artifact paths`);
  }
  if (artifactPaths.includes(config.report.path.toLowerCase())) {
    throw externalReportError('primary-report-repeated', `External gate ${config.id} artifacts must not repeat its primary report path`);
  }
  const diagnostics = processOutputDiagnostics(execution, {
    source: `external-gate:${config.id}`,
    root,
  });
  return createGateResult({
    gateId: config.id,
    status: report.status,
    summary: report.summary,
    findings,
    metrics: report.metrics,
    artifacts: [
      { path: config.report.path, type: 'repo-guard-json-v1', description: 'External gate report' },
      ...artifacts,
    ],
    durationMs: Date.now() - startedAt,
    diagnostics,
  });
}

function readPackage(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
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
    inspectSetup({ root, environment }) {
      if (!config.enabled) return { status: 'ready', summary: `${config.id} is disabled` };
      if (!config.environments.includes(environment)) {
        return { status: 'misconfigured', summary: `${config.id} does not support ${environment}` };
      }
      const command = readPackage(root).scripts?.[config.script];
      if (typeof command !== 'string' || !command.trim()) {
        throw configurationError('external-gate/missing-script', `External gate ${config.id} requires package.json script "${config.script}"`, {
          details: { location: { path: 'package.json' } },
        });
      }
      if (environment === 'release-ready') {
        assertReleaseScriptReadOnly(readPackage(root).scripts ?? {}, config.script);
      }
      assertSafeGeneratedPath(root, config.report.path, 'External gate report', { mustExist: false });
      return { status: 'ready', summary: `${config.id} uses npm script ${config.script}` };
    },
    plan: ({ root }) => ({
      enabled: config.enabled,
      reportPath: assertSafeGeneratedPath(root, config.report.path, 'External gate report', { mustExist: false }),
    }),
    async run({ root, signal, plan }) {
      if (!plan.enabled) return skippedResult(config.id, `${config.id} is disabled`);
      if (existsSync(plan.reportPath)) unlinkSync(plan.reportPath);
      const startedAt = Date.now();
      const execution = await runExactNpmScript({ root, script: config.script, signal });
      if (!existsSync(plan.reportPath)) throw externalReportError('report-not-generated', `External gate ${config.id} did not generate ${config.report.path}`, {
        details: { location: { path: config.report.path } },
      });
      const verifiedReportPath = assertSafeGeneratedPath(root, config.report.path, 'External gate report');
      const reportStat = statSync(verifiedReportPath);
      if (reportStat.mtimeMs < startedAt - 1000) throw externalReportError('stale-report', `External gate ${config.id} report is stale`, {
        details: { location: { path: config.report.path } },
      });
      return validateReport(config, readFileSync(verifiedReportPath, 'utf8'), root, startedAt, execution);
    },
  });
}

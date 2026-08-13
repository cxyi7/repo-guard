import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { skippedResult } from '../native-result.js';
import { runExactNpmScript, containsSensitiveExternalData } from '../../integrations/npm/external-script.js';
import { runGit } from '../../git.js';

const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

function assertSafeGeneratedPath(root, relative, label, { mustExist = true } = {}) {
  const target = path.resolve(root, relative);
  const reportsRoot = path.resolve(root, 'reports');
  if (target === reportsRoot || !target.startsWith(`${reportsRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside reports/`);
  }
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symbolic link: ${relative}`);
    }
  }
  if (mustExist && (!existsSync(target) || !lstatSync(target).isFile())) {
    throw new Error(`${label} was not generated as a regular file: ${relative}`);
  }
  const tracked = runGit(['ls-files', '--error-unmatch', '--', relative], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
  if (tracked) throw new Error(`${label} must not overwrite a tracked file: ${relative}`);
  return target;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function repositoryPath(value, label) {
  const normalized = nonEmpty(value, label).replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')) {
    throw new Error(`${label} must be repository-relative without parent traversal`);
  }
  return normalized.replace(/^\.\//, '');
}

function assertExactProperties(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown field(s): ${unknown.join(', ')}`);
}

function validateReport(config, raw, root, startedAt, execution) {
  if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) {
    throw new Error(`External gate report exceeded ${MAX_REPORT_BYTES} bytes`);
  }
  if (containsSensitiveExternalData(raw)) {
    throw new Error(`External gate ${config.id} report contains sensitive data`);
  }
  let report;
  try { report = JSON.parse(raw); } catch (error) {
    throw new Error(`External gate ${config.id} report is invalid JSON: ${error.message}`);
  }
  assertExactProperties(
    report,
    ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts'],
    `External gate ${config.id} report`,
  );
  for (const field of ['schemaVersion', 'gateId', 'status', 'summary', 'findings', 'metrics', 'artifacts']) {
    if (!Object.hasOwn(report, field)) throw new Error(`External gate ${config.id} report is missing ${field}`);
  }
  if (report.schemaVersion !== 1) throw new Error(`External gate ${config.id} requires report schemaVersion 1`);
  if (report.gateId !== config.id) throw new Error(`External gate report gateId must be ${config.id}`);
  if (!['passed', 'violation'].includes(report.status)) {
    throw new Error(`External gate ${config.id} report status must be passed or violation`);
  }
  const expectedExitCode = report.status === 'passed' ? 0 : 2;
  if (execution.status !== expectedExitCode) {
    throw new Error(
      `External gate ${config.id} report status ${report.status} requires script exit code `
      + `${expectedExitCode}; received ${String(execution.status)}`,
    );
  }
  nonEmpty(report.summary, `External gate ${config.id} report summary`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.artifacts)) {
    throw new Error(`External gate ${config.id} findings and artifacts must be arrays`);
  }
  if (report.artifacts.length > MAX_ARTIFACTS) {
    throw new Error(`External gate ${config.id} report exceeds ${MAX_ARTIFACTS} artifacts`);
  }
  if (!report.metrics || typeof report.metrics !== 'object' || Array.isArray(report.metrics)) {
    throw new Error(`External gate ${config.id} metrics must be an object`);
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
    throw new Error(`External gate ${config.id} passed report must not contain error findings`);
  }
  if (report.status === 'violation' && !hasErrorFinding) {
    throw new Error(`External gate ${config.id} violation report requires an error finding`);
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
      throw new Error(`External gate artifact exceeds ${MAX_ARTIFACT_BYTES} bytes: ${artifactPath}`);
    }
    if (containsSensitiveExternalData(readFileSync(target))) {
      throw new Error(`External gate artifact contains sensitive data: ${artifactPath}`);
    }
    return artifact;
  });
  const diagnostics = [];
  if (execution.stdout.trim()) diagnostics.push({ level: 'info', message: execution.stdout.trim() });
  if (execution.stderr.trim()) diagnostics.push({ level: 'error', message: execution.stderr.trim() });
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
        throw new Error(`External gate ${config.id} requires package.json script "${config.script}"`);
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
      if (!existsSync(plan.reportPath)) throw new Error(`External gate ${config.id} did not generate ${config.report.path}`);
      const verifiedReportPath = assertSafeGeneratedPath(root, config.report.path, 'External gate report');
      const reportStat = statSync(verifiedReportPath);
      if (reportStat.mtimeMs < startedAt - 1000) throw new Error(`External gate ${config.id} report is stale`);
      return validateReport(config, readFileSync(verifiedReportPath, 'utf8'), root, startedAt, execution);
    },
  });
}

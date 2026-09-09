import { loadWorkspace } from '../../config/configuration-loader.js';
import { DEFAULT_CI_CONFIG } from '../../config/defaults.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { runCiGate } from './runner.js';
import { runWorkspaceCi } from './workspace-runner.js';
import { writeCiReport } from './report.js';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { renderGateResultJson } from '../../core/report/json-renderer.js';
import { findRepositoryRoot } from '../../git/repository.js';
import path from 'node:path';

function errorReport(options, error, {
  gateId = 'ci.configuration',
  status = 'configuration-error',
} = {}) {
  const kind = status.slice(0, -6);
  const typedError = toRepoGuardError(error, { kind, code: `ci/${kind}-failed` });
  status = errorStatus(typedError);
  const gateResult = createGateResult({
    gateId,
    status,
    summary: typedError.message,
    error: typedError,
  });
  return {
    version: 1,
    status,
    profile: options.profile ?? null,
    base: options.base ?? null,
    head: options.head ?? null,
    steps: [],
    error: typedError.message,
    gateResult: renderGateResultJson(gateResult),
  };
}

function tryWriteErrorReport(root, preferredPath, report, forbiddenPaths = new Set()) {
  const candidates = [...new Set([
    preferredPath,
    DEFAULT_CI_CONFIG.reportPath,
  ].filter(Boolean))];
  for (const reportPath of candidates) {
    if (forbiddenPaths.has(path.resolve(root, reportPath).toLowerCase())) continue;
    try {
      writeCiReport(root, reportPath, report);
      return reportPath;
    } catch (error) {
      writeCommandError('ci.report', error, 'execution-error');
    }
  }
  return null;
}

function writeCommandError(gateId, error, status = 'configuration-error') {
  const kind = status.slice(0, -6);
  const typedError = toRepoGuardError(error, {
    kind,
    code: `ci/${kind}-failed`,
  });
  status = errorStatus(typedError);
  writeGateResultConsole(createGateResult({
    gateId,
    status,
    summary: typedError.message,
    error: typedError,
  }), { label: gateId });
}

export async function runCiCommand(cwd = process.cwd(), options = {}) {
  const root = findRepositoryRoot(cwd);
  let reportPath;
  try {
    reportPath = options.reportPath == null
      ? null
      : validateCiReportPath(options.reportPath, '--report-json');
  } catch (error) {
    tryWriteErrorReport(root, null, errorReport(options, error));
    writeCommandError('ci.configuration', error);
    return gateStatusToExitCode('configuration-error');
  }

  let workspace;
  try {
    workspace = loadWorkspace(root, { allowExpiredExceptions: true });
  } catch (error) {
    tryWriteErrorReport(root, reportPath, errorReport(options, error));
    writeCommandError('ci.configuration', error);
    return gateStatusToExitCode('configuration-error');
  }
  const config = workspace.repositoryConfig;
  const forbiddenReports = new Set([
    ...workspace.repositoryConfig.externalGates.map(({ report }) => path.resolve(root, report.path).toLowerCase()),
    ...workspace.projects.flatMap((project) => project.config.externalGates.map(({ report }) => (
      path.resolve(project.root, report.path).toLowerCase()
    ))),
    ...(workspace.document.projects ? [
      path.resolve(root, 'reports/repo-guard-workspace/repository.json').toLowerCase(),
      path.resolve(root, 'reports/repo-guard-workspace/evidence.json').toLowerCase(),
      ...workspace.projects.map((project) => path.resolve(project.root, `reports/repo-guard-workspace/projects/${project.id}.json`).toLowerCase()),
    ] : []),
  ]);
  try {
    if (workspace.document.projects) {
      return await runWorkspaceCi({ workspace, options: { ...options, ...(reportPath ? { reportPath } : {}) } });
    }
    if (options.projectId !== undefined && options.projectId !== config.project.id) {
      throw configurationError('project/not-found', `未配置项目：${options.projectId}。`);
    }
    return await runCiGate({ root, config, ...options });
  } catch (error) {
    tryWriteErrorReport(
      root,
      reportPath ?? config.ci.reportPath,
      errorReport(options, error, {
        gateId: 'ci.execution',
        status: 'execution-error',
      }),
      forbiddenReports,
    );
    writeCommandError('ci.execution', error, 'execution-error');
    return gateStatusToExitCode(errorStatus(error));
  }
}

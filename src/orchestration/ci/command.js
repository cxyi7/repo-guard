import { prepareCiNotification, notifyCiOutcome, testCiNotification } from './notification.js';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { DEFAULT_CI_CONFIG } from '../../config/defaults.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { runCiGate } from './runner.js';
import { runWorkspaceCi } from './workspace-runner.js';
import { CI_REPORT_VERSION, writeCiReport } from './report.js';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { renderGateResultJson } from '../../core/report/json-renderer.js';
import { findRepositoryRoot } from '../../git/repository.js';
import path from 'node:path';
import { selectProjects, projectAffected } from '../workspace/targets.js';
import { resolveCiRange } from './change-range.js';
import { assertCiConfiguration } from './subject.js';
import { CI_NOTIFICATION_TEST_REPORT } from '../../config/ci-notification.js';

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
    version: CI_REPORT_VERSION,
    status,
    phase: options.phase ?? 'ci',
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

async function executeCiCommand(cwd = process.cwd(), options = {}) {
  const root = findRepositoryRoot(cwd);
  let reportPath;
  try {
    if (Object.hasOwn(options, 'profile')) throw configurationError('ci/removed-profile', 'CI 已取消档位，请移除 profile 并按项目配置执行');
    reportPath = options.reportPath == null
      ? null
      : validateCiReportPath(options.reportPath, '--report-json');
    if (reportPath?.toLowerCase() === CI_NOTIFICATION_TEST_REPORT) throw configurationError('ci/report-path-collision', 'CI 汇总报告不得使用通知测试保留路径');
  } catch (error) {
    const report = errorReport(options, error);
    options.onReport?.(report);
    tryWriteErrorReport(root, null, report);
    writeCommandError('ci.configuration', error);
    return gateStatusToExitCode('configuration-error');
  }

  let workspace;
  try {
    workspace = loadWorkspace(root, { allowExpiredExceptions: true, lazyProjects: true });
    const range = workspace.document.projects ? resolveCiRange(root, options) : null;
    if (range) options = { ...options, resolvedRange: range };
  } catch (error) {
    const report = errorReport(options, error, { status: errorStatus(error) });
    options.onReport?.(report);
    tryWriteErrorReport(root, null, report);
    writeCommandError('ci.configuration', error, errorStatus(error));
    return gateStatusToExitCode(errorStatus(error));
  }
  const config = workspace.repositoryConfig;
  const forbiddenReports = new Set([
    ...workspace.repositoryConfig.ci.externalGates.map(({ report }) => path.resolve(root, report.path).toLowerCase()),
    ...(workspace.document.projects ? [
      path.resolve(root, 'reports/repo-guard-workspace/repository.json').toLowerCase(),
      path.resolve(root, 'reports/repo-guard-workspace/evidence.json').toLowerCase(),
      ...workspace.projects.map((project) => path.resolve(project.root, `reports/repo-guard-workspace/projects/${project.id}.json`).toLowerCase()),
    ] : []),
  ]);
  try {
    const selected = selectProjects(workspace, options.projectId).filter((project) => !options.resolvedRange
      || options.projectId !== undefined || options.phase === 'delivery-check'
      || projectAffected(workspace, project, options.resolvedRange.changes));
    for (const project of selected) {
      for (const { report } of project.config.ci.externalGates) {
        forbiddenReports.add(path.resolve(project.root, report.path).toLowerCase());
      }
    }
    if (config.ci.enabled) assertCiConfiguration(root, [workspace.configPath, ...selected.map((project) => project.configPath)]);
    if (workspace.document.projects) {
      return await runWorkspaceCi({ workspace, options: { ...options, ...(reportPath ? { reportPath } : {}) } });
    }
    if (options.projectId !== undefined && options.projectId !== config.project.id) {
      throw configurationError('project/not-found', `未配置项目：${options.projectId}。`);
    }
    return await runCiGate({ root, config, ...options });
  } catch (error) {
    const report = errorReport(options, error, { gateId: 'ci.execution', status: errorStatus(error) });
    options.onReport?.(report);
    tryWriteErrorReport(
      root,
      reportPath ?? config.ci.reportPath,
      errorReport(options, error, {
        gateId: 'ci.execution',
        status: errorStatus(error),
      }),
      forbiddenReports,
    );
    writeCommandError('ci.execution', error, 'execution-error');
    return gateStatusToExitCode(errorStatus(error));
  }
}

/** 通知只在命令边界发送一次，多应用仍保留各自报告。 */
export async function runCiCommand(cwd = process.cwd(), options = {}) {
  const root = findRepositoryRoot(cwd);
  const notification = prepareCiNotification(root);
  if (notification) {
    try { await testCiNotification(root, notification); }
    catch { writeCommandError('ci.notification', configurationError('ci/notification-test-failed', '通知接入测试未完成，继续执行质量检查')); }
  }
  let report;
  const exitCode = await executeCiCommand(cwd, { ...options, onReport: (value) => {
    report = value;
    options.onReport?.(value);
  } });
  if (notification) {
    try { await notifyCiOutcome(root, notification, exitCode, report); }
    catch { writeCommandError('ci.notification', configurationError('ci/notification-failed', 'CI 通知未能完成，请运行通知测试检查配置；质量结果保持不变')); }
  }
  return exitCode;
}

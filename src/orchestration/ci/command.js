import { loadConfig } from '../../config/configuration-loader.js';
import { DEFAULT_CI_CONFIG } from '../../config/defaults.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { runCiGate } from './runner.js';
import { writeCiReport } from './report.js';
import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { renderGateResultJson } from '../../core/report/json-renderer.js';
import { findRepositoryRoot } from '../../git/repository.js';

function errorReport(options, error, {
  gateId = 'ci.configuration',
  status = 'configuration-error',
} = {}) {
  const kind = status.slice(0, -6);
  const typedError = toRepoGuardError(error, { kind, code: `ci/${kind}-failed` });
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

function tryWriteErrorReport(root, preferredPath, report) {
  const candidates = [...new Set([
    preferredPath,
    DEFAULT_CI_CONFIG.reportPath,
  ].filter(Boolean))];
  for (const reportPath of candidates) {
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

  let config;
  try {
    config = loadConfig(root, { allowExpiredExceptions: true });
  } catch (error) {
    tryWriteErrorReport(root, reportPath, errorReport(options, error));
    writeCommandError('ci.configuration', error);
    return gateStatusToExitCode('configuration-error');
  }
  try {
    return await runCiGate({ root, config, ...options });
  } catch (error) {
    tryWriteErrorReport(
      root,
      reportPath ?? config.ci.reportPath,
      errorReport(options, error, {
        gateId: 'ci.execution',
        status: 'execution-error',
      }),
    );
    writeCommandError('ci.execution', error, 'execution-error');
    return gateStatusToExitCode('execution-error');
  }
}

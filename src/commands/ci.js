import {
  DEFAULT_CI_CONFIG,
  loadConfig,
  validateCiReportPath,
} from '../config.js';
import { runCiGate, writeCiReport } from '../ci-runner.js';
import { findRepositoryRoot } from '../git.js';

function errorReport(options, error) {
  return {
    version: 1,
    status: 'configuration-error',
    profile: options.profile ?? null,
    base: options.base ?? null,
    head: options.head ?? null,
    steps: [],
    error: error.message,
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
      console.error(`repo-guard could not write CI report ${reportPath}: ${error.message}`);
    }
  }
  return null;
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
    console.error(`repo-guard CI configuration failed: ${error.message}`);
    return 1;
  }

  let config;
  try {
    config = loadConfig(root, { allowExpiredExceptions: true });
  } catch (error) {
    tryWriteErrorReport(root, reportPath, errorReport(options, error));
    console.error(`repo-guard CI configuration failed: ${error.message}`);
    return 1;
  }
  try {
    return await runCiGate({ root, config, ...options });
  } catch (error) {
    tryWriteErrorReport(
      root,
      reportPath ?? config.ci.reportPath,
      { ...errorReport(options, error), status: 'execution-error' },
    );
    console.error(`repo-guard CI execution failed: ${error.message}`);
    return 1;
  }
}

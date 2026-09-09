import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { runGit } from '../../git/execution.js';

export const CI_REPORT_VERSION = 2;

function assertGateResultVersion(result) {
  if (result?.schemaVersion !== 2) {
    throw configurationError(
      'ci-report/unsupported-gate-result-version',
      'CI 报告中的 GateResult 仅支持 schemaVersion: 2，请重新运行 CI 生成当前格式报告。',
    );
  }
}

export function assertCiReportVersion(report) {
  if (report?.version !== CI_REPORT_VERSION) {
    throw configurationError(
      'ci-report/unsupported-version',
      'CI 报告仅支持 version: 2，请重新运行 CI 生成当前格式报告。',
    );
  }
  if (Object.hasOwn(report, 'gateResult')) assertGateResultVersion(report.gateResult);
  for (const step of report.steps ?? []) {
    if (Object.hasOwn(step, 'gateResult')) assertGateResultVersion(step.gateResult);
  }
  if (Object.hasOwn(report, 'gateResults')) {
    if (!Array.isArray(report.gateResults)) {
      throw configurationError(
        'ci-report/invalid-gate-results',
        'CI 报告的 gateResults 必须是 schemaVersion: 2 的 GateResult 数组。',
      );
    }
    for (const result of report.gateResults) assertGateResultVersion(result);
  }
  for (const target of report.targets ?? []) assertCiReportVersion(target.report);
}

function assertNoSymlinkPath(root, reportPath) {
  let current = root;
  for (const segment of reportPath.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw securityError('ci-report/symlink-traversal', `CI 报告路径不得穿过符号链接： ${reportPath}`, {
        details: { location: { path: reportPath } },
        expected: 'CI 报告路径的每个现有目录都是真实目录而非符号链接。',
      });
    }
  }
}

export function writeCiReport(root, reportPath, report) {
  assertCiReportVersion(report);
  const normalized = validateCiReportPath(reportPath);
  assertNoSymlinkPath(root, normalized);
  const tracked = runGit(['ls-files', '--error-unmatch', '--', normalized], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
  if (tracked) throw securityError('ci-report/tracked-file-overwrite', `CI 报告路径不得覆盖已跟踪文件： ${normalized}`, {
    details: { location: { path: normalized } },
    expected: 'CI 报告仅写入未跟踪的 reports/ 生成文件。',
  });
  const target = path.resolve(root, normalized);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

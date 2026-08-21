import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  configurationError,
  executionError,
  securityError,
} from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';

function relativePath(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function reportSecurityError(code, message, reportPath) {
  return securityError(`api-performance/${code}`, message, {
    details: { location: { path: reportPath } },
    expected: '接口性能报告只能写入未跟踪、已忽略且不穿过符号链接的 reports/ 路径。',
    remediation: {
      goal: '为接口性能测试配置安全的生成报告目录。',
      steps: ['将报告目录加入 .gitignore，并移除已被 Git 跟踪的报告文件。'],
      constraints: ['不得覆盖已跟踪文件或通过符号链接写出仓库。'],
      verification: [`运行 git check-ignore ${reportPath} 确认报告已被忽略。`],
    },
  });
}

function assertNoSymbolicLinks(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      const unsafePath = relativePath(root, current);
      throw reportSecurityError(
        'symlink-report-path',
        `接口性能报告路径不得穿过符号链接：${unsafePath}`,
        unsafePath,
      );
    }
  }
}

function assertGeneratedReportPath(root, target) {
  const relative = relativePath(root, target);
  const reportsRoot = path.resolve(root, 'reports');
  if (!target.startsWith(`${reportsRoot}${path.sep}`)) {
    throw reportSecurityError(
      'report-path-escape',
      `接口性能报告必须位于 reports/ 内：${relative}`,
      relative,
    );
  }
  assertNoSymbolicLinks(root, target);
  const tracked = runGit(
    ['ls-files', '--error-unmatch', '--', relative],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (tracked) {
    throw reportSecurityError(
      'tracked-report-overwrite',
      `接口性能测试不得覆盖已被 Git 跟踪的报告：${relative}`,
      relative,
    );
  }
  const ignored = runGit(
    ['check-ignore', '-q', '--', relative],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (!ignored) {
    throw reportSecurityError(
      'report-not-ignored',
      `接口性能报告必须被 .gitignore 忽略：${relative}`,
      relative,
    );
  }
}

function removeIfPresent(target) {
  if (existsSync(target)) unlinkSync(target);
}

export function prepareApiPerformanceReports(root, primaryReportPath) {
  const primary = path.resolve(root, primaryReportPath);
  if (path.extname(primary).toLowerCase() !== '.json') {
    throw configurationError(
      'api-performance/invalid-primary-report-extension',
      '接口性能外部门禁主报告路径必须以 .json 结尾',
      { details: { location: { path: primaryReportPath } } },
    );
  }
  const directory = path.dirname(primary);
  const html = path.join(directory, 'axios-report.html');
  const temporaryPrimary = `${primary}.tmp`;
  for (const target of [primary, html, temporaryPrimary]) {
    assertGeneratedReportPath(root, target);
    removeIfPresent(target);
  }
  mkdirSync(directory, { recursive: true });
  return Object.freeze({
    primary,
    html,
    temporaryPrimary,
    primaryRelative: relativePath(root, primary),
    htmlRelative: relativePath(root, html),
  });
}

export function writeApiPerformanceReports(reports, externalReport, html) {
  try {
    writeFileSync(reports.html, html, 'utf8');
    writeFileSync(reports.temporaryPrimary, `${JSON.stringify(externalReport, null, 2)}\n`, 'utf8');
    renameSync(reports.temporaryPrimary, reports.primary);
  } catch (error) {
    throw executionError(
      'api-performance/report-write-failed',
      '无法写入接口性能外部门禁 JSON 或中文 HTML 报告',
      { cause: error, details: { location: { path: reports.primaryRelative } } },
    );
  }
}

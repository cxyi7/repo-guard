import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  configurationError,
  executionError,
  securityError,
} from '../../core/error/repo-guard-error.js';
import { containsSensitiveExternalData } from '../npm/external-script.js';
import { runGit } from '../../git/execution.js';

const MAX_RAW_SUMMARY_BYTES = 5 * 1024 * 1024;

function relativePath(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function reportSecurityError(code, message, reportPath) {
  return securityError(`k6-load/${code}`, message, {
    details: { location: { path: reportPath } },
    expected: 'k6 报告和临时入口只能写入未跟踪、已忽略且不穿过符号链接的 reports/ 路径。',
    remediation: {
      goal: '为 k6 压测配置安全的生成报告目录。',
      steps: ['将报告目录加入 .gitignore，并移除已被 Git 跟踪的报告文件。'],
      constraints: ['不得覆盖已跟踪文件、包含敏感信息或通过符号链接写出仓库。'],
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
        `k6 报告路径不得穿过符号链接：${unsafePath}`,
        unsafePath,
      );
    }
  }
}

function assertGeneratedPath(root, target) {
  const relative = relativePath(root, target);
  const reportsRoot = path.resolve(root, 'reports');
  if (!target.startsWith(`${reportsRoot}${path.sep}`)) {
    throw reportSecurityError('report-path-escape', `k6 生成文件必须位于 reports/ 内：${relative}`, relative);
  }
  assertNoSymbolicLinks(root, target);
  const tracked = runGit(
    ['ls-files', '--error-unmatch', '--', relative],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (tracked) {
    throw reportSecurityError(
      'tracked-report-overwrite',
      `k6 压测不得覆盖已被 Git 跟踪的文件：${relative}`,
      relative,
    );
  }
  const ignored = runGit(
    ['check-ignore', '-q', '--', relative],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (!ignored) {
    throw reportSecurityError('report-not-ignored', `k6 生成文件必须被 .gitignore 忽略：${relative}`, relative);
  }
}

function removeIfPresent(target) {
  if (existsSync(target)) unlinkSync(target);
}

export function prepareK6ReportFiles(root, primaryReportPath) {
  const primary = path.resolve(root, primaryReportPath);
  if (path.extname(primary).toLowerCase() !== '.json') {
    throw configurationError(
      'k6-load/invalid-primary-report-extension',
      'k6 外部门禁主报告路径必须以 .json 结尾',
      { details: { location: { path: primaryReportPath } } },
    );
  }
  const directory = path.dirname(primary);
  const raw = path.join(directory, 'k6-summary.json');
  const html = path.join(directory, 'k6-report.html');
  const wrapper = path.join(directory, '.repo-guard-k6-entry.js');
  const temporaryPrimary = `${primary}.tmp`;
  if (primary === raw) {
    throw configurationError(
      'k6-load/reserved-primary-report-name',
      'k6 外部门禁主报告不得使用保留名称 k6-summary.json',
      { details: { location: { path: primaryReportPath } } },
    );
  }
  for (const target of [primary, raw, html, wrapper, temporaryPrimary]) {
    assertGeneratedPath(root, target);
    removeIfPresent(target);
  }
  mkdirSync(directory, { recursive: true });
  return Object.freeze({
    primary,
    raw,
    html,
    wrapper,
    temporaryPrimary,
    primaryRelative: relativePath(root, primary),
    rawRelative: relativePath(root, raw),
    htmlRelative: relativePath(root, html),
    wrapperRelative: relativePath(root, wrapper),
  });
}

function wrapperImportPath(reports, scriptTarget) {
  const relative = path.relative(path.dirname(reports.wrapper), scriptTarget).replaceAll('\\', '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function writeK6ControlledEntry(reports, configuration, options) {
  const importPath = wrapperImportPath(reports, configuration.script.target);
  const source = `import scenario, * as consumer from ${JSON.stringify(importPath)};

export const options = ${JSON.stringify(options, null, 2)};

export function setup() {
  return typeof consumer.setup === 'function' ? consumer.setup() : null;
}

export default function repoGuardK6Scenario(data) {
  return scenario(data);
}

export function teardown(data) {
  if (typeof consumer.teardown === 'function') return consumer.teardown(data);
}

export function handleSummary(data) {
  return { ${JSON.stringify(reports.rawRelative)}: JSON.stringify(data) };
}
`;
  try {
    writeFileSync(reports.wrapper, source, 'utf8');
  } catch (error) {
    throw executionError(
      'k6-load/wrapper-write-failed',
      '无法写入 repo-guard 受控 k6 临时入口',
      { cause: error, details: { location: { path: reports.wrapperRelative } } },
    );
  }
}

export function removeK6ControlledEntry(reports) {
  removeIfPresent(reports.wrapper);
}

export function readK6RawSummary(reports) {
  if (!existsSync(reports.raw) || !lstatSync(reports.raw).isFile()) {
    throw executionError(
      'k6-load/missing-summary',
      'k6 未生成本次压测的机器摘要',
      { details: { location: { path: reports.rawRelative } } },
    );
  }
  if (statSync(reports.raw).size > MAX_RAW_SUMMARY_BYTES) {
    throw executionError(
      'k6-load/summary-too-large',
      `k6 机器摘要不得超过 ${MAX_RAW_SUMMARY_BYTES} 字节`,
      { details: { location: { path: reports.rawRelative } } },
    );
  }
  const raw = readFileSync(reports.raw, 'utf8');
  if (containsSensitiveExternalData(raw)) {
    throw reportSecurityError(
      'sensitive-summary-data',
      'k6 机器摘要包含疑似凭据或敏感信息',
      reports.rawRelative,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw executionError(
      'k6-load/invalid-summary-json',
      'k6 机器摘要不是有效 JSON',
      { cause: error, details: { location: { path: reports.rawRelative } } },
    );
  }
}

export function writeK6FinalReports(reports, externalReport, html) {
  try {
    writeFileSync(reports.html, html, 'utf8');
    writeFileSync(reports.temporaryPrimary, `${JSON.stringify(externalReport, null, 2)}\n`, 'utf8');
    renameSync(reports.temporaryPrimary, reports.primary);
  } catch (error) {
    throw executionError(
      'k6-load/report-write-failed',
      '无法写入 k6 外部门禁 JSON 或中文 HTML 报告',
      { cause: error, details: { location: { path: reports.primaryRelative } } },
    );
  }
}

import {
  existsSync,
  lstatSync,
  mkdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurationError, executionError, securityError } from '../../core/error/repo-guard-error.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { runGit } from '../../git/execution.js';

const RUNNER_PATH = fileURLToPath(new URL('./runner-child.js', import.meta.url));
const REPORT_FILES = Object.freeze({
  json: 'mutation.json',
  chineseHtml: 'mutation.html',
  originalHtml: 'mutation-original.html',
});

function relativePath(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function assertNoSymbolicLinks(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw securityError(
        'mutation-test/symlink-report-path',
        `变异测试报告路径不得穿过符号链接：${relativePath(root, current)}`,
      );
    }
  }
}

function assertNotTracked(root, target) {
  const relative = relativePath(root, target);
  const tracked = runGit(
    ['ls-files', '--error-unmatch', '--', relative],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (tracked) {
    throw securityError(
      'mutation-test/tracked-report-overwrite',
      `变异测试不得覆盖已被 Git 跟踪的报告：${relative}`,
    );
  }
}

export function resolveMutationTestSetup(root, config) {
  const metadata = resolveProjectPackageMetadata(
    root,
    '@stryker-mutator/core',
    'Stryker 变异测试工具',
  );
  const major = Number.parseInt(String(metadata.version).split('.')[0], 10);
  if (major !== 10) {
    throw configurationError(
      'mutation-test/unsupported-stryker-version',
      `当前仅支持 @stryker-mutator/core 10.x，检测到 ${metadata.version}`,
    );
  }
  const configPath = path.resolve(root, config.configFile);
  if (!existsSync(configPath) || !lstatSync(configPath).isFile()) {
    throw configurationError(
      'mutation-test/missing-config-file',
      `找不到变异测试配置文件：${config.configFile}`,
      { details: { location: { path: config.configFile } } },
    );
  }
  const ignoredProbe = `${config.reportsDirectory}/mutation.json`;
  const ignored = runGit(
    ['check-ignore', '-q', '--', ignoredProbe],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (!ignored) {
    throw configurationError(
      'mutation-test/report-directory-not-ignored',
      `变异测试报告目录必须被 .gitignore 忽略：${config.reportsDirectory}/`,
      {
        details: { location: { path: '.gitignore' } },
        remediation: {
          goal: '防止包含生产源码的变异测试报告进入版本库。',
          steps: ['运行 repo-guard init 同步受管忽略规则。'],
          constraints: ['不得提交 mutation.json、中文报告或 Stryker 原始 HTML 报告。'],
          verification: [`运行 git check-ignore ${ignoredProbe}。`],
        },
      },
    );
  }
  return Object.freeze({
    configPath,
    entryPath: metadata.entryPath,
    runnerPath: RUNNER_PATH,
    version: metadata.version,
  });
}

export function prepareMutationReportFiles(root, config) {
  const directory = path.resolve(root, config.reportsDirectory);
  const paths = Object.freeze(Object.fromEntries(
    Object.entries(REPORT_FILES).map(([name, file]) => [name, path.join(directory, file)]),
  ));
  assertNoSymbolicLinks(root, directory);
  for (const target of Object.values(paths)) {
    assertNoSymbolicLinks(root, target);
    assertNotTracked(root, target);
    if (existsSync(target)) unlinkSync(target);
  }
  mkdirSync(directory, { recursive: true });
  return Object.freeze({ directory, ...paths });
}

export function assertFreshMutationReport(root, target, startedAt, reportName = 'JSON') {
  const relative = relativePath(root, target);
  if (!existsSync(target) || !lstatSync(target).isFile()) {
    throw executionError(
      'mutation-test/missing-json-report',
      `Stryker 未生成本次变异测试${reportName}报告：${relative}`,
      { details: { location: { path: relative } } },
    );
  }
  if (statSync(target).mtimeMs < startedAt - 1000) {
    throw executionError(
      'mutation-test/stale-json-report',
      `Stryker 生成的变异测试${reportName}报告不是本次执行的新报告：${relative}`,
      { details: { location: { path: relative } } },
    );
  }
}

export function mutationReportArtifacts(root, paths, originalHtml) {
  return [
    { path: relativePath(root, paths.json), type: 'mutation-report-json', description: 'Stryker 原始 JSON 报告' },
    { path: relativePath(root, paths.chineseHtml), type: 'mutation-report-html', description: '中文变异测试报告' },
    ...(originalHtml ? [{
      path: relativePath(root, paths.originalHtml),
      type: 'mutation-report-original-html',
      description: 'Stryker 原始交互报告',
    }] : []),
  ];
}

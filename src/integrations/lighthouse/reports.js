import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import { resolveBuildArtifactOutput } from '../build-artifacts/project.js';
import { inspectPageImages } from './image-audits.js';
import { observationFindings } from './image-observations.js';

function reportUrl(value) {
  try {
    return new URL(value).href;
  } catch (error) {
    throw executionError(
      'lighthouse/invalid-report-url',
      'Lighthouse 报告中的页面地址无效。',
      { cause: error },
    );
  }
}

/** 仅接受本轮页面报告，防止旧报告、登录跳转或空白页冒充业务页面成功。 */
export function inspectLighthouseReports(
  root,
  config,
  effective,
  startedAt,
  buildEvidence,
  observationsFile,
) {
  const observations = observationsFile && existsSync(observationsFile) ? JSON.parse(readFileSync(observationsFile, 'utf8')) : {};
  if (config.imageUsage?.enabled && (!observationsFile || config.pages.some((page) => !Array.isArray(observations[reportUrl(page.url)])))) throw executionError('lighthouse/image-observations-missing', '本轮未完成配置页面的图片观察，请重新运行浏览器检查');
  const relative = '.lighthouseci';
  const directory = resolveBuildArtifactOutput(root, {
    outputDirectory: relative,
  }).outputDirectory;
  if (!existsSync(directory))
    throw executionError(
      'lighthouse/missing-report',
      'Lighthouse 没有生成本轮页面报告。',
    );
  const reports = readdirSync(directory)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => {
      const file = path.join(directory, name);
      if (
        lstatSync(file).isSymbolicLink() ||
        lstatSync(file).mtimeMs < startedAt - 1000
      )
        throw executionError(
          'lighthouse/stale-report',
          'Lighthouse 报告不是本轮产生的普通文件。',
        );
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        throw executionError(
          'lighthouse/invalid-report-json',
          'Lighthouse 报告不是有效 JSON。',
          { cause: error },
        );
      }
    });
  const urls = effective.ci.collect.url;
  const runs = effective.ci.collect.numberOfRuns ?? 3;
  for (const url of urls) {
    const selected = reports.filter(
      (report) => reportUrl(report?.requestedUrl) === reportUrl(url),
    );
    if (selected.length !== runs)
      throw executionError(
        'lighthouse/incomplete-report',
        `Lighthouse 页面 ${url} 的本轮报告数量与配置不一致。`,
      );
    const target = config.pages?.find((page) => reportUrl(page.url) === reportUrl(url));
    for (const report of selected) {
      if (
        report.runtimeError ||
        (target &&
          reportUrl(report.finalDisplayedUrl ?? report.finalUrl) !==
            reportUrl(target.expectedUrl))
      ) {
        throw executionError(
          'lighthouse/wrong-page-report',
          'Lighthouse 检测到了运行错误或非目标业务页面。',
        );
      }
    }
  }
  if (reports.length !== urls.length * runs)
    throw executionError(
      'lighthouse/unexpected-report',
      'Lighthouse 本轮包含配置之外的页面报告。',
    );
  const summary = {
    version: 2,
    buildEvidence,
    description: '页面性能与实际加载资源报告；实验室数据不替代线上用户指标。',
    environment: {
      node: process.version,
      settings: structuredClone(effective.ci.collect.settings ?? {}),
    },
    pages: reports.map((report) => ({
      url: report.requestedUrl,
      lighthouseVersion: report.lighthouseVersion,
      userAgent: report.userAgent,
      performance: report.categories?.performance?.score,
      imageFindings: [...inspectPageImages(report, config.imageUsage), ...(config.imageUsage?.enabled ? observationFindings(observations[reportUrl(report.requestedUrl)] ?? [], config.imageUsage) : [])],
      resources: (
        report.audits?.['network-requests']?.details?.items ?? []
      ).map((item) => ({
        url: item.url,
        resourceType: item.resourceType,
        transferSize: item.transferSize,
        resourceSize: item.resourceSize,
      })),
      metrics: Object.fromEntries(
        [
          'first-contentful-paint',
          'largest-contentful-paint',
          'total-blocking-time',
          'cumulative-layout-shift',
        ].map((name) => [name, report.audits?.[name]?.numericValue ?? null]),
      ),
    })),
  };
  // 配置中可能有认证 headers，摘要不保存它们。
  delete summary.environment.settings.extraHeaders;
  const target = `${relative}/repo-guard-summary.json`;
  resolveBuildArtifactOutput(root, { outputDirectory: target });
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return {
    path: target,
    type: 'lighthouse-summary',
    description: '页面性能、运行环境与实际加载包体积中文摘要',
    imageFindings: summary.pages.flatMap((page) => page.imageFindings),
  };
}

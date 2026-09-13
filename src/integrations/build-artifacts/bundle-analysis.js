import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  executionError,
  configurationError,
} from '../../core/error/repo-guard-error.js';
import { resolveBuildArtifactOutput } from './project.js';

function readReport(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw executionError(
      'bundle/invalid-json',
      '包体积报告不是可读取的有效 JSON。',
      { cause: error },
    );
  }
}

export function bundleReportPaths(root, build) {
  const config = build.bundleAnalysis;
  const directory = resolveBuildArtifactOutput(root, {
    outputDirectory: config.reportsDirectory,
  }).outputDirectory;
  const output =
    build.artifactBudget?.outputDirectory &&
    path.resolve(root, build.artifactBudget.outputDirectory);
  if (
    output &&
    (directory === output ||
      directory.startsWith(`${output}${path.sep}`) ||
      output.startsWith(`${directory}${path.sep}`))
  ) {
    throw configurationError(
      'bundle/report-overlaps-output',
      '包体积报告目录不得与部署产物目录重叠。',
    );
  }
  return {
    directory,
    json: path.join(directory, 'bundle.json'),
    html: path.join(directory, 'bundle.html'),
    facts: path.join(directory, 'modules.json'),
    summary: path.join(directory, 'summary.json'),
  };
}

export function prepareBundleReports(root, build) {
  if (!build.bundleAnalysis?.enabled) return;
  const paths = bundleReportPaths(root, build);
  let previous = null;
  for (const name of ['json', 'html', 'facts', 'summary']) {
    // 对文件本身也校验链接和 Git 跟踪，不能仅检查父目录。
    resolveBuildArtifactOutput(root, {
      outputDirectory: path.relative(root, paths[name]).replaceAll('\\', '/'),
    });
    if (name === 'summary' && existsSync(paths[name])) {
      try {
        previous = JSON.parse(readFileSync(paths[name], 'utf8'));
      } catch {
        throw executionError(
          'bundle/invalid-previous-summary',
          '上次包体积摘要不是有效 JSON，请检查报告文件。',
        );
      }
      if (previous?.version !== 1)
        throw executionError(
          'bundle/invalid-previous-summary',
          '上次包体积摘要版本不受支持，请检查报告文件。',
        );
    }
    if (existsSync(paths[name])) unlinkSync(paths[name]);
  }
  mkdirSync(paths.directory, { recursive: true });
  return previous;
}

export function inspectBundleReports(root, build, runId, previous = null) {
  if (!build.bundleAnalysis?.enabled) return { artifacts: [], summary: null };
  const paths = bundleReportPaths(root, build);
  for (const name of [...build.bundleAnalysis.formats, 'facts']) {
    resolveBuildArtifactOutput(root, {
      outputDirectory: path.relative(root, paths[name]).replaceAll('\\', '/'),
    });
    if (!existsSync(paths[name]) || readFileSync(paths[name]).length === 0)
      throw executionError(
        'bundle/missing-report',
        `本次构建没有生成包体积报告：${name}；请接入 repo-guard Vite 插件。`,
      );
  }
  const raw = readReport(paths.json);
  const facts = readReport(paths.facts);
  if (
    !raw ||
    typeof raw !== 'object' ||
    !raw.tree ||
    !facts ||
    facts.version !== 1 ||
    facts.runId !== runId ||
    !Array.isArray(facts.chunks) ||
    facts.chunks.length === 0
  ) {
    throw executionError(
      'bundle/invalid-report',
      '包体积报告格式无效或不属于本次构建。',
    );
  }
  if (
    facts.chunks.some(
      (chunk) =>
        !chunk ||
        typeof chunk.file !== 'string' ||
        !Array.isArray(chunk.modules),
    )
  ) {
    throw executionError(
      'bundle/invalid-chunk',
      '包体积报告包含无效产物模块清单。',
    );
  }
  const modules = facts.chunks.flatMap((chunk) => chunk.modules);
  const packages = new Map();
  const counts = new Map();
  for (const item of modules) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !Number.isFinite(item.bytes) ||
      item.bytes < 0
    )
      throw executionError('bundle/invalid-module', '包体积报告包含无效模块。');
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    const normalized = `/${item.id.replaceAll('\\', '/')}`;
    const suffix = normalized.split('/node_modules/').at(-1);
    if (suffix !== normalized) {
      const name = suffix.startsWith('@')
        ? suffix.split('/').slice(0, 2).join('/')
        : suffix.split('/')[0];
      packages.set(name, (packages.get(name) ?? 0) + item.bytes);
    }
  }
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const configuration = createHash('sha256')
    .update(JSON.stringify(build))
    .digest('hex');
  const summary = {
    version: 1,
    runId,
    configuration,
    description: '模块体积用于定位来源，实际产物体积以构建预算为准。',
    largestPackages: [...packages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20),
    largestModules: [...modules].sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    repeatedModules: duplicates,
    chunks: facts.chunks.map(({ modules: entries, ...chunk }) => ({
      ...chunk,
      moduleCount: entries.length,
    })),
  };
  summary.comparison =
    previous?.configuration === configuration &&
    Array.isArray(previous.largestPackages)
      ? {
          previousRunId: previous.runId,
          description:
            '与同配置上次分析的主要依赖体积比较，仅用于定位变化，不作为放宽预算的依据。',
          packages: summary.largestPackages.map(({ name, bytes }) => ({
            name,
            bytes,
            previousBytes:
              previous.largestPackages.find((entry) => entry.name === name)
                ?.bytes ?? null,
          })),
        }
      : {
          description: '缺少同配置的上次报告，本轮不计算历史差异。',
          packages: [],
        };
  resolveBuildArtifactOutput(root, {
    outputDirectory: path.relative(root, paths.summary).replaceAll('\\', '/'),
  });
  writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    summary,
    artifacts: [...build.bundleAnalysis.formats, 'facts', 'summary'].map(
      (name) => ({
        path: path.relative(root, paths[name]).replaceAll('\\', '/'),
        type: `bundle-${name}`,
        description: '本次构建包体积分析报告',
      }),
    ),
  };
}

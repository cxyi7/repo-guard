import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeProjectDocument } from '../../config/project-configuration.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { bundleReportPaths, prepareBundleReports } from './bundle-analysis.js';

/** 接入者在项目 Vite 配置中调用；原生 build 字段优先，所有路径来自应用配置。 */
export async function createFrontendBuildPlugins({
  root = process.cwd(),
  configFile = 'repo-guard.config.json',
} = {}) {
  const context = process.env.REPO_GUARD_BUILD_CONTEXT
    ? JSON.parse(process.env.REPO_GUARD_BUILD_CONTEXT)
    : null;
  if (context && path.resolve(context.root) !== path.resolve(root))
    throw configurationError(
      'bundle/wrong-application',
      '包体积插件应用目录与当前构建不一致。',
    );
  const build =
    context?.config ??
    normalizeProjectDocument(
      JSON.parse(readFileSync(path.resolve(root, configFile), 'utf8')),
    ).checks.build;
  const defined = (value) =>
    Object.fromEntries(
      Object.entries(value ?? {}).filter(([, item]) => item !== undefined),
    );
  const defaults = {
    name: 'repo-guard-production-defaults',
    config(user) {
      const native = defined(user.build);
      const effective = {
        outDir: build.artifactBudget?.outputDirectory ?? 'dist',
        manifest: build.artifactBudget?.pc?.manifest ?? true,
        ...build.options,
        ...native,
      };
      return {
        build: effective,
        environments: {
          client: {
            build: {
              ...effective,
              ...defined(user.environments?.client?.build),
            },
          },
        },
      };
    },
  };
  if (!build.bundleAnalysis?.enabled) return [defaults];
  const metadata = resolveProjectPackageMetadata(
    root,
    'rollup-plugin-visualizer',
    '包体积分析工具',
  );
  const { visualizer } = await import(pathToFileURL(metadata.entryPath).href);
  if (typeof visualizer !== 'function')
    throw configurationError(
      'bundle/unsupported-adapter',
      '包体积工具未导出 visualizer 接口。',
    );
  const paths = bundleReportPaths(root, build);
  const config = build.bundleAnalysis;
  const plugins = [
    defaults,
    {
      name: 'repo-guard-module-facts',
      apply: 'build',
      buildStart() {
        prepareBundleReports(root, build);
      },
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle)
          .filter((item) => item.type === 'chunk')
          .map((chunk) => ({
            file: chunk.fileName,
            isEntry: chunk.isEntry,
            isDynamicEntry: chunk.isDynamicEntry,
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules: Object.entries(chunk.modules).map(([id, item]) => ({
              id: path.relative(root, id).replaceAll('\\', '/'),
              bytes: item.renderedLength,
              importers: (this.getModuleInfo(id)?.importers ?? []).map((name) =>
                path.relative(root, name).replaceAll('\\', '/'),
              ),
            })),
          }));
        writeFileSync(
          paths.facts,
          JSON.stringify({ version: 1, runId: context?.runId ?? null, chunks }),
        );
      },
    },
  ];
  for (const format of config.formats)
    plugins.push(
      visualizer({
        filename: paths[format],
        emitFile: false,
        template: format === 'json' ? 'raw-data' : config.template,
        gzipSize: config.gzipSize,
        brotliSize: config.brotliSize,
        open: format === 'html' && config.open,
        projectRoot: root,
        title: '项目包体积分析',
      }),
    );
  return plugins;
}

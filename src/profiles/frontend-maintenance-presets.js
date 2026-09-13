import { frontendPerformancePresets } from './frontend-performance-presets.js';
import { frontendImagePresets } from './frontend-image-presets.js';
import { FRONTEND_MUTATION_OPTIONS } from './frontend-tool-presets.js';
const source = '^src/';
const tests = '^src/tests/';
const rule = (name, comment, from, to) => ({ name, comment, severity: 'error', from, to });

/** 初始化时写入，已有配置不会因读取或升级而改变。 */
export function frontendMaintenancePresets(project) {
  if (project?.role !== 'frontend' || project.stack !== 'node') return {};
  const placement = (name, patterns, directory) => ({ name, patterns,
    allowedPatterns: [`${directory}/**`], exceptions: [], suggestedDirectory: directory });
  return {
    stylelint: { enabled: true, governance: { enabled: true, allowedGlobalStylePatterns: ['styles/**'] }, uiTokens: { enabled: true } },
    typeCheck: { enabled: project.preset.endsWith('-typescript') },
    ...frontendPerformancePresets(project),
    ...frontendImagePresets(project),
    unitTest: { enabled: true, requireTests: 'changedFiles',
      sourcePatterns: ['src/utils/**/*.{js,ts}'],
      testPatterns: ['src/tests/utils/**/*.{test,spec}.{js,ts}'],
      exclusions: ['**/*.d.ts', '**/*.types.ts', '**/*.{test,spec}.*', '**/generated/**'],
      mappings: [{ sourcePattern: 'src/utils/**/*.{js,ts}', sourceRoot: 'src/utils',
        testTemplates: ['src/tests/utils/{relativePath}.test.{ext}', 'src/tests/utils/{relativePath}.spec.{ext}'] }],
    },
    coverage: { enabled: true },
    mutationTest: { enabled: true, options: structuredClone(FRONTEND_MUTATION_OPTIONS) },
    filePlacement: { enabled: true, mode: 'newFiles', rules: [
      placement('测试文件', ['**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}', '**/{test,tests,__tests__}/**'], 'src/tests'),
      placement('类型文件', ['**/*.d.{ts,mts,cts}', '**/*.types.{ts,mts,cts}', '**/types/**/*.{ts,mts,cts}'], 'src/types'),
      placement('样式文件', ['**/*.{css,scss,sass,less}'], 'styles'),
      { name: '资源文件', patterns: ['**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,bmp,tif,tiff,woff,woff2,ttf,otf,eot,mp3,wav,ogg,m4a,mp4,webm,mov,pdf}'],
        allowedPatterns: ['src/assets/**', 'public/assets/**', 'docs/assets/**'], exceptions: ['public/favicon.{ico,png,svg}'], suggestedDirectory: 'src/assets' },
      { name: 'Markdown 文档', patterns: ['**/*.md'], allowedPatterns: ['docs/**', '.github/**', '.changeset/**', '.agents/skills/**'],
        exceptions: ['README*.md', 'CHANGELOG*.md', 'AGENTS.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'LICENSE*.md'], suggestedDirectory: 'docs' },
    ] },
    maxFileLines: { enabled: true, mode: 'strict', warnAt: 0.85, exclusions: [], rules: [
      { pattern: 'src/**/*.vue', maxLines: 700 },
      { pattern: 'src/**/{composables,utils}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}', maxLines: 400 },
      { pattern: 'src/**/{api,stores,store}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}', maxLines: 500 },
      { pattern: 'src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}', maxLines: 1000 },
      { pattern: '{src,styles}/**/*.{css,scss,sass,less}', maxLines: 500 },
    ] },
    pathNaming: { enabled: true, convention: 'kebab-case', include: ['src/**'],
      exclude: ['**/.*', '**/.*/**', '**/generated/**'], lowercaseExtension: true },
    architecture: { enabled: true, sourcePaths: ['src'], timeoutMs: 120000, tsConfig: null,
      exclude: '(?:^|/)(?:node_modules|coverage|\\.git)/', rules: [
        rule('no-circular', '禁止循环依赖。', { path: source }, { circular: true }),
        rule('no-unresolved', '导入必须能够解析。', { path: source }, { couldNotResolve: true }),
        rule('no-production-to-tests', '生产代码不得引用测试。', { path: source, pathNot: tests }, { path: tests }),
        rule('no-production-to-dev-dependencies', '生产代码不得引用仅开发依赖。', { path: source, pathNot: tests }, { dependencyTypes: ['npm-dev'] }),
        rule('no-source-to-build', '源码不得引用构建产物。', { path: source }, { path: '(?:^|/)(?:dist|build)/' }),
        rule('no-components-to-pages', '公共组件不得依赖页面。', { path: '^src/components/' }, { path: '^src/(?:views|pages)/' }),
        rule('no-utils-to-business', '通用工具不得依赖页面、组件、状态和业务模块。', { path: '^src/utils/' }, { path: '^src/(?:views|pages|components|stores|store|features)/' }),
        rule('no-api-to-ui', '接口模块不得依赖 UI 和页面。', { path: '^src/api/' }, { path: '^src/(?:components|views|pages)/' }),
        rule('no-types-constants-to-business', '类型常量不得依赖高层实现。', { path: '^src/(?:types|constants)/' }, { path: '^src/(?:views|pages|components|stores|store|features|api)/' }),
        rule('no-shared-to-features', '共享层不得依赖业务模块。', { path: '^src/(?:shared|components|utils|types|constants)/' }, { path: '^src/features/' }),
        rule('no-feature-internals', '跨业务模块只能引用公开入口。', { path: '^src/features/([^/]+)/' }, { path: '^src/features/([^/]+)/', pathNot: ['^src/features/$1/', '^src/features/[^/]+/index\\.[cm]?[jt]sx?$'] }),
      ] },
    asyncResourceCleanup: { enabled: true },
    deadCode: { enabled: true, mode: 'strict', production: false,
      issueTypes: ['files', 'dependencies', 'unlisted', 'exports', ...(project.preset.endsWith('-typescript') ? ['types'] : [])],
      options: { includeEntryExports: false, ignoreExportsUsedInFile: false, ignoreDependencies: [], ignoreBinaries: [], ignoreUnresolved: [], ignoreFiles: [] }
    },
    functionDocs: { enabled: true, include: ['src/**'], exclude: ['src/tests/**', '**/*.d.ts', '**/*.min.js', '**/generated/**'],
      exportedOnly: true, requireDescription: true, requireParamDescription: true, requireReturnsDescription: true, requireThrowsDescription: true, requireSideEffectsDescription: true },
    fileHeader: { enabled: true, include: ['src/**'], exclude: ['src/tests/**', '**/generated/**', '**/vendor/**'] },
  };
}

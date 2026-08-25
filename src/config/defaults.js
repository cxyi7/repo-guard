export const DEFAULT_ESLINT_PATTERN = '*.{js,jsx,ts,tsx,vue}';
export const DEFAULT_PRETTIER_PATTERN = '*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}';
export const DEFAULT_STYLELINT_PATTERN = '**/*.{css,scss,sass,less,vue}';
export const SUPPORTED_FILE_HEADER_EXTENSIONS = Object.freeze([
  '.vue',
  '.html',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.css',
  '.less',
  '.scss',
  '.sass',
]);
export const DEFAULT_FILE_HEADER_CONFIG = Object.freeze({
  enabled: false,
  include: Object.freeze(['**/*']),
  exclude: Object.freeze([]),
  extensions: SUPPORTED_FILE_HEADER_EXTENSIONS,
});
export const SUPPORTED_FUNCTION_DOC_EXTENSIONS = Object.freeze([
  '.vue',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
]);
export const DEFAULT_FUNCTION_DOC_CONFIG = Object.freeze({
  enabled: false,
  include: Object.freeze(['**/*']),
  exclude: Object.freeze([
    '**/*.d.ts',
    '**/*.min.js',
    '**/generated/**',
    '**/*.spec.*',
    '**/*.test.*',
  ]),
  extensions: SUPPORTED_FUNCTION_DOC_EXTENSIONS,
});
export const SUPPORTED_ASYNC_RESOURCE_CLEANUP_EXTENSIONS = Object.freeze([
  '.vue',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
]);
export const DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG = Object.freeze({
  enabled: false,
  include: Object.freeze([
    'src/**/*.vue',
    'src/composables/**/*.{js,jsx,ts,tsx,mjs,cjs}',
    'src/**/composables/**/*.{js,jsx,ts,tsx,mjs,cjs}',
  ]),
  exclude: Object.freeze([
    '**/*.d.ts',
    '**/*.spec.*',
    '**/*.test.*',
    '**/generated/**',
  ]),
  extensions: SUPPORTED_ASYNC_RESOURCE_CLEANUP_EXTENSIONS,
  timeoutThresholdMs: 1000,
  requestFunctions: Object.freeze(['fetch']),
});
export const SUPPORTED_PATH_NAMING_CONVENTIONS = Object.freeze([
  'camelCase',
  'kebab-case',
]);
export const DEFAULT_PATH_NAMING_CONFIG = Object.freeze({
  enabled: false,
  convention: 'camelCase',
  include: Object.freeze([
    'src/**',
    'utils/**',
  ]),
  exclude: Object.freeze([
    '**/.*',
    '**/.*/**',
    '**/generated/**',
  ]),
});
export const SUPPORTED_IMAGE_ASSET_EXTENSIONS = Object.freeze([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'avif',
  'svg',
  'gif',
  'ico',
  'bmp',
  'tif',
  'tiff',
]);
export const SUPPORTED_IMAGE_REFERENCE_SOURCE_EXTENSIONS = Object.freeze([
  '.vue',
  '.nvue',
  '.html',
  '.wxml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.css',
  '.less',
  '.scss',
  '.sass',
  '.wxss',
  '.md',
  '.json',
]);
export const DEFAULT_IMAGE_ASSETS_CONFIG = Object.freeze({
  enabled: false,
  enforcement: 'changedFiles',
  include: Object.freeze([
    'src/assets/**/*.{png,jpg,jpeg,webp,avif,svg,gif,ico,bmp,tif,tiff}',
    'public/assets/**/*.{png,jpg,jpeg,webp,avif,svg,gif,ico,bmp,tif,tiff}',
    'docs/assets/**/*.{png,jpg,jpeg,webp,avif,svg,gif,ico,bmp,tif,tiff}',
  ]),
  exclude: Object.freeze([
    '**/generated/**',
    '**/dist/**',
    '**/coverage/**',
    '**/reports/**',
  ]),
  extensions: SUPPORTED_IMAGE_ASSET_EXTENSIONS,
  naming: Object.freeze({
    enabled: true,
    convention: 'camelCase',
    lowercaseExtension: true,
    densitySuffixes: Object.freeze(['@2x', '@3x']),
    allowNinePatch: false,
  }),
  duplicates: Object.freeze({
    exact: 'error',
    pixel: 'off',
    canonicalRoots: Object.freeze(['src/assets', 'public/assets', 'docs/assets']),
  }),
  compression: Object.freeze({
    enabled: true,
    action: 'report',
    minInputBytes: 8192,
    minSavingsBytes: 2048,
    minSavingsPercent: 10,
    raster: Object.freeze({
      enabled: true,
      allowLossy: false,
      metadata: 'preserve',
    }),
    svg: Object.freeze({
      enabled: true,
      allowWrite: false,
    }),
    conversion: Object.freeze({
      enabled: false,
      target: 'webp',
      sourceFormats: Object.freeze(['png', 'jpg', 'jpeg']),
      action: 'report',
      minInputBytes: 8192,
      minSavingsBytes: 4096,
      minSavingsPercent: 20,
      pngMode: 'lossless',
      jpegQuality: 82,
      effort: 6,
      exactAlpha: true,
      allowFallbackOriginal: false,
    }),
  }),
  unused: Object.freeze({
    enabled: false,
    action: 'error',
    sourceInclude: Object.freeze([
      '*.{html,md}',
      'src/**/*.{vue,nvue,html,wxml,js,jsx,ts,tsx,mjs,cjs,css,less,scss,sass,wxss,json}',
      'public/**/*.html',
      'docs/**/*.md',
    ]),
    sourceExclude: Object.freeze([
      '**/*.d.ts',
      '**/*.min.*',
      '**/*.spec.*',
      '**/*.test.*',
      '**/generated/**',
      '**/dist/**',
      '**/coverage/**',
      '**/reports/**',
    ]),
    sourceExtensions: SUPPORTED_IMAGE_REFERENCE_SOURCE_EXTENSIONS,
    aliases: Object.freeze([
      Object.freeze({ prefix: '@/', directory: 'src' }),
    ]),
    publicRoots: Object.freeze([
      Object.freeze({ directory: 'public', urlPrefix: '/' }),
    ]),
    dynamicReferences: Object.freeze([]),
    limits: Object.freeze({
      maxSourceFiles: 10000,
      maxSourceBytes: 2097152,
      maxTotalSourceBytes: 104857600,
    }),
  }),
  limits: Object.freeze({
    maxInputBytes: 26214400,
    maxPixels: 40000000,
    maxFrames: 1,
  }),
});
export const DEFAULT_STYLE_COMPLEXITY_CONFIG = Object.freeze({
  enabled: false,
  maxCompoundSelectors: 3,
  maxNestingDepth: 3,
});
export const DEFAULT_STYLE_GOVERNANCE_CONFIG = Object.freeze({
  enabled: false,
  maxSpecificity: '0,3,0',
  maxIdSelectors: 0,
  disallowImportant: true,
  allowedGlobalStylePatterns: Object.freeze([
    'src/styles/**',
    'src/assets/styles/**',
    'src/assets/css/**',
    'src/assets/main.{css,scss,sass,less}',
    'src/main.{css,scss,sass,less}',
    'src/index.{css,scss,sass,less}',
    'src/style.{css,scss,sass,less}',
    'src/App.vue',
  ]),
});
export const DEFAULT_ESLINT_CONFIG = Object.freeze({
  enabled: true,
  preset: true,
  pattern: DEFAULT_ESLINT_PATTERN,
  fix: true,
  maxWarnings: 0,
});
export const DEFAULT_PRETTIER_CONFIG = Object.freeze({
  enabled: true,
  pattern: DEFAULT_PRETTIER_PATTERN,
  fix: true,
  requireConfig: true,
});
export const DEFAULT_STYLELINT_CONFIG = Object.freeze({
  enabled: false,
  pattern: DEFAULT_STYLELINT_PATTERN,
  fix: true,
  maxWarnings: 0,
  requireConfig: true,
  complexity: DEFAULT_STYLE_COMPLEXITY_CONFIG,
  governance: DEFAULT_STYLE_GOVERNANCE_CONFIG,
});
export const DEFAULT_BUILD_CONFIG = Object.freeze({
  enabled: false,
  script: 'build',
  timeoutMs: 300000,
});
export const DEFAULT_MUTATION_TEST_CONFIG = Object.freeze({
  enabled: false,
  configFile: 'stryker.config.json',
  timeoutMs: 1800000,
  reportsDirectory: 'reports/mutation',
  originalHtml: true,
  guardedBuilds: Object.freeze([]),
});
export const DEFAULT_DEPENDENCY_POLICY_CONFIG = Object.freeze({
  enabled: true,
  requireExactVersions: true,
  requireLockfile: true,
  allowedProtocols: Object.freeze(['npm', 'workspace']),
  bannedPackages: Object.freeze([]),
});
export const DEFAULT_COMMIT_MESSAGE_CONFIG = Object.freeze({
  enabled: false,
  types: Object.freeze([
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'build',
    'ci',
    'chore',
  ]),
  requireScope: false,
  allowedScopes: Object.freeze([]),
  headerMaxLength: 100,
  breakingChange: Object.freeze({
    allowed: true,
    requireMarker: true,
    requireFooter: true,
    requireMajorVersionOnRelease: true,
  }),
  merge: Object.freeze({ allowed: true }),
  revert: Object.freeze({ allowed: true }),
  fixup: Object.freeze({
    allowLocal: true,
    allowPush: false,
    allowCi: false,
  }),
});
const DEFAULT_ARCHITECTURE_TEST_PATTERN = String.raw`(?:^|/)(?:__tests__|tests?)/|\.(?:spec|test)\.[cm]?[jt]sx?$`;
export const DEFAULT_ARCHITECTURE_CONFIG = Object.freeze({
  enabled: false,
  timeoutMs: 120000,
  sourcePaths: Object.freeze(['src']),
  tsConfig: null,
  exclude: String.raw`(?:^|/)(?:node_modules|dist|coverage|\.git)/`,
  rules: Object.freeze([
    Object.freeze({
      name: 'no-circular',
      comment: '禁止创建循环依赖。',
      severity: 'error',
      from: Object.freeze({ path: '^src/' }),
      to: Object.freeze({ circular: true }),
    }),
    Object.freeze({
      name: 'no-unresolved',
      comment: '项目中的每个导入都必须能够解析。',
      severity: 'error',
      from: Object.freeze({ path: '^src/' }),
      to: Object.freeze({ couldNotResolve: true }),
    }),
    Object.freeze({
      name: 'no-production-to-tests',
      comment: '生产代码不得导入仅供测试使用的模块。',
      severity: 'error',
      from: Object.freeze({ path: '^src/', pathNot: DEFAULT_ARCHITECTURE_TEST_PATTERN }),
      to: Object.freeze({ path: DEFAULT_ARCHITECTURE_TEST_PATTERN }),
    }),
  ]),
});
export const SUPPORTED_DEAD_CODE_ISSUE_TYPES = Object.freeze([
  'files',
  'dependencies',
  'unlisted',
  'binaries',
  'unresolved',
  'exports',
  'types',
]);
export const DEFAULT_DEAD_CODE_CONFIG = Object.freeze({
  enabled: false,
  mode: 'strict',
  configFile: null,
  baselineFile: '.repo-guard/knip-baseline.json',
  timeoutMs: 180000,
  production: false,
  issueTypes: SUPPORTED_DEAD_CODE_ISSUE_TYPES,
  treatConfigHintsAsErrors: true,
});
export const DEFAULT_MAX_FILE_LINES_CONFIG = Object.freeze({
  enabled: true,
  mode: 'strict',
  warnAt: 0.85,
  rules: Object.freeze([
    Object.freeze({ pattern: '**/*.vue', maxLines: 700 }),
    Object.freeze({ pattern: '**/*.{js,mjs,cjs,jsx}', maxLines: 1000 }),
    Object.freeze({ pattern: '**/*.{ts,tsx}', maxLines: 1000 }),
  ]),
  exclusions: Object.freeze([]),
});
export const DEFAULT_FILE_PLACEMENT_CONFIG = Object.freeze({
  enabled: true,
  mode: 'newFiles',
  rules: Object.freeze([
    Object.freeze({
      name: '资源文件',
      patterns: Object.freeze([
        '**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,bmp,tif,tiff}',
        '**/*.{woff,woff2,ttf,otf,eot}',
        '**/*.{mp3,wav,ogg,m4a,mp4,webm,mov,pdf}',
      ]),
      allowedPatterns: Object.freeze([
        'src/assets/**',
        'public/assets/**',
        'docs/assets/**',
      ]),
      exceptions: Object.freeze([
        'public/favicon.{ico,png,svg}',
      ]),
      suggestedDirectory: 'src/assets',
    }),
    Object.freeze({
      name: 'Markdown 文档',
      patterns: Object.freeze(['**/*.md']),
      allowedPatterns: Object.freeze([
        'docs/**',
        '.github/**',
        '.changeset/**',
      ]),
      exceptions: Object.freeze([
        'README*.md',
        'CHANGELOG*.md',
        'AGENTS.md',
        'SECURITY.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        'LICENSE*.md',
      ]),
      suggestedDirectory: 'docs',
    }),
  ]),
});
export const DEFAULT_CODE_PLACEMENT_CONFIG = Object.freeze({
  enabled: false,
  rules: Object.freeze([]),
});
export const DEFAULT_LIGHTHOUSE_CONFIG = Object.freeze({
  enabled: false,
  configFile: null,
  buildScript: 'build',
  timeoutMs: 300000,
});
export const DEFAULT_TYPE_CHECK_CONFIG = Object.freeze({
  enabled: false,
  script: 'typecheck',
  timeoutMs: 180000,
});
export const DEFAULT_ACCESSIBILITY_TEST_CONFIG = Object.freeze({
  enabled: false,
  script: 'test:a11y',
  timeoutMs: 180000,
  testPatterns: Object.freeze([
    '**/*.a11y.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    '**/accessibility/**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
  ]),
});
export const DEFAULT_UNIT_TEST_COVERAGE_CONFIG = Object.freeze({
  enabled: false,
  reportsDirectory: 'coverage',
  thresholds: Object.freeze({
    lines: 80,
    statements: 80,
    functions: 80,
    branches: 80,
    changedLines: 90,
  }),
});
export const DEFAULT_COMPONENT_INTERACTION_CONFIG = Object.freeze({
  enabled: false,
  componentPatterns: Object.freeze([
    'src/components/**/*.vue',
  ]),
});
export const DEFAULT_UNIT_TEST_CONFIG = Object.freeze({
  enabled: false,
  script: 'test:unit',
  timeoutMs: 120000,
  coverage: DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  componentInteraction: DEFAULT_COMPONENT_INTERACTION_CONFIG,
  requireTests: 'newFiles',
  sourcePatterns: Object.freeze([
    'src/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/composables/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/stores/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/api/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    'src/components/**/*.{js,jsx,ts,tsx,vue}',
  ]),
  testPatterns: Object.freeze([
    '**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
  ]),
  mappings: Object.freeze([
    Object.freeze({
      sourcePattern: '**/*.{js,mjs,cjs}',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{dir}/__tests__/{name}.spec.js',
        '{dir}/__tests__/{name}.test.js',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.jsx',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{path}.spec.jsx',
        '{path}.test.jsx',
        '{dir}/__tests__/{name}.spec.jsx',
        '{dir}/__tests__/{name}.test.jsx',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.{ts,mts,cts}',
      testTemplates: Object.freeze([
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.ts',
        '{dir}/__tests__/{name}.test.ts',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.tsx',
      testTemplates: Object.freeze([
        '{path}.spec.tsx',
        '{path}.test.tsx',
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.tsx',
        '{dir}/__tests__/{name}.test.tsx',
      ]),
    }),
    Object.freeze({
      sourcePattern: '**/*.vue',
      testTemplates: Object.freeze([
        '{path}.spec.js',
        '{path}.test.js',
        '{path}.spec.ts',
        '{path}.test.ts',
        '{dir}/__tests__/{name}.spec.js',
        '{dir}/__tests__/{name}.spec.ts',
      ]),
    }),
  ]),
  exclusions: Object.freeze([
    'src/main.{js,ts}',
    'src/**/index.{js,ts}',
    'src/generated/**',
  ]),
});
export const DEFAULT_NOTIFICATION_CONFIG = Object.freeze({
  enabled: true,
});
export const DEFAULT_CI_GATE_POLICY_CONFIG = Object.freeze({
  defaultMode: 'inherit',
  gates: Object.freeze({}),
});
export const DEFAULT_CI_PIPELINE_CONFIG = Object.freeze({
  enabled: false,
  verifyStage: 'build',
  deployStage: 'deploy',
  verifyImage: 'node:22.23.2',
  deployImage: 'node:22.23.2',
  testBranches: Object.freeze(['dev']),
  productionBranches: Object.freeze(['publish']),
  runnerTags: Object.freeze(['docker']),
  legacyPeerDeps: false,
  quickDeploy: false,
  notifications: false,
});
export const DEFAULT_CI_CONFIG = Object.freeze({
  enabled: false,
  profile: 'policy',
  reportPath: 'reports/repo-guard.json',
  protectedFiles: Object.freeze({ action: 'report' }),
  gatePolicy: DEFAULT_CI_GATE_POLICY_CONFIG,
  pipeline: DEFAULT_CI_PIPELINE_CONFIG,
});
export const DEFAULT_EXCEPTIONS_CONFIG = Object.freeze({
  warningDays: 14,
  maxDays: 90,
  entries: Object.freeze([]),
});

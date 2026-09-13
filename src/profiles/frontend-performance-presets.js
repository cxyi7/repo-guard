/** 初始预算与规则；具体脚本、产物目录和业务路由需由接入者写入。 */
export function frontendPerformancePresets(project) {
  if (project?.role !== 'frontend' || project.stack !== 'node') return {};
  const assertion = (field, value) => [
    'error',
    { [field]: value, aggregationMethod: 'median' },
  ];
  return {
    build: {
      enabled: true,
      script: 'build',
      timeoutMs: 300000,
      options: {
        minify: true,
        cssMinify: true,
        cssCodeSplit: true,
        sourcemap: false,
        assetsInlineLimit: 4096,
      },
      artifactBudget: {
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist',
        cleanScript: null,
        action: 'error',
        mode: 'strict',
        pc: {
          analyzer: 'viteManifest',
          manifest: '.vite/manifest.json',
          sourceMaps: 'forbid',
          compression: ['raw', 'gzip', 'brotli'],
          limits: {
            totalRawBytes: 8388608,
            initialJsBrotliBytes: 358400,
            initialCssBrotliBytes: 102400,
            maxChunkRawBytes: 614400,
            maxChunkCount: null,
            maxAssetRawBytes: 2097152,
          },
        },
      },
      bundleAnalysis: {
        enabled: true,
        adapter: 'rollup-visualizer',
        reportsDirectory: 'reports/bundle',
        formats: ['html', 'json'],
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: false,
      },
    },
    lighthouse: {
      enabled: true,
      imageUsage: { enabled: true, action: 'report', failedRequests: true, maxTransferBytes: 1572864,
        components: [], maxDimensionRatio: 2,
        auditIds: ['unsized-images', 'offscreen-images', 'uses-responsive-images', 'modern-image-formats', 'uses-optimized-images', 'lcp-lazy-loaded'], routes: [] },
      prePush: false,
      configFile: null,
      buildScript: 'build',
      timeoutMs: 600000,
      pages: [],
      options: {
        ci: {
          collect: {
            url: [],
            numberOfRuns: 3,
            settings: { preset: 'desktop', onlyCategories: ['performance'] },
          },
          assert: {
            assertions: {
              'categories:performance': assertion('minScore', 0.9),
              'first-contentful-paint': assertion('maxNumericValue', 1800),
              'largest-contentful-paint': assertion('maxNumericValue', 2500),
              'total-blocking-time': assertion('maxNumericValue', 200),
              'cumulative-layout-shift': assertion('maxNumericValue', 0.1),
            },
          },
        },
      },
    },
  };
}

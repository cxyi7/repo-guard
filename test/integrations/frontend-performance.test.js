import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  createProjectDocument,
  normalizeProjectDocument,
} from '../../src/config/project-configuration.js';
import { getFrontendToolRequirements } from '../../src/profiles/frontend-tool-requirements.js';
import {
  BUILD_OPTIONS_SCHEMA,
  BUNDLE_ANALYSIS_SCHEMA,
  LIGHTHOUSE_OPTIONS_SCHEMA,
  LIGHTHOUSE_PAGES_SCHEMA,
} from '../../src/config/performance-options.js';
import { prepareLighthouseConfiguration } from '../../src/integrations/lighthouse/configuration.js';
import { inspectLighthouseReports } from '../../src/integrations/lighthouse/reports.js';
import {
  prepareBundleReports,
  inspectBundleReports,
} from '../../src/integrations/build-artifacts/bundle-analysis.js';
import {
  buildInputFingerprint,
  recordBuildEvidence,
  currentBuildEvidence,
} from '../../src/integrations/build-artifacts/evidence.js';
import { inspectPcBuildArtifacts } from '../../src/integrations/build-artifacts/project.js';
import { createFrontendBuildPlugins } from '../../src/integrations/build-artifacts/vite-plugin.js';

const project = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-typescript',
};
function fixture(t) {
  const root = mkdtempSync(path.join(process.cwd(), 'test/.tmp/performance-'));
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(root + '/package.json', '{"name":"test","version":"1.0.0"}');
  return root;
}
function write(root, file, value) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(
    path.join(root, file),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}
function configuration() {
  return createProjectDocument(project);
}
function pageConfig() {
  const c = configuration().checks.lighthouse;
  c.pages = [
    {
      url: 'http://localhost:4173/orders',
      expectedUrl: 'http://localhost:4173/orders',
      selector: '[data-page="orders"]',
    },
  ];
  c.options.ci.collect.url = c.pages.map((p) => p.url);
  return c;
}

test('前端默认开启构建预算、模块分析和页面性能，Schema 与依赖要求一致', () => {
  const c = configuration().checks;
  for (const x of [
    c.build,
    c.build.artifactBudget,
    c.build.bundleAnalysis,
    c.lighthouse,
  ])
    assert.equal(x.enabled, true);
  assert.equal(c.lighthouse.prePush, false);
  assert.deepEqual(c.lighthouse.pages, []);
  const ajv = new Ajv2020({ strict: false });
  for (const [s, v] of [
    [BUILD_OPTIONS_SCHEMA, c.build.options],
    [BUNDLE_ANALYSIS_SCHEMA, c.build.bundleAnalysis],
    [LIGHTHOUSE_OPTIONS_SCHEMA, c.lighthouse.options],
    [LIGHTHOUSE_PAGES_SCHEMA, c.lighthouse.pages],
  ])
    assert.equal(ajv.compile(s)(v), true);
  const names = getFrontendToolRequirements(configuration()).map((x) => x.name);
  for (const name of ['rollup-plugin-visualizer', '@lhci/cli', 'puppeteer'])
    assert.ok(names.includes(name));
  const old = normalizeProjectDocument({ version: 2, project });
  assert.equal(old.checks.build.bundleAnalysis, undefined);
  assert.equal(old.checks.lighthouse.options, undefined);
  const invalid = configuration();
  invalid.checks.build.options.assetsInlineLimit = -1;
  assert.throws(() => normalizeProjectDocument(invalid));
});

test('原生 Vite 配置优先于可编辑预设，自定义产物路径不被写死', async (t) => {
  const root = fixture(t);
  const c = configuration();
  c.checks.build.bundleAnalysis.enabled = false;
  c.checks.build.artifactBudget.outputDirectory = 'web-output';
  c.checks.build.options.assetsInlineLimit = 2048;
  write(root, 'repo-guard.config.json', c);
  const [plugin] = await createFrontendBuildPlugins({ root });
  const merged = plugin.config({
    build: { minify: false, sourcemap: 'hidden' },
  }).build;
  assert.equal(merged.outDir, 'web-output');
  assert.equal(merged.assetsInlineLimit, 2048);
  assert.equal(merged.minify, false);
  assert.equal(merged.sourcemap, 'hidden');
});

test('原生 Lighthouse 数组整体优先且文件不变，页面合同必须与最终 URL 一致', async (t) => {
  const root = fixture(t);
  const c = pageConfig();
  const native = {
    ci: {
      collect: { numberOfRuns: 1, url: c.options.ci.collect.url },
      assert: {
        assertions: { 'categories:performance': ['error', { minScore: 0.95 }] },
      },
      upload: { target: 'temporary-public-storage' },
    },
  };
  write(root, 'lighthouserc.json', native);
  const before = readFileSync(root + '/lighthouserc.json', 'utf8');
  const prepared = await prepareLighthouseConfiguration(
    root,
    c,
    'lighthouserc.json',
  );
  try {
    assert.equal(prepared.effective.ci.collect.numberOfRuns, 1);
    assert.deepEqual(
      prepared.effective.ci.assert.assertions['categories:performance'],
      ['error', { minScore: 0.95 }],
    );
    assert.equal(prepared.effective.ci.upload, undefined);
    assert.equal(prepared.effective.ci.collect.additive, false);
    assert.equal(readFileSync(root + '/lighthouserc.json', 'utf8'), before);
  } finally {
    prepared.dispose();
  }
  c.pages = [];
  await assert.rejects(
    () => prepareLighthouseConfiguration(root, c, 'lighthouserc.json'),
    /pages/,
  );
});

test('生成的页面守卫执行用户登录初始化、业务标识验证，拒绝登录跳转并关闭页面', async (t) => {
  const root = fixture(t);
  const c = pageConfig();
  write(
    root,
    'auth.cjs',
    'module.exports=async browser=>{browser.auth=true;};',
  );
  c.options.ci.collect.puppeteerScript = 'auth.cjs';
  c.options.ci.collect.settings.screenEmulation = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
  c.options.ci.collect.settings.emulatedUserAgent = false;
  const prepared = await prepareLighthouseConfiguration(root, c, null);
  let closed = 0;
  let selector;
  let finalUrl = c.pages[0].url;
  const browser = {
    newPage: async () => ({
      setViewport: async (viewport) => assert.equal(viewport.width, 390),
      goto: async () => ({ status: () => 200 }),
      evaluate: async () => [],
      url: () => finalUrl,
      waitForSelector: async (s) => {
        selector = s;
      },
      close: async () => {
        closed++;
      },
    }),
  };
  try {
    const guard = createRequire(import.meta.url)(
      path.resolve(root, prepared.effective.ci.collect.puppeteerScript),
    );
    await guard(browser, {});
    assert.equal(browser.auth, true);
    assert.equal(selector, c.pages[0].selector);
    finalUrl = 'http://localhost:4173/login';
    await assert.rejects(() => guard(browser, {}), /最终地址/);
    assert.equal(closed, 2);
  } finally {
    prepared.dispose();
  }
});

test('模块摘要识别顶层与嵌套依赖，拒绝旧运行报告并计算同配置历史比较', (t) => {
  const root = fixture(t);
  const b = configuration().checks.build;
  prepareBundleReports(root, b);
  write(root, 'reports/bundle/bundle.json', { tree: {} });
  write(root, 'reports/bundle/bundle.html', '<html>体积</html>');
  const chunks = [
    {
      file: 'a.js',
      modules: [
        { id: 'node_modules/vue/index.js', bytes: 10 },
        { id: 'node_modules/a/node_modules/@scope/b/x.js', bytes: 20 },
      ],
    },
    { file: 'b.js', modules: [{ id: 'node_modules/vue/index.js', bytes: 5 }] },
  ];
  write(root, 'reports/bundle/modules.json', {
    version: 1,
    runId: 'current',
    chunks,
  });
  assert.throws(() => inspectBundleReports(root, b, 'wrong'), /不属于本次/);
  const first = inspectBundleReports(root, b, 'current').summary;
  assert.equal(first.largestPackages.find((p) => p.name === 'vue').bytes, 15);
  assert.equal(first.repeatedModules.length, 1);
  assert.equal(
    inspectBundleReports(root, b, 'current', first).summary.comparison
      .previousRunId,
    'current',
  );
});

test('源码、用户配置和产物改变会使构建证据失效', (t) => {
  const root = fixture(t);
  const b = configuration().checks.build;
  write(root, '.gitignore', 'dist/\nreports/\n');
  write(root, 'src/input.js', 'export const x=1;');
  write(root, 'dist/a.js', 'compiled');
  const input = buildInputFingerprint(root, b);
  recordBuildEvidence(root, b, input, 'run');
  assert.ok(currentBuildEvidence(root, b));
  write(root, 'reports/ignored.json', {});
  assert.ok(currentBuildEvidence(root, b));
  write(root, 'src/input.js', 'export const x=2;');
  assert.equal(currentBuildEvidence(root, b), null);
  recordBuildEvidence(root, b, buildInputFingerprint(root, b), 'run-2');
  write(root, 'dist/a.js', 'changed');
  assert.equal(currentBuildEvidence(root, b), null);
  assert.throws(() => recordBuildEvidence(root, b, input, 'old'), /构建过程中/);
});

test('动态产物必须存在但不计入静态首屏，清单拒绝反斜线穿越', (t) => {
  const root = fixture(t);
  const b = configuration().checks.build.artifactBudget;
  write(root, 'dist/a.js', 'a');
  write(root, 'dist/lazy.js', 'lazy');
  const manifest = {
    'index.html': { file: 'a.js', isEntry: true, dynamicImports: ['lazy'] },
    lazy: { file: 'lazy.js' },
  };
  write(root, 'dist/.vite/manifest.json', manifest);
  assert.equal(inspectPcBuildArtifacts(root, b).metrics.initialJsRawBytes, 1);
  rmSync(root + '/dist/lazy.js');
  assert.throws(() => inspectPcBuildArtifacts(root, b), /不存在/);
  manifest.lazy.file = '..\\secret.js';
  write(root, 'dist/.vite/manifest.json', manifest);
  assert.throws(() => inspectPcBuildArtifacts(root, b), /不安全/);
});

test('页面报告要求完整、新鲜、正确 URL，并输出加载资源且不保存认证头', (t) => {
  const root = fixture(t);
  const c = pageConfig();
  c.options.ci.collect.numberOfRuns = 1;
  c.options.ci.collect.settings.extraHeaders = { Authorization: 'secret' };
  const lhr = {
    requestedUrl: c.pages[0].url,
    finalDisplayedUrl: c.pages[0].expectedUrl,
    lighthouseVersion: '12',
    categories: { performance: { score: 1 } },
    audits: {
      'network-requests': {
        details: {
          items: [
            {
              url: 'http://localhost/app.js',
              transferSize: 100,
              resourceSize: 200,
            },
          ],
        },
      },
    },
  };
  write(root, '.lighthouseci/lhr-1.json', lhr);
  const start = Date.now();
  const evidence = { runId: 'verified' };
  assert.throws(() => inspectLighthouseReports(root, c, c.options, start, evidence), /图片观察/);
  // 本例验证通用报告；图片观察的缺失证据另有专门回归测试。
  c.imageUsage.enabled = false;
  const result = inspectLighthouseReports(root, c, c.options, start, evidence);
  const summary = JSON.parse(readFileSync(path.join(root, result.path)));
  assert.equal(summary.version, 2);
  assert.equal(summary.buildEvidence.runId, 'verified');
  assert.equal(summary.pages[0].resources[0].resourceSize, 200);
  assert.equal(summary.environment.settings.extraHeaders, undefined);
  lhr.finalDisplayedUrl = 'http://localhost/login';
  write(root, '.lighthouseci/lhr-1.json', lhr);
  assert.throws(
    () => inspectLighthouseReports(root, c, c.options, start, evidence),
    /非目标/,
  );
  lhr.finalDisplayedUrl = c.pages[0].expectedUrl;
  write(root, '.lighthouseci/lhr-1.json', lhr);
  c.options.ci.collect.numberOfRuns = 3;
  assert.throws(
    () => inspectLighthouseReports(root, c, c.options, start, evidence),
    /数量/,
  );
  utimesSync(root + '/.lighthouseci/lhr-1.json', new Date(0), new Date(0));
  assert.throws(
    () => inspectLighthouseReports(root, c, c.options, start, evidence),
    /本轮/,
  );
});

test('重新启用性能预设递归补缺，保留自定义路径、阈值、数组和关闭项', async (t) => {
  const { setFeaturesEnabled } = await import(
    '../../src/orchestration/setup/config-management.js'
  );
  const root = fixture(t);
  write(root, 'repo-guard.config.json', {
    version: 2,
    project,
    checks: {
      build: {
        enabled: false,
        artifactBudget: {
          outputDirectory: 'site',
          platform: 'pc',
          pc: { limits: { totalRawBytes: 9000000 } },
        },
        bundleAnalysis: { formats: ['json'] },
      },
      lighthouse: {
        enabled: false,
        options: {
          ci: {
            collect: { url: ['http://localhost/orders'], numberOfRuns: 2 },
          },
        },
      },
    },
  });
  setFeaturesEnabled(root, ['build', 'lighthouse'], true);
  const c = JSON.parse(readFileSync(root + '/repo-guard.config.json'));
  assert.equal(c.checks.build.artifactBudget.enabled, true);
  assert.equal(c.checks.build.artifactBudget.outputDirectory, 'site');
  assert.equal(c.checks.build.artifactBudget.pc.limits.totalRawBytes, 9000000);
  assert.equal(
    c.checks.build.artifactBudget.pc.limits.initialJsBrotliBytes,
    358400,
  );
  assert.equal(c.checks.build.bundleAnalysis.enabled, true);
  assert.deepEqual(c.checks.build.bundleAnalysis.formats, ['json']);
  assert.equal(c.checks.lighthouse.options.ci.collect.numberOfRuns, 2);
  assert.deepEqual(c.checks.lighthouse.options.ci.collect.url, [
    'http://localhost/orders',
  ]);
  const before = readFileSync(root + '/repo-guard.config.json', 'utf8');
  setFeaturesEnabled(root, ['build', 'lighthouse'], true);
  assert.equal(readFileSync(root + '/repo-guard.config.json', 'utf8'), before);
});

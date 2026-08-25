import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateConfig } from '../src/config/configuration-validation.js';
import { unusedImageAssetsGate } from '../src/gates/repository/unused-image-assets-gate.js';
import { runGit } from '../src/git/execution.js';
import { createStarterConfig } from '../src/orchestration/setup/config-management.js';
import { analyzeUnusedImageAssets } from '../src/policies/unused-image-assets.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function rawConfigFixture({ enforcement = 'allFiles', action = 'error' } = {}) {
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.enforcement = enforcement;
  config.imageAssets.include = ['src/assets/**/*.{png,svg}', 'public/assets/**/*.png'];
  config.imageAssets.exclude = [];
  config.imageAssets.unused.enabled = true;
  config.imageAssets.unused.action = action;
  config.imageAssets.unused.sourceInclude = ['src/**/*.{vue,ts,css,json}', 'docs/**/*.md'];
  config.imageAssets.unused.sourceExclude = [];
  return config;
}

function configFixture(options) {
  return validateConfig(rawConfigFixture(options));
}

function analyze(entries, contents, config = configFixture()) {
  return analyzeUnusedImageAssets({
    entries: entries.map((filePath) => ({ path: filePath, size: contents.get(filePath)?.length ?? 1 })),
    readSource: (filePath) => contents.get(filePath),
    imageConfig: config.imageAssets,
  });
}

function gitFixture(context) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'unused-image-assets-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  runGit(['config', 'user.email', 'repo-guard@example.com'], { cwd: root });
  runGit(['config', 'user.name', 'repo-guard'], { cwd: root });
  mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  return root;
}

test('识别 Vue、脚本、样式、Markdown、JSON、别名和 public 静态图片引用', () => {
  const contents = new Map([
    ['src/pages/Home.vue', `
      <template><img src="@/assets/logo.png"><img :src="'/assets/public.png'"><img :src="require('../assets/required.png')"><img :srcset="ready ? '../assets/retina.png 2x' : '../assets/standard.png 1x'"></template>
      <script setup lang="ts">const icon = new URL('../assets/icon.svg', import.meta.url)</script>
      <style>.hero { background: url('../assets/background.png?inline') }</style>
    `],
    ['src/pages/theme.css', `.banner { background-image: url('../assets/banner.png#hero') }`],
    ['src/pages/assets.json', JSON.stringify({ empty: '../assets/configured.png' })],
    ['docs/readme.md', '![说明](../src/assets/document.png)'],
  ]);
  const entries = [
    ...contents.keys(),
    'src/assets/logo.png',
    'public/assets/public.png',
    'src/assets/icon.svg',
    'src/assets/background.png',
    'src/assets/required.png',
    'src/assets/retina.png',
    'src/assets/standard.png',
    'src/assets/banner.png',
    'src/assets/configured.png',
    'src/assets/document.png',
    'src/assets/unused.png',
  ];
  const result = analyze(entries, contents);
  assert.deepEqual(result.unusedPaths, ['src/assets/unused.png']);
});

test('默认扫描根目录 HTML 和 Markdown 中的 public 与文档图片引用', () => {
  const config = validateConfig(createStarterConfig());
  const contents = new Map([
    ['index.html', '<img src="/assets/logo.png">'],
    ['README.md', '![架构图](docs/assets/architecture.png)'],
  ]);
  const entries = [
    ...contents.keys(),
    'public/assets/logo.png',
    'docs/assets/architecture.png',
  ];
  assert.deepEqual(analyze(entries, contents, config).unusedPaths, []);
});

test('识别 import.meta.glob，并要求动态声明同时匹配真实源码与图片', () => {
  const config = configFixture();
  config.imageAssets.unused.dynamicReferences = [{
    sourcePatterns: ['src/pages/gallery.ts'],
    assetPatterns: ['src/assets/runtime/*.png'],
    reason: '后端只返回图片文件名，运行时按目录拼接',
  }];
  const contents = new Map([
    ['src/pages/gallery.ts', "const modules = import.meta.glob('../assets/gallery/*.png')"],
  ]);
  const entries = [
    ...contents.keys(),
    'src/assets/gallery/one.png',
    'src/assets/runtime/two.png',
  ];
  assert.deepEqual(analyze(entries, contents, config).unusedPaths, []);

  config.imageAssets.unused.dynamicReferences[0].sourcePatterns = ['src/pages/missing.ts'];
  assert.throws(
    () => analyze(entries, contents, config),
    (error) => error.code === 'unused-image-assets/stale-dynamic-reference',
  );
});

test('注释中的伪引用不掩盖无效图片，glob 排除项不会计为使用', () => {
  const contents = new Map([
    ['src/pages/gallery.ts', "const modules = import.meta.glob(['../assets/gallery/*.png', '!../assets/gallery/private*.png'])"],
    ['src/pages/theme.css', "/* background: url('../assets/comment.png') */\n.page { color: red; }"],
    ['src/pages/view.vue', '<template><!-- <img src="../assets/templateComment.png"> --></template>'],
  ]);
  const entries = [
    ...contents.keys(),
    'src/assets/gallery/public.png',
    'src/assets/gallery/privateOne.png',
    'src/assets/comment.png',
    'src/assets/templateComment.png',
  ];
  assert.deepEqual(analyze(entries, contents).unusedPaths, [
    'src/assets/gallery/privateOne.png',
    'src/assets/comment.png',
    'src/assets/templateComment.png',
  ]);
});

test('手动门禁全量报告未引用图片且 report 模式不阻断', () => {
  const config = configFixture({ action: 'report' });
  const root = path.join(TEST_ROOT, `manual-${Date.now()}`);
  mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'assets', 'used.png'), 'used');
  writeFileSync(path.join(root, 'src', 'assets', 'unused.png'), 'unused');
  writeFileSync(path.join(root, 'src', 'pages', 'home.ts'), "import logo from '../assets/used.png';");
  try {
    const files = [
      'src/assets/used.png',
      'src/assets/unused.png',
      'src/pages/home.ts',
    ].map((relative) => ({ relative, absolute: path.join(root, relative) }));
    files.push({
      relative: 'docs/not-selected.txt',
      absolute: path.join(root, 'docs', 'not-selected.txt'),
    });
    const plan = unusedImageAssetsGate.plan({ config, environment: 'manual', files, revision: null });
    const result = unusedImageAssetsGate.run({ root, config, plan });
    assert.equal(result.status, 'passed');
    assert.equal(result.metrics.currentUnused, 1);
    assert.equal(result.findings[0].severity, 'warning');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Git 增量门禁阻断新增未引用图片和删除最后一处引用，但放行存量债务', (context) => {
  const root = gitFixture(context);
  writeFileSync(path.join(root, 'src', 'assets', 'legacy.png'), 'legacy');
  writeFileSync(path.join(root, 'src', 'assets', 'used.png'), 'used');
  writeFileSync(path.join(root, 'src', 'pages', 'home.ts'), "import logo from '../assets/used.png';");
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 建立图片资源基线'], { cwd: root });
  const base = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();

  writeFileSync(path.join(root, 'src', 'assets', 'new.png'), 'new');
  writeFileSync(path.join(root, 'src', 'pages', 'home.ts'), 'export const page = true;');
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 制造新增图片债务'], { cwd: root });
  const head = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  const config = configFixture({ enforcement: 'changedFiles' });
  const plan = unusedImageAssetsGate.plan({
    config,
    environment: 'ci-full',
    files: [],
    revision: { base, head },
  });
  const result = unusedImageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'violation');
  assert.deepEqual(
    result.findings.map(({ location }) => location.path).sort(),
    ['src/assets/new.png', 'src/assets/used.png'],
  );
  assert.equal(result.findings.some(({ location }) => location.path === 'src/assets/legacy.png'), false);
});

test('Git 增量门禁分别使用基线与当前配置，阻断移除别名造成的新债务', (context) => {
  const root = gitFixture(context);
  const baselineConfig = rawConfigFixture({ enforcement: 'changedFiles' });
  writeFileSync(path.join(root, 'src', 'assets', 'logo.png'), 'logo');
  writeFileSync(path.join(root, 'src', 'pages', 'home.ts'), "import logo from '@/assets/logo.png';");
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(baselineConfig, null, 2)}\n`,
  );
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 建立别名引用基线'], { cwd: root });
  const base = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();

  const currentConfig = structuredClone(baselineConfig);
  currentConfig.imageAssets.unused.aliases = [];
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(currentConfig, null, 2)}\n`,
  );
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 移除图片别名映射'], { cwd: root });
  const head = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  const config = validateConfig(currentConfig);
  const plan = unusedImageAssetsGate.plan({
    config,
    environment: 'ci-full',
    files: [],
    revision: { base, head },
  });
  const result = unusedImageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].location.path, 'src/assets/logo.png');
});

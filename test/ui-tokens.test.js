import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import stylelint from 'stylelint';
import { DEFAULT_EXCEPTIONS_CONFIG, DEFAULT_UI_TOKENS_CONFIG } from '../src/config/defaults.js';
import { validateConfig } from '../src/config/configuration-validation.js';
import { validateUiTokenManifest } from '../src/config/ui-token-manifest-validation.js';
import { uiTokenGate } from '../src/gates/quality/ui-token-gate.js';
import { loadUiTokenManifest } from '../src/integrations/ui-tokens/manifest.js';
import {
  collectSassStyleFacts,
  sassVueStyleLineRanges,
} from '../src/integrations/ui-tokens/sass.js';
import { collectUnoCssFacts } from '../src/integrations/ui-tokens/unocss.js';
import { collectUnoCssConfigurationFacts } from '../src/integrations/ui-tokens/unocss-configuration.js';
import { inspectUiTokens } from '../src/policies/ui-tokens.js';
import { runQualityExecution } from '../src/orchestration/pre-commit/quality-runner.js';
import { runPreCommit } from '../src/orchestration/pre-commit/runner.js';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function manifest(sourceContent = 'export default {}\n') {
  return {
    version: 1,
    sources: [{ path: 'uno.config.ts', sha256: digest(sourceContent) }],
    tokens: [
      {
        id: 'color.brand',
        category: 'color',
        aliases: { sass: ['$color-brand'], unocss: ['bg-brand', 'text-brand'] },
      },
      {
        id: 'space.md',
        category: 'spacing',
        aliases: { sass: ['$space-md'], unocss: ['p-space-md', 'text-space-md'] },
      },
      {
        id: 'breakpoint.tablet',
        category: 'breakpoint',
        aliases: { sass: ['$breakpoint-tablet'], unocss: ['screen-tablet'] },
      },
      {
        id: 'icon.sm',
        category: 'icon-size',
        aliases: { sass: ['$icon-sm'], unocss: ['size-icon-sm'] },
      },
    ],
    shortcuts: [{ name: 'card-tokenized', expandsTo: ['bg-brand', 'p-space-md'] }],
  };
}

function policyConfig(overrides = {}) {
  return {
    ...DEFAULT_UI_TOKENS_CONFIG,
    enabled: true,
    adapters: {
      sass: { enabled: true },
      unocss: {
        ...DEFAULT_UI_TOKENS_CONFIG.adapters.unocss,
        enabled: true,
      },
    },
    exceptions: DEFAULT_EXCEPTIONS_CONFIG,
    ...overrides,
  };
}

function loadedManifest(value) {
  return {
    ...value,
    sources: value.sources.map((source) => ({ ...source, actualSha256: source.sha256 })),
  };
}

function fixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-ui-token-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

test('Manifest 严格校验类别、别名唯一性和来源文件路径', () => {
  const valid = validateUiTokenManifest(manifest());
  assert.equal(valid.tokens.length, 4);
  assert.deepEqual(valid.shortcuts[0].expandsTo, ['bg-brand', 'p-space-md']);

  const duplicate = manifest();
  duplicate.tokens[1].aliases.unocss.push('bg-brand');
  assert.throws(() => validateUiTokenManifest(duplicate), /unocss 别名 不得包含重复值/);

  const invalidSource = manifest();
  invalidSource.sources[0].path = 'config/*.ts';
  assert.throws(() => validateUiTokenManifest(invalidSource), /不得包含 glob/);

  const whitespaceAlias = manifest();
  whitespaceAlias.tokens[0].aliases.unocss = ['bg-brand text-brand'];
  assert.throws(() => validateUiTokenManifest(whitespaceAlias), /单个静态 UnoCSS token/);

  const variantAlias = manifest();
  variantAlias.tokens[0].aliases.unocss = ['hover:bg-brand'];
  assert.throws(() => validateUiTokenManifest(variantAlias), /不带 variant/);

  const collision = manifest();
  collision.shortcuts[0].name = 'bg-brand';
  assert.throws(() => validateUiTokenManifest(collision), /不得与 UnoCSS Token 别名重复/);

  const cycle = manifest();
  cycle.shortcuts = [
    { name: 'card-a', expandsTo: ['hover:card-b'] },
    { name: 'card-b', expandsTo: ['card-a'] },
  ];
  assert.throws(() => validateUiTokenManifest(cycle), /shortcuts 存在循环展开/);
});

test('Manifest 不得把自身列为来源文件', (context) => {
  const root = fixture(context);
  const value = manifest();
  value.sources = [{
    path: 'ui-tokens.manifest.json',
    sha256: '0'.repeat(64),
  }];
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );

  assert.throws(
    () => loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG),
    /不得把自身列为来源文件/,
  );
});

test('Manifest 来源指纹失效时产生阻断结果', (context) => {
  const root = fixture(context);
  const source = 'export default {}\n';
  writeFileSync(path.join(root, 'uno.config.ts'), source);
  const value = manifest('older source\n');
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );

  const loaded = loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG);
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loaded,
  });
  assert.deepEqual(result.violations.map(({ rule }) => rule), [
    'ui-token/stale-manifest',
  ]);
});

test('Sass 只允许类别匹配的 Token，并拒绝原始值和原始断点', () => {
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    sassFacts: [
      { type: 'declaration', path: 'src/a.scss', line: 1, column: 1, property: 'color', value: '$color-brand' },
      { type: 'declaration', path: 'src/a.scss', line: 2, column: 1, property: 'padding', value: '12px' },
      { type: 'declaration', path: 'src/a.scss', line: 3, column: 1, property: 'color', value: '$space-md' },
      { type: 'declaration', path: 'src/a.scss', line: 4, column: 1, property: 'margin', value: '$missing' },
      { type: 'responsive-rule', path: 'src/a.scss', line: 5, column: 1, name: 'media', value: '(min-width: 768px)' },
      { type: 'responsive-rule', path: 'src/a.scss', line: 6, column: 1, name: 'media', value: '(min-width: $breakpoint-tablet)' },
      { type: 'declaration', path: 'src/a.scss', line: 7, column: 1, property: 'width', selector: '.icon', value: '$icon-sm' },
      { type: 'declaration', path: 'src/a.scss', line: 8, column: 1, property: 'width', selector: '.card', value: '24px' },
      { type: 'declaration', path: 'src/a.scss', line: 9, column: 1, property: 'filter', selector: '.card', value: 'blur(2px)' },
      { type: 'declaration', path: 'src/a.scss', line: 10, column: 1, property: 'height', selector: '.icon', value: '24px' },
      { type: 'declaration', path: 'src/a.scss', line: 11, column: 1, property: 'padding', value: '$space-md2' },
      { type: 'declaration', path: 'src/a.scss', line: 12, column: 1, property: 'background', value: 'red' },
      { type: 'declaration', path: 'src/a.scss', line: 13, column: 1, property: 'font', value: 'italic 16px/1.5 Arial' },
      { type: 'declaration', path: 'src/a.scss', line: 14, column: 1, property: 'background', value: '$color-brand url("/red.png")' },
      { type: 'declaration', path: 'src/a.scss', line: 15, column: 1, property: 'inset-inline-start', value: '12px' },
      { type: 'declaration', path: 'src/a.scss', line: 16, column: 1, property: 'border-start-start-radius', value: '4px' },
      { type: 'declaration', path: 'src/a.scss', line: 17, column: 1, property: 'box-shadow', value: '0 0' },
      { type: 'declaration', path: 'src/a.scss', line: 18, column: 1, property: 'filter', value: 'drop-shadow(0 0)' },
    ],
  });

  assert.deepEqual(result.violations.map(({ rule }) => rule), [
    'ui-token/raw-value',
    'ui-token/category-mismatch',
    'ui-token/unknown-token',
    'ui-token/raw-value',
    'ui-token/raw-value',
    'ui-token/unknown-token',
    'ui-token/raw-value',
    'ui-token/raw-value',
    'ui-token/raw-value',
    'ui-token/raw-value',
    'ui-token/raw-value',
    'ui-token/raw-value',
  ]);
});

test('Sass 适配器沿用消费项目 Stylelint 配置提取声明和响应式事实', async (context) => {
  const root = fixture(context);
  const absolute = path.join(root, 'src/theme.scss');
  writeFileSync(path.join(root, 'stylelint.config.mjs'), 'export default { rules: {} };\n');
  writeFileSync(absolute, [
    '.card { color: $color-brand; padding: 12px; }',
    '@media (min-width: $breakpoint-tablet) { .card { margin: $space-md; } }',
  ].join('\n'));

  const facts = await collectSassStyleFacts({
    project: { stylelint },
    root,
    files: [absolute],
  });
  assert.deepEqual(facts.map(({ type }) => type), [
    'declaration',
    'declaration',
    'declaration',
    'responsive-rule',
  ]);
  assert.equal(facts.every(({ path: factPath }) => factPath === 'src/theme.scss'), true);
  assert.equal(facts.find(({ property }) => property === 'color').selector, '.card');
});

test('Sass 适配器只把 Vue 中显式声明的 scss 和 sass 样式块纳入语言范围', () => {
  const source = [
    '<style>.plain { color: red; }</style>',
    '<style lang="scss">.scss { color: red; }</style>',
    '<style lang="less">.less { color: red; }</style>',
    '<style lang="sass">.sass { color: red; }</style>',
  ].join('\n');
  const ranges = sassVueStyleLineRanges(source);

  assert.deepEqual(ranges, [
    { start: 2, end: 2 },
    { start: 4, end: 4 },
  ]);
});

test('UnoCSS 展开 class、Attributify、variant group 和 shortcut 后逐项检查', (context) => {
  const root = fixture(context);
  const relative = 'src/App.vue';
  const absolute = path.join(root, relative);
  writeFileSync(absolute, [
    '<template>',
    '  <main class="screen-tablet:hover:(bg-brand p-space-md) bg-[#fff] md:bg-brand text-space-md card-tokenized">',
    '    <UiIcon size="icon-sm" />',
    '    <div :class="`bg-${tone}`" />',
    '  </main>',
    '</template>',
  ].join('\n'));

  const facts = collectUnoCssFacts({
    root,
    files: [{ relative, absolute }],
    config: DEFAULT_UI_TOKENS_CONFIG.adapters.unocss,
  });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssFacts: facts,
  });

  assert.equal(facts.some(({ token }) => token === 'screen-tablet:hover:bg-brand'), true);
  assert.equal(facts.some(({ token }) => token === 'size-icon-sm'), false);
  assert.deepEqual(new Set(result.violations.map(({ rule }) => rule)), new Set([
    'ui-token/raw-value',
    'ui-token/unapproved-breakpoint',
    'ui-token/category-mismatch',
    'ui-token/unprovable-dynamic-usage',
  ]));
});

test('UnoCSS 不把文本对齐和非颜色背景、边框、轮廓 utility 纳入 Token 管理', () => {
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssFacts: [
      'text-center',
      'bg-cover',
      'border-solid',
      'border-2',
      'outline-none',
      'outline-2',
      'ring-inset',
      'divide-x-2',
      'decoration-2',
      'stroke-2',
      'fill-none',
    ].map((token, index) => ({
      type: 'utility',
      token,
      tagName: 'div',
      path: 'src/App.vue',
      line: index + 1,
      column: 1,
    })),
  });

  assert.deepEqual(result.violations, []);
});

test('UnoCSS 检查 HTML Attributify、负值、任意属性和派生断点，同时忽略非受管 opacity', (context) => {
  const root = fixture(context);
  const relative = 'src/index.html';
  const absolute = path.join(root, relative);
  writeFileSync(absolute, [
    '<main p="space-md" bg="[#fff]"',
    '  class="-mt-2 [color:red] bg-opacity-50 has-[a]:bg-brand lt-screen-tablet:bg-brand lt-md:bg-brand [@media(min-width:700px)]:bg-brand hover:(bg-[rgb(1,2,3)] p-space-md)">',
    '  <UiIcon size="icon-sm"></UiIcon>',
    '</main>',
  ].join('\n'));

  const facts = collectUnoCssFacts({
    root,
    files: [{ relative, absolute }],
    config: DEFAULT_UI_TOKENS_CONFIG.adapters.unocss,
  });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssFacts: facts,
  });

  assert.equal(facts.some(({ type, name }) => type === 'attributify' && name === 'p'), true);
  assert.deepEqual(result.violations.map(({ rule }) => rule), [
    'ui-token/raw-value',
    'ui-token/unknown-token',
    'ui-token/raw-value',
    'ui-token/unapproved-breakpoint',
    'ui-token/unapproved-breakpoint',
    'ui-token/raw-value',
  ]);
});

test('UnoCSS 动态检查覆盖负值和受控任意属性，但普通元素动态宽度不按图标尺寸治理', () => {
  const dynamicFact = (value, tagName, line) => ({
    type: 'dynamic',
    value,
    tagName,
    path: 'src/App.vue',
    line,
    column: 1,
  });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssFacts: [
      dynamicFact('-mt-${space}', 'div', 1),
      dynamicFact('[color:${tone}]', 'div', 2),
      dynamicFact('w-${size}', 'div', 3),
      dynamicFact('w-${size}', 'UiIcon', 4),
      dynamicFact('[border:${border}]', 'div', 5),
      dynamicFact('[opacity:${opacity}]', 'div', 6),
      dynamicFact('[width:${size}]', 'div', 7),
      dynamicFact('[width:${size}]', 'UiIcon', 8),
    ],
  });

  assert.deepEqual(result.violations.map(({ rule, line }) => [rule, line]), [
    ['ui-token/unprovable-dynamic-usage', 1],
    ['ui-token/unprovable-dynamic-usage', 2],
    ['ui-token/unprovable-dynamic-usage', 4],
    ['ui-token/unprovable-dynamic-usage', 5],
    ['ui-token/unprovable-dynamic-usage', 8],
  ]);
});

test('UnoCSS 只允许可枚举的 Vue 和 JSX class 绑定，且保留非受管动态前缀', (context) => {
  const root = fixture(context);
  const vueRelative = 'src/App.vue';
  const jsxRelative = 'src/Icon.tsx';
  writeFileSync(path.join(root, vueRelative), [
    '<template>',
    '  <div :class="active ? \'bg-brand\' : \'flex\'"></div>',
    '  <div :class="layoutClass"></div>',
    '  <div :class="`opacity-${opacity}`"></div>',
    '  <div :class="`sm:opacity-${opacity}`"></div>',
    '  <div :class="`screen-tablet:opacity-${opacity}`"></div>',
    '</template>',
  ].join('\n'));
  writeFileSync(path.join(root, jsxRelative), [
    'export function Icon({ className }) {',
    '  return <UiIcon className={className} />;',
    '}',
  ].join('\n'));

  const facts = collectUnoCssFacts({
    root,
    files: [vueRelative, jsxRelative],
    config: DEFAULT_UI_TOKENS_CONFIG.adapters.unocss,
  });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssFacts: facts,
  });

  assert.equal(facts.some(({ token }) => token === 'bg-brand'), true);
  assert.equal(facts.some(({ type, opaque }) => type === 'dynamic' && opaque === false), true);
  assert.deepEqual(result.violations.map(({ rule, path: findingPath }) => [
    rule,
    findingPath,
  ]), [
    ['ui-token/unprovable-dynamic-usage', vueRelative],
    ['ui-token/unapproved-breakpoint', vueRelative],
    ['ui-token/unprovable-dynamic-usage', jsxRelative],
  ]);
});

test('UnoCSS 配置中的 shortcut 必须与 Manifest 完全一致，且禁止自定义 rules', (context) => {
  const root = fixture(context);
  const configFile = path.join(root, 'uno.config.ts');
  writeFileSync(configFile, [
    "const config = defineConfig({",
    "  shortcuts: { 'card-tokenized': 'bg-brand p-space-md', rogue: 'bg-[#fff]' },",
    "  rules: [['rogue-rule', { color: '#fff' }]],",
    "  theme: { breakpoints: { 'screen-tablet': '768px', rogue: '900px' } },",
    '})',
    'export default config',
  ].join('\n'));
  const configurationFacts = collectUnoCssConfigurationFacts({
    root,
    files: ['uno.config.ts'],
  });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(manifest()),
    unocssConfigurationFacts: configurationFacts,
  });

  assert.deepEqual(configurationFacts.map(({ type }) => type), [
    'configuration-file',
    'shortcut-declaration',
    'shortcut-declaration',
    'custom-rule',
    'breakpoint-declaration',
    'breakpoint-declaration',
  ]);
  assert.deepEqual(result.violations.map(({ rule }) => rule), [
    'ui-token/unapproved-shortcut',
    'ui-token/unprovable-dynamic-usage',
    'ui-token/unapproved-breakpoint',
  ]);
});

test('UnoCSS 配置只信任官方基础 preset 和 variant-group transformer', (context) => {
  const root = fixture(context);
  const safeFile = path.join(root, 'uno.safe.config.ts');
  const unsafeFile = path.join(root, 'uno.unsafe.config.ts');
  writeFileSync(safeFile, [
    "import { presetWind3, transformerVariantGroup } from 'unocss';",
    'export default defineConfig({',
    "  presets: [presetWind3({ dark: 'class' })],",
    '  transformers: [transformerVariantGroup()],',
    '});',
  ].join('\n'));
  writeFileSync(unsafeFile, [
    "import { projectPreset } from './preset';",
    'export default defineConfig({',
    '  presets: [projectPreset()],',
    "  safelist: ['bg-[#fff]'],",
    '});',
  ].join('\n'));

  const safeFacts = collectUnoCssConfigurationFacts({ root, files: [safeFile] });
  const unsafeFacts = collectUnoCssConfigurationFacts({ root, files: [unsafeFile] });

  assert.deepEqual(safeFacts.map(({ type }) => type), ['configuration-file']);
  assert.deepEqual(unsafeFacts.map(({ type }) => type), [
    'configuration-file',
    'configuration-dynamic',
    'configuration-dynamic',
  ]);
});

test('UnoCSS 在 shortcut 尚未使用时也检查展开内容和配置双向一致性', () => {
  const value = manifest();
  value.shortcuts.push({ name: 'rogue-tokenized', expandsTo: ['bg-[#fff]'] });
  const result = inspectUiTokens({
    config: policyConfig(),
    manifest: loadedManifest(value),
    unocssConfigurationFacts: [
      { type: 'configuration-file', path: 'uno.config.ts', line: 1, column: 1 },
      {
        type: 'shortcut-declaration',
        name: 'card-tokenized',
        expandsTo: ['bg-brand', 'p-space-md'],
        path: 'uno.config.ts',
        line: 1,
        column: 1,
      },
    ],
  });

  assert.deepEqual(result.violations.map(({ rule }) => rule), [
    'ui-token/raw-value',
    'ui-token/unapproved-shortcut',
  ]);
});

test('UnoCSS 门禁对配置快照变更执行全量复查并返回结构化结果', async (context) => {
  const root = fixture(context);
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  const unoConfig = "export default { shortcuts: { 'card-tokenized': 'bg-brand p-space-md' } }\n";
  const sourceRelative = 'src/App.vue';
  const sourceAbsolute = path.join(root, sourceRelative);
  writeFileSync(path.join(root, 'uno.config.ts'), unoConfig);
  writeFileSync(sourceAbsolute, '<template><div class="bg-[#fff]" /></template>\n');
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(manifest(unoConfig), null, 2)}\n`,
  );
  const config = {
    uiTokens: policyConfig({
      adapters: {
        sass: { enabled: false },
        unocss: { ...DEFAULT_UI_TOKENS_CONFIG.adapters.unocss, enabled: true },
      },
    }),
    exceptions: DEFAULT_EXCEPTIONS_CONFIG,
  };
  const plan = uiTokenGate.plan({
    root,
    config,
    environment: 'pre-commit',
    files: [{ relative: 'uno.config.ts', absolute: path.join(root, 'uno.config.ts') }],
    changes: { entries: [{ path: 'uno.config.ts', status: 'modified' }] },
  });
  assert.equal(plan.files.some(({ relative }) => relative === sourceRelative), true);

  const result = await uiTokenGate.run({ root, config, plan });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'ui-token/raw-value');
});

test('UnoCSS 配置未纳入 Manifest 时返回策略问题而不是读取未受信文件', async (context) => {
  const root = fixture(context);
  mkdirSync(path.join(root, 'design'), { recursive: true });
  const tokenSource = '{"brand":"#123456"}\n';
  writeFileSync(path.join(root, 'design/tokens.json'), tokenSource);
  const value = manifest();
  value.sources = [{ path: 'design/tokens.json', sha256: digest(tokenSource) }];
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  const config = {
    uiTokens: policyConfig(),
    exceptions: DEFAULT_EXCEPTIONS_CONFIG,
  };
  const plan = uiTokenGate.plan({ root, config, files: [], changes: { entries: [] } });
  const result = await uiTokenGate.run({ root, config, plan });

  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'ui-token/untracked-unocss-config');
});

test('pre-commit 在 Manifest 来源位于源码范围外时仍执行 UI Token 契约检查', async (context) => {
  const root = fixture(context);
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  const unoConfig = "export default { shortcuts: { 'card-tokenized': 'bg-brand p-space-md' } }\n";
  const originalTokens = '{"brand":"#123456"}\n';
  mkdirSync(path.join(root, 'design'), { recursive: true });
  writeFileSync(path.join(root, 'uno.config.ts'), unoConfig);
  writeFileSync(path.join(root, 'design/tokens.json'), '{"brand":"#ffffff"}\n');
  const value = manifest(unoConfig);
  value.sources.push({
    path: 'design/tokens.json',
    sha256: digest(originalTokens),
  });
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  const config = validateConfig({
    version: 1,
    rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }],
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
    },
    uiTokens: {
      ...DEFAULT_UI_TOKENS_CONFIG,
      enabled: true,
      adapters: {
        sass: { enabled: false },
        unocss: { ...DEFAULT_UI_TOKENS_CONFIG.adapters.unocss, enabled: true },
      },
    },
  });

  const execution = await runQualityExecution({
    root,
    files: [path.join(root, 'design/tokens.json')],
    config,
  });

  assert.equal(execution.decisiveResult.gateId, 'quality.ui-tokens');
  assert.equal(execution.decisiveResult.findings[0].ruleId, 'ui-token/stale-manifest');
});

test('pre-commit 在只有删除项时仍按暂存快照阻断移除 Manifest 来源', async (context) => {
  const root = fixture(context);
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  const unoConfig = "export default { shortcuts: { 'card-tokenized': 'bg-brand p-space-md' } }\n";
  const tokenSource = '{"brand":"#123456"}\n';
  mkdirSync(path.join(root, 'design'), { recursive: true });
  writeFileSync(path.join(root, 'uno.config.ts'), unoConfig);
  writeFileSync(path.join(root, 'design/tokens.json'), tokenSource);
  const value = manifest(unoConfig);
  value.sources.push({ path: 'design/tokens.json', sha256: digest(tokenSource) });
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  const projectConfig = {
    version: 1,
    rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }],
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
    },
    uiTokens: {
      ...DEFAULT_UI_TOKENS_CONFIG,
      enabled: true,
      adapters: {
        sass: { enabled: false },
        unocss: { ...DEFAULT_UI_TOKENS_CONFIG.adapters.unocss, enabled: true },
      },
    },
  };
  validateConfig(projectConfig);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(projectConfig, null, 2)}\n`,
  );
  spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  const committed = spawnSync('git', [
    '-c', 'user.name=Repo Guard',
    '-c', 'user.email=repo-guard@example.com',
    'commit', '-m', '建立基线',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);

  rmSync(path.join(root, 'design/tokens.json'));
  spawnSync('git', ['add', '-u'], { cwd: root, encoding: 'utf8' });
  writeFileSync(path.join(root, 'design/tokens.json'), tokenSource);

  assert.equal(await runPreCommit(root), 1);
});

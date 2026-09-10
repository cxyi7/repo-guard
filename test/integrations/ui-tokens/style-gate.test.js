import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_EXCEPTIONS_CONFIG, DEFAULT_UI_TOKENS_CONFIG } from '../../../src/config/defaults.js';
import { uiTokenGate } from '../../../src/gates/quality/ui-token-gate.js';
import { defineExecutionPlan } from '../../../src/core/capability/execution-plan.js';
import { createGateRegistry } from '../../../src/core/capability/gate-registry.js';
import { renderGateResultConsole } from '../../../src/core/report/console-renderer.js';
import { renderGateResultJson } from '../../../src/core/report/json-renderer.js';
import { orchestratePlan } from '../../../src/orchestration/orchestrator.js';

const require = createRequire(import.meta.url);
const temporaryRoot = path.resolve('test/.tmp');
const sha256 = (source) => createHash('sha256').update(source).digest('hex');

function fixture(context, overrides = {}) {
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(path.join(temporaryRoot, 'ui-token-gate-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  const source = ':root { --color-brand: #123456; --space-md: 16px; }\n';
  writeFileSync(path.join(root, 'src/tokens.css'), source);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ui-token-test', type: 'module', devDependencies: { stylelint: '16.26.1' } }));
  writeFileSync(path.join(root, 'stylelint.config.cjs'), `module.exports = ${JSON.stringify({
    rules: {},
    overrides: [
      { files: ['**/*.scss'], customSyntax: require.resolve('postcss-scss') },
      { files: ['**/*.sass'], customSyntax: require.resolve('postcss-sass') },
      { files: ['**/*.less'], customSyntax: require.resolve('postcss-less') },
      { files: ['**/*.vue'], customSyntax: require.resolve('postcss-html') },
    ],
  })};\n`);
  const manifest = {
    version: 2,
    sources: [{ path: 'src/tokens.css', sha256: sha256(source) }],
    tokens: [
      { id: 'color.brand', category: 'color', aliases: { css: ['var(--color-brand)'], sass: ['$color-brand', 'theme.$color-brand'], less: ['@color-brand'] } },
      { id: 'spacing.md', category: 'spacing', aliases: { css: ['var(--space-md)'], sass: ['$space-md'], less: ['@space-md'] } },
      { id: 'breakpoint.md', category: 'breakpoint', aliases: { css: ['768px'], sass: ['$breakpoint-md'], less: ['@breakpoint-md'] } },
    ],
  };
  const config = {
    version: 2,
    checks: { uiTokens: { ...DEFAULT_UI_TOKENS_CONFIG, enabled: true, languages: ['css', 'sass', 'less'], ...overrides } },
    repository: { exceptions: DEFAULT_EXCEPTIONS_CONFIG },
  };
  const saveManifest = () => writeFileSync(path.join(root, config.checks.uiTokens.manifestFile), JSON.stringify(manifest));
  saveManifest();
  return {
    root, config, manifest, saveManifest,
    write(file, code) { writeFileSync(path.join(root, file), code); },
    plan(files = [], changes = [], configurationChanged = false) {
      return uiTokenGate.plan({ root, config, files, changes: { entries: changes }, configurationChanged });
    },
    async run(files = [], changes = [], configurationChanged = false) {
      const plan = uiTokenGate.plan({ root, config, files, changes: { entries: changes }, configurationChanged });
      return await uiTokenGate.run({ root, config, plan });
    },
  };
}

test('门禁使用消费项目 Stylelint 检查四种文件并允许跨语言 CSS 变量引用', async (context) => {
  const project = fixture(context);
  const samples = {
    'src/page.css': '.card { color: var(--color-brand); padding: var(--space-md); }',
    'src/page.scss': '.card { color: $color-brand; padding: var(--space-md); }',
    'src/page.sass': '.card\n  color: $color-brand\n  padding: var(--space-md)\n',
    'src/page.less': '.card { color: @color-brand; padding: var(--space-md); }',
  };
  for (const [file, code] of Object.entries(samples)) project.write(file, code);
  const result = await project.run(Object.keys(samples));
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.checkedFiles, 4);
  assert.equal(result.metrics.checkedStyleFacts, 8);
  for (const [file, code] of Object.entries(samples)) assert.equal(readFileSync(path.join(project.root, file), 'utf8'), code);
});

test('来源或配置改变时全量复查应用样式，同时继续遵守 exclude', async (context) => {
  const project = fixture(context, { exclude: ['src/excluded.css'] });
  project.write('src/page.css', '.card { color: red; }');
  project.write('src/excluded.css', '.card { color: red; }');
  for (const trigger of ['src/tokens.css', 'ui-tokens.manifest.json', 'custom-project.json']) {
    const plan = project.plan([trigger], [{ path: trigger, status: 'M' }], trigger === 'custom-project.json');
    assert.equal(plan.files.some(({ relative }) => relative === 'src/page.css'), true);
    assert.equal(plan.files.some(({ relative }) => relative === 'src/excluded.css'), false);
    const result = await uiTokenGate.run({ root: project.root, config: project.config, plan });
    assert.equal(result.status, 'violation');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, 'ui-token/raw-value');
  }
});

test('授权来源内变量定义允许，但同文件普通样式声明仍需遵守 Token', async (context) => {
  const project = fixture(context);
  const source = ':root { --color-brand: red; }\n.card { color: blue; }';
  project.write('src/tokens.css', source);
  project.manifest.sources[0].sha256 = sha256(source);
  project.saveManifest();
  const result = await project.run(['src/tokens.css']);
  assert.equal(result.status, 'violation');
  assert.deepEqual(result.findings.map(({ ruleId }) => ruleId), ['ui-token/raw-value']);
});

test('CSS、Sass 模块变量和 Less 不得在组件内覆盖已登记定义', async (context) => {
  const project = fixture(context);
  project.write('src/page.css', '.card { --color-brand: red; color: var(--color-brand); }');
  project.write('src/page.scss', 'theme.$color-brand: red; .card { color: theme.$color-brand; }');
  project.write('src/page.less', '@color-brand: red; .card { color: @color-brand; }');
  const result = await project.run(['src/page.css', 'src/page.scss', 'src/page.less']);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 3);
  assert.equal(result.findings.every(({ ruleId }) => ruleId === 'ui-token/unapproved-definition'), true);
});

test('组件参数和循环不得遮蔽团队变量，授权来源中的绑定允许', async (context) => {
  const project = fixture(context);
  const sass = '@mixin card($color-brand: red) { color: $color-brand; }\n@for $space-md from 1 through 3 { .card { padding: $space-md; } }';
  const less = '.card(@color-brand: red) { color: @color-brand; }';
  project.write('src/page.scss', sass);
  project.write('src/page.less', less);
  const result = await project.run(['src/page.scss', 'src/page.less']);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 3);
  assert.equal(result.findings.every(({ ruleId }) => ruleId === 'ui-token/unapproved-definition'), true);
  project.manifest.sources.push({ path: 'src/page.scss', sha256: sha256(sass) }, { path: 'src/page.less', sha256: sha256(less) });
  project.saveManifest();
  assert.equal((await project.run(['src/page.scss', 'src/page.less'])).status, 'passed');
});

test('原生 CSS 断点只接受清单允许值', async (context) => {
  const project = fixture(context);
  project.write('src/page.css', '@media (min-width: 768px) { .card { color: var(--color-brand); } }');
  assert.equal((await project.run(['src/page.css'])).status, 'passed');
  project.write('src/page.css', '@media (min-width: 769px) { .card { color: var(--color-brand); } }');
  assert.equal((await project.run(['src/page.css'])).findings[0].ruleId, 'ui-token/unapproved-breakpoint');
});

test('仅删除或改名来源也会阻断，不能被空样式文件清单跳过', async (context) => {
  const project = fixture(context);
  for (const change of [
    { status: 'D', path: 'src/tokens.css' },
    { status: 'R100', oldPath: 'src/tokens.css', path: 'src/renamed.css' },
  ]) {
    const result = await project.run([], [change]);
    assert.equal(result.status, 'violation');
    assert.equal(result.findings[0].ruleId, 'ui-token/stale-manifest');
  }
});

test('只含不支持的 Vue 样式块时不计为已检查样式文件', async (context) => {
  const project = fixture(context);
  project.write('src/App.vue', '<template><div /></template><style lang="stylus">color red</style>');
  const result = await project.run(['src/App.vue']);
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.checkedFiles, 0);
});

test('真实样式解析失败保留配置错误与标准第三方诊断，不被 GateResult 校验覆盖', async (context) => {
  const project = fixture(context);
  project.write('src/broken.css', '.card { color: red;');
  const execution = await orchestratePlan({
    registry: createGateRegistry([uiTokenGate]),
    plan: defineExecutionPlan({
      id: 'manual:ui-token-parse-regression',
      environment: 'manual',
      steps: [{ id: uiTokenGate.id, gateId: uiTokenGate.id, mutation: 'read-only' }],
    }),
    context: { root: project.root, config: project.config, files: ['src/broken.css'], changes: { entries: [] } },
  });
  assert.equal(execution.status, 'configuration-error');
  assert.equal(execution.exitCode, 1);
  const result = execution.results[0];
  assert.equal(result.error.code, 'ui-token/style-parse-failed');
  assert.match(result.summary, /无法完整解析样式文件/);
  assert.ok(result.diagnostics.some(({ source, stream, level, message, redacted }) => (
    source === 'stylelint' && stream === 'stderr' && level === 'error'
    && message.includes('CssSyntaxError') && message.includes('broken.css') && redacted
  )));
  const report = renderGateResultJson(result);
  const output = renderGateResultConsole(result).map(({ message }) => message).join('\n');
  assert.equal(report.status, 'configuration-error');
  assert.match(output, /第三方原始诊断（stylelint stderr）/);
  assert.doesNotMatch(JSON.stringify(report.error), /Unclosed block/);
  assert.ok(!JSON.stringify(report).includes(project.root.replaceAll('\\', '/')));
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import stylelint from 'stylelint';
import { collectStyleFacts, isUiTokenStyleFile } from '../../../src/integrations/ui-tokens/styles.js';

const require = createRequire(import.meta.url);
const temporaryRoot = path.resolve('test/.tmp');

function fixture(context, { configureSyntax = true } = {}) {
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(path.join(temporaryRoot, 'ui-token-styles-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const overrides = configureSyntax ? [
    { files: ['**/*.scss'], customSyntax: require.resolve('postcss-scss') },
    { files: ['**/*.sass'], customSyntax: require.resolve('postcss-sass') },
    { files: ['**/*.less'], customSyntax: require.resolve('postcss-less') },
    { files: ['**/*.vue'], customSyntax: require.resolve('postcss-html') },
  ] : [];
  writeFileSync(path.join(root, 'stylelint.config.cjs'), `module.exports = ${JSON.stringify({ rules: {}, overrides })};\n`);
  return {
    root,
    write(file, source) {
      const absolute = path.join(root, file);
      writeFileSync(absolute, source);
      return absolute;
    },
    async facts(file, source, languages = ['css', 'sass', 'less']) {
      const absolute = path.join(root, file);
      writeFileSync(absolute, source);
      return await collectStyleFacts({ project: { stylelint }, root, files: [absolute], languages });
    },
  };
}

const samples = [
  { file: 'page.css', language: 'css', source: ':root { --color-brand: #123456; }\n.card { color: var(--color-brand); }', variable: '--color-brand', value: 'var(--color-brand)' },
  { file: 'page.scss', language: 'sass', source: '$color-brand: #123456;\n.card { color: $color-brand; }', variable: '$color-brand', value: '$color-brand' },
  { file: 'page.sass', language: 'sass', source: '$color-brand: #123456\n.card\n  color: $color-brand\n', variable: '$color-brand', value: '$color-brand' },
  { file: 'page.less', language: 'less', source: '@color-brand: #123456;\n.card { color: @color-brand; }', variable: '@color-brand', value: '@color-brand' },
];

for (const sample of samples) {
  test(`${sample.file} 使用项目真实解析器保留变量定义和原始引用`, async (context) => {
    const project = fixture(context);
    const facts = await project.facts(sample.file, sample.source);
    assert.deepEqual(facts.map(({ type, language }) => ({ type, language })).sort((left, right) => left.type.localeCompare(right.type)), [
      { type: 'variable-definition', language: sample.language },
      { type: 'declaration', language: sample.language },
    ].sort((left, right) => left.type.localeCompare(right.type)));
    const definition = facts.find(({ type }) => type === 'variable-definition');
    const declaration = facts.find(({ type }) => type === 'declaration');
    assert.equal(definition.name, sample.variable);
    assert.equal(definition.value, '#123456');
    assert.equal(declaration.value, sample.value);
    assert.equal(declaration.path, sample.file);
    assert.equal(declaration.selector, '.card');
  });
}

test('Vue 同行多样式块按精确位置区分语言且不读取脚本或模板样式文本', async (context) => {
  const project = fixture(context);
  const source = [
    '<template><div style="color: red">{{ "padding: 999px" }}</div></template>',
    '<script>const example = "<style>.fake { color: red }</style>";</script>',
    '<style>.plain { color: var(--color-brand) }</style><style lang="scss">.scss { padding: $space-md }</style>',
    '<style lang="less">.less { margin: @space-md }</style>',
    '<style lang="sass">\n.sass\n  padding: $space-md\n</style>',
    '<style lang="stylus">intentionally invalid unsupported {;</style>',
  ].join('\n');
  const facts = await project.facts('App.vue', source);
  assert.deepEqual(facts.map(({ language, property, selector }) => ({ language, property, selector })), [
    { language: 'css', property: 'color', selector: '.plain' },
    { language: 'sass', property: 'padding', selector: '.scss' },
    { language: 'less', property: 'margin', selector: '.less' },
    { language: 'sass', property: 'padding', selector: '.sass' },
  ]);
  assert.equal(facts[0].line, 3);
  assert.equal(facts[1].line, 3);
  assert.equal(facts[1].column > facts[0].column, true);
  assert.equal(facts[3].line, 7);
});

test('只选择 CSS 时不解析 Sass 或 Less 样式块，也不选择独立非 CSS 文件', async (context) => {
  const project = fixture(context);
  const facts = await project.facts('App.vue', '<style>.card { color: var(--color-brand) }</style><style lang="less">invalid ;; {</style>', ['css']);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].language, 'css');
  assert.equal(isUiTokenStyleFile(project.write('page.less', '@brand: red;'), ['css']), false);
  assert.equal(isUiTokenStyleFile(project.write('OnlyStylus.vue', '<style lang="stylus">color red</style>'), ['css', 'sass', 'less']), false);
});

test('CSS @property 与媒体查询保留定义和响应规则事实', async (context) => {
  const project = fixture(context);
  const facts = await project.facts('page.css', '@property --color-brand { syntax: "<color>"; inherits: false; initial-value: red; }\n@media (min-width: 768px) { .card { color: var(--color-brand); } }');
  assert.equal(facts.find(({ type }) => type === 'variable-definition').name, '--color-brand');
  assert.equal(facts.find(({ type }) => type === 'responsive-rule').value, '(min-width: 768px)');
});

test('Sass 模块变量赋值仍然属于变量定义', async (context) => {
  const project = fixture(context);
  const facts = await project.facts('page.scss', 'theme.$color-brand: red;\n.card { color: theme.$color-brand; }');
  assert.equal(facts.find(({ type }) => type === 'variable-definition').name, 'theme.$color-brand');
});

test('动态 CSS 自定义属性和 @property 声明保留动态名称供策略阻断', async (context) => {
  const project = fixture(context);
  const sassFacts = await project.facts('page.scss', '.card { --#{$name}: red; }\n@property --#{$name} { initial-value: red; }');
  const lessFacts = await project.facts('page.less', '.card { --@{name}: red; }');
  assert.equal(sassFacts.filter(({ type, name }) => type === 'variable-definition' && name === '--#{$name}').length, 2);
  assert.equal(lessFacts.find(({ type }) => type === 'variable-definition').name, '--@{name}');
});

test('Sass 参数与循环绑定会取证，不把嵌套默认值引用误当成定义', async (context) => {
  const project = fixture(context);
  const facts = await project.facts('page.scss', [
    '@mixin card($color-brand: red, $safe: rgba($other-brand, .5)) { color: $color-brand; }',
    '@function space($space-md) { @return $space-md; }',
    '@each $name, $color-brand in $palette { .card { color: $color-brand; } }',
    '@for $space-md from 1 through 3 { .card { padding: $space-md; } }',
  ].join('\n'));
  assert.deepEqual(facts.filter(({ type }) => type === 'variable-definition').map(({ name }) => name), [
    '$color-brand', '$safe', '$space-md', '$name', '$color-brand', '$space-md',
  ]);
});

test('Less 参数绑定不会把参数默认值中的变量引用误当成定义', async (context) => {
  const project = fixture(context);
  const facts = await project.facts('page.less', '.card(@color-brand: red; @safe: rgba(@other-brand, .5)) { color: @color-brand; }');
  assert.deepEqual(facts.filter(({ type }) => type === 'variable-definition').map(({ name }) => name), ['@color-brand', '@safe']);
});

test('Stylelint 禁用注释与忽略文件不能绕过只读 Token 取证', async (context) => {
  const project = fixture(context);
  writeFileSync(path.join(project.root, '.stylelintignore'), '*.css\n');
  const facts = await project.facts('page.css', '/* stylelint-disable */\n.card { color: red; }');
  assert.equal(facts.find(({ property }) => property === 'color').value, 'red');
});

test('未配置非 CSS 解析器时明确失败，不能用默认 CSS 解析器静默通过', async (context) => {
  const project = fixture(context, { configureSyntax: false });
  await assert.rejects(project.facts('page.scss', '.card { color: $brand }'), { code: 'ui-token/missing-style-syntax' });
});

test('语法解析错误必须阻断而不是返回空事实', async (context) => {
  const project = fixture(context);
  await assert.rejects(project.facts('page.css', '.card { color: red;'), { code: 'ui-token/style-parse-failed' });
});

test('Vue CSS 语法错误不能被宽松解析器静默修复后放行', async (context) => {
  const project = fixture(context);
  await assert.rejects(project.facts('App.vue', '<style>.card { color: red;</style>'), { code: 'ui-token/style-parse-failed' });
});

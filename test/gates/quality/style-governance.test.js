import assert from 'node:assert/strict';
import test from 'node:test';
import { styleFixture } from '../../helpers/stylelint.js';

test('预处理器插值可解析，混合 Vue 语言明确拒绝', async (t) => {
  const f = styleFixture(t);
  f.write('src/theme.module.scss', '$name: card; .#{$name} { color: red; }');
  f.write('src/theme.module.less', '@name: card; .@{name} { color: red; }');
  f.write(
    'src/mixed.vue',
    '<template><div /></template><style scoped lang="scss">$name: card; .#{$name} { color: red; }</style><style scoped>.a{color:blue}</style>',
  );
  assert.equal(
    (await f.run(['src/theme.module.scss', 'src/theme.module.less'])).status,
    'passed',
  );
  await assert.rejects(
    () => f.run(['src/mixed.vue']),
    (error) => error.code === 'stylelint/multiple-vue-style-languages',
  );
});

test('真实 Vue 解析发现未隔离样式与全局逃逸', async (t) => {
  const f = styleFixture(t);
  f.write(
    'src/panel.vue',
    '<template><div /></template><style>.a {color:red}</style><style scoped>.a :global(body) {margin:0}</style>',
  );
  const result = await f.run(['src/panel.vue']);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 2);
});
test('真实解析不把属性值及声明字符串里的 global 当成选择器', async (t) => {
  const f = styleFixture(t);
  f.write(
    'src/panel.vue',
    `<template><div /></template><style scoped>.a[data-text=":global(body)"] {content: ":global(html)"}</style>`,
  );
  assert.equal((await f.run(['src/panel.vue'])).status, 'passed');
});
test('CSS Modules 的两种全局逃逸都被检测', async (t) => {
  const f = styleFixture(t);
  for (const selector of [':global(.a)', ':global .a']) {
    f.write('src/panel.module.css', selector + ' {color:red}');
    assert.equal((await f.run(['src/panel.module.css'])).status, 'violation');
  }
});
test('真实 scoped、module 和批准全局目录正常通过', async (t) => {
  const f = styleFixture(t);
  f.write(
    'src/a.vue',
    '<template><div /></template><style scoped>.a{color:red}</style><style module>.b{color:blue}</style>',
  );
  f.write('styles/reset.css', 'body{margin:0}');
  f.write('src/b.module.scss', '.b{color:red}');
  assert.equal(
    (await f.run(['src/a.vue', 'styles/reset.css', 'src/b.module.scss']))
      .status,
    'passed',
  );
});
test('项目可修改全局目录，根 styles 不被硬编码', async (t) => {
  const f = styleFixture(t);
  f.write('theme/base.less', '@color: red; .a { color: @color; }');
  assert.equal((await f.run(['theme/base.less'])).status, 'violation');
  assert.equal(
    (
      await f.run(['theme/base.less'], {
        governance: { enabled: true, allowedGlobalStylePatterns: ['theme/**'] },
      })
    ).status,
    'passed',
  );
});
test('关闭治理仅停止扩展，不关闭正常 Stylelint 规则', async (t) => {
  const f = styleFixture(t);
  f.write('src/a.css', '.a {}');
  const result = await f.run(['src/a.css'], { governance: { enabled: false } });
  assert.equal(result.status, 'violation');
  assert.ok(
    result.findings.every(
      (f) => f.ruleId !== 'style/no-unexpected-global-style',
    ),
  );
});
test('Vue 源码语法失败不能变成通过', async (t) => {
  const f = styleFixture(t);
  f.write(
    'src/a.vue',
    '<template><div></template><style scoped>.a{color:red}</style>',
  );
  await assert.rejects(
    () => f.run(['src/a.vue']),
    (e) => e.kind === 'configuration',
  );
});

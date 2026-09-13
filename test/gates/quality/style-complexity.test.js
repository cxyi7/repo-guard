import assert from 'node:assert/strict';
import test from 'node:test';
import { styleFixture } from '../../helpers/stylelint.js';
import { frontendToolOptions } from '../../../src/profiles/frontend-tool-presets.js';

test('完整预设实际检查 CSS 权重与自定义属性，Vue 不套用 CSS 权重', async (t) => {
  const f = styleFixture(t);
  const options = frontendToolOptions('stylelint', {
    role: 'frontend',
    stack: 'node',
    preset: 'vue-typescript',
  });
  f.write('styles/site.css', '.a.b.c.d {\n  color: red;\n}\n');
  const css = await f.run(['styles/site.css'], { options });
  assert.ok(
    css.findings.some(
      (finding) => finding.ruleId === 'style/selector-max-specificity',
    ),
  );
  f.write(
    'src/site.vue',
    '<template><div /></template><style scoped>.a.b.c.d {\n  color: red;\n}\n</style>',
  );
  assert.equal((await f.run(['src/site.vue'], { options })).status, 'passed');
  f.write(
    'styles/site.css',
    ':root {\n  --theme: red;\n  --theme: blue;\n}\n.a {\n  color: --theme;\n}\n',
  );
  const variables = await f.run(['styles/site.css'], { options });
  for (const rule of [
    'custom-property-no-missing-var-function',
    'declaration-block-no-duplicate-custom-properties',
  ])
    assert.ok(
      variables.findings.some(
        (finding) => finding.ruleId === 'stylelint/' + rule,
      ),
    );
});

test('真实 Stylelint 检测复杂度且每条规则只报告一次', async (t) => {
  const f = styleFixture(t);
  f.write('styles/site.css', '.a .b .c .d { color: red; }');
  const result = await f.run(['styles/site.css'], {
    options: { rules: { 'selector-max-compound-selectors': 3 } },
  });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 1);
  assert.equal(
    result.findings[0].ruleId,
    'style/selector-max-compound-selectors',
  );
});
test('真实原生规则优先于默认值，规则参数整体替换', async (t) => {
  const f = styleFixture(t);
  f.write('styles/site.css', '.a .b .c .d { color: red; }');
  f.write(
    'stylelint.config.mjs',
    'export default { rules: {"selector-max-compound-selectors":null} };',
  );
  const result = await f.run(['styles/site.css'], {
    options: { rules: { 'selector-max-compound-selectors': 3 } },
  });
  assert.equal(result.status, 'passed');
});
test('真实项目忽略文件不作为已检查通过证据', async (t) => {
  const f = styleFixture(t);
  f.write('styles/site.css', '.a .b .c .d { color: red; }');
  f.write(
    'stylelint.config.mjs',
    'export default { ignoreFiles:["**/site.css"], rules: {"block-no-empty":true} };',
  );
  assert.equal((await f.run(['styles/site.css'])).status, 'skipped');
});
test('真实无效规则选项保留配置错误', async (t) => {
  const f = styleFixture(t);
  f.write('styles/site.css', '.a { color: red; }');
  await assert.rejects(
    () =>
      f.run(['styles/site.css'], {
        options: { rules: { 'selector-max-id': -1 } },
      }),
    (e) => e.kind === 'configuration',
  );
});
test('用户修改复杂度阈值后按实际值检查', async (t) => {
  const f = styleFixture(t);
  f.write('styles/site.scss', '.a { .b { .c { color:red; } } }');
  assert.equal(
    (
      await f.run(['styles/site.scss'], {
        options: { ...f.options, rules: { 'max-nesting-depth': 1 } },
      })
    ).status,
    'violation',
  );
  assert.equal(
    (
      await f.run(['styles/site.scss'], {
        options: { ...f.options, rules: { 'max-nesting-depth': 2 } },
      })
    ).status,
    'passed',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectUiTokens } from '../../src/policies/ui-tokens.js';
import { loadedManifest, policyConfig, TOKEN_CASES, tokenManifest } from '../helpers/ui-tokens.js';

function fact(language, property, value, options = {}) {
  return { type: 'declaration', path: `src/view.${language === 'sass' ? 'scss' : language}`,
    line: 1, column: 1, language, selector: '.icon', property, value, ...options };
}

function inspect(styleFacts, manifest = loadedManifest(), config = policyConfig()) {
  return inspectUiTokens({ config, manifest, styleFacts });
}

for (const language of ['css', 'sass', 'less']) {
  test(`${language} 的十二类样式允许已登记值，阻断原始值`, () => {
    const manifest = loadedManifest();
    for (const [index, [, category, property, raw]] of TOKEN_CASES.entries()) {
      const reference = manifest.tokens[index].aliases[language][0];
      const isBreakpoint = category === 'breakpoint';
      const good = fact(language, property, isBreakpoint ? `(min-width: ${reference})` : reference,
        isBreakpoint ? { type: 'responsive-rule', name: 'media' } : {});
      assert.deepEqual(inspect([good]).violations, [], `${language} ${category}`);
      const bad = { ...good, value: isBreakpoint ? `(min-width: ${raw})` : raw };
      assert.equal(inspect([bad]).violations.length, 1, `${language} ${category} 原始值`);
    }
  });

  test(`${language} 拒绝类别错配、未登记引用和计算绕过`, () => {
    const manifest = loadedManifest();
    const space = manifest.tokens[1].aliases[language][0];
    const missing = language === 'css' ? 'var(--missing)' : `${language === 'sass' ? '$' : '@'}missing`;
    assert.equal(inspect([fact(language, 'color', space)]).violations[0].rule, 'ui-token/category-mismatch');
    assert.equal(inspect([fact(language, 'padding', missing)]).violations[0].rule, 'ui-token/unknown-token');
    assert.equal(inspect([fact(language, 'padding', `calc(${space} + 1px)`)]).violations[0].rule, 'ui-token/raw-value');
    assert.equal(inspect([fact(language, 'background', `linear-gradient(${missing}, transparent)`)]).violations.length, 1);
  });

  test(`${language} 图标尺寸限定于指定选择器，保留中性常量和非受控属性`, () => {
    assert.deepEqual(inspect([
      fact(language, 'padding', '0 auto'),
      fact(language, 'box-shadow', 'none'),
      fact(language, 'width', '24px', { selector: '.card' }),
      fact(language, 'width', '24px', { selector: '.iconography' }),
      fact(language, 'opacity', '0.5'),
      fact(language, 'border', '1px solid transparent'),
      fact(language, 'background', 'url("/images/red.png")'),
    ]).violations, []);
    assert.equal(inspect([fact(language, 'width', '24px', { selector: 'button.icon:hover' })]).violations.length, 1);
  });

  test(`${language} 变量只允许在清单来源定义，不允许组件覆盖`, () => {
    const name = language === 'css' ? '--color-brand' : `${language === 'sass' ? '$' : '@'}color-brand`;
    const definition = fact(language, '', '#fff', { type: 'variable-definition', name });
    assert.equal(inspect([definition]).violations[0].rule, 'ui-token/unapproved-definition');
    assert.deepEqual(inspect([{ ...definition, path: 'design/tokens.json' }]).violations, []);
    assert.deepEqual(inspect([{ ...definition, name: `${name}-local` }]).violations, []);
  });
}

test('CSS var 支持空白及跨语言引用，拒绝 fallback 和相似名称', () => {
  for (const language of ['css', 'sass', 'less']) {
    assert.deepEqual(inspect([fact(language, 'color', 'var( --color-brand )')]).violations, []);
    assert.equal(inspect([fact(language, 'border-radius', 'var(--color-brand)')]).violations[0].rule, 'ui-token/category-mismatch');
    for (const value of ['var(--color-brand, #fff)', 'var(--color-brand2)', 'var(--color-brand, var(--space-md))']) {
      assert.equal(inspect([fact(language, 'color', value)]).violations.length, 1, value);
    }
  }
});

test('CSS 断点按完整值匹配，禁止 var、计算、负数及前缀伪装', () => {
  for (const value of ['1768px', '-768px', '768px2', 'calc(768px + 1px)', 'var(--breakpoint-tablet)']) {
    assert.equal(inspect([fact('css', '', `(min-width: ${value})`, {
      type: 'responsive-rule', name: 'media',
    })]).violations.length, 1, value);
  }
  assert.deepEqual(inspect([fact('css', '', 'screen and (orientation: landscape)', {
    type: 'responsive-rule', name: 'media',
  })]).violations, []);
});

test('Sass 和 Less 断点不自动接受 CSS 数值清单，支持独立完整表达式别名', () => {
  for (const language of ['sass', 'less']) {
    assert.equal(inspect([fact(language, '', '(min-width: 768px)', {
      type: 'responsive-rule', name: 'media',
    })]).violations[0].rule, 'ui-token/unapproved-breakpoint');
  }
  const manifest = tokenManifest();
  manifest.tokens[1].aliases.sass = ['map.get($spacing, "md")'];
  assert.deepEqual(inspect([fact('sass', 'padding', 'map.get($spacing, "md")')], loadedManifest(manifest)).violations, []);
  assert.equal(inspect([fact('sass', 'padding', '$space-md2')]).violations[0].rule, 'ui-token/unknown-token');
  assert.equal(inspect([fact('sass', 'color', 'other.$color-brand')]).violations.length, 1);
});

test('Sass/Less 动态表达式阻断，关闭的语言不参与检查', () => {
  assert.equal(inspect([fact('sass', 'padding', '#{$space-md}px')]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
  assert.equal(inspect([fact('less', 'color', '@@name')]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
  assert.deepEqual(inspect([fact('less', 'color', '#fff')], loadedManifest(), policyConfig({ languages: ['css'] })).violations, []);
  assert.equal(inspect([fact('sass', '#{$property}', 'red')]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
  assert.equal(inspect([fact('less', '@{property}', 'red')]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
  assert.equal(inspect([fact('sass', '', 'red', { type: 'variable-definition', name: '--#{$name}' })]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
  assert.equal(inspect([fact('less', '', 'red', { type: 'variable-definition', name: '--@{name}' })]).violations[0].rule, 'ui-token/unprovable-dynamic-usage');
});

test('简写不允许颜色计算、转义字面量和系统颜色绕过', () => {
  for (const [language, value] of [
    ['sass', 'darken($color-brand, 10%)'], ['less', 'lighten(@color-brand, 10%)'],
    ['sass', 'unquote("red")'], ['css', 'Canvas'], ['css', String.raw`r\65 d`],
  ]) assert.equal(inspect([fact(language, 'background', value)]).violations.length, 1, value);
  assert.deepEqual(inspect([fact('css', 'background', 'linear-gradient(var(--color-brand), transparent)')]).violations, []);
});

test('Sass 模块变量引用及覆盖保留命名空间，不能用其他模块同名变量替代', () => {
  const manifest = tokenManifest();
  manifest.tokens[0].aliases.sass = ['theme.$brand'];
  assert.deepEqual(inspect([fact('sass', 'color', 'theme.$brand')], loadedManifest(manifest)).violations, []);
  assert.equal(inspect([fact('sass', 'color', 'other.$brand')], loadedManifest(manifest)).violations[0].rule, 'ui-token/unknown-token');
  assert.equal(inspect([fact('sass', '', 'red', { type: 'variable-definition', name: 'theme.$brand' })], loadedManifest(manifest)).violations[0].rule, 'ui-token/unapproved-definition');
});

test('Token 例外必须与规则、文件和位置精确匹配', () => {
  const days = (count) => new Date(Date.now() + count * 86400000).toISOString().slice(0, 10);
  const config = policyConfig({ exceptions: { warningDays: 14, maxDays: 90, entries: [{
    id: 'temporary-token-value', rule: 'ui-token/raw-value', path: 'src/view.css', line: 1, column: 1,
    reason: '设计变量调整期间保留该位置', owner: '前端团队', approvedBy: '项目负责人',
    ticket: 'UI-12', createdOn: days(-1), expiresOn: days(10),
  }] } });
  const result = inspect([fact('css', 'color', '#fff'), fact('css', 'color', '#fff', { line: 2 })], loadedManifest(), config);
  assert.equal(result.approved.length, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].line, 2);
});

test('来源指纹失效和删除均产生结构化阻断信息', () => {
  const manifest = loadedManifest();
  manifest.sources[0].actualSha256 = 'f'.repeat(64);
  const result = inspectUiTokens({ config: policyConfig(), manifest, deletedContractPaths: ['design/tokens.json'] });
  assert.equal(result.violations.length, 2);
  assert.ok(result.violations.every(({ rule, expected, remediation }) => rule === 'ui-token/stale-manifest' && expected && remediation));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLELINT_CONFIG } from '../../src/config/defaults.js';
import { validateStylelintConfiguration as validate } from '../../src/config/stylelint-validation.js';
const file = 'repo-guard.config.json';
test('样式默认配置与校验器一致', () => {
  assert.deepEqual(validate({}, file), DEFAULT_STYLELINT_CONFIG);
});
test('统一样式配置保留执行、规则、治理和 Token 设置', () => {
  const input = {
    enabled: true,
    fix: false,
    pattern: ' src/** ',
    maxWarnings: 3,
    requireConfig: false,
    options: { rules: { 'max-nesting-depth': 2 } },
    governance: { enabled: true, allowedGlobalStylePatterns: [' theme/** '] },
    uiTokens: { enabled: false, languages: ['css', 'sass'] },
  };
  const actual = validate({ stylelint: input }, file);
  assert.equal(actual.pattern, 'src/**');
  assert.deepEqual(actual.options, input.options);
  assert.deepEqual(actual.governance.allowedGlobalStylePatterns, ['theme/**']);
  assert.deepEqual(actual.uiTokens.languages, ['css', 'sass']);
  assert.equal(actual.maxWarnings, 3);
  assert.equal(actual.fix, false);
});
test('执行字段拒绝无效类型及未知选项', () => {
  for (const input of [
    [],
    { command: 'lint' },
    { enabled: 'yes' },
    { fix: 1 },
    { maxWarnings: -1 },
    { requireConfig: 1 },
    { pattern: ' ' },
    { uiTokens: null },
  ])
    assert.throws(
      () => validate({ stylelint: input }, file),
      (e) => e.kind === 'configuration',
    );
});
test('治理只接受隔离字段，重复规则配置必须拒绝', () => {
  for (const input of [
    [],
    { enabled: 'yes' },
    { allowedGlobalStylePatterns: [] },
    { allowedGlobalStylePatterns: [' '] },
    { maxSpecificity: '0,3,0' },
    { maxIdSelectors: 0 },
    { disallowImportant: true },
  ])
    assert.throws(
      () => validate({ stylelint: { governance: input } }, file),
      (e) => e.kind === 'configuration',
    );
  assert.throws(
    () => validate({ stylelint: { complexity: { enabled: true } } }, file),
    (e) => e.kind === 'configuration',
  );
});
test('关闭主开关保存子开关而不销毁配置', () => {
  const c = validate(
    {
      stylelint: {
        enabled: false,
        governance: { enabled: true },
        uiTokens: { enabled: true },
      },
    },
    file,
  );
  assert.equal(c.enabled, false);
  assert.equal(c.governance.enabled, true);
  assert.equal(c.uiTokens.enabled, true);
});

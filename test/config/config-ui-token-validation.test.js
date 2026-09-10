import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateUiTokenConfiguration } from '../../src/config/ui-token-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';
const configSchema = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv2020({ strict: false }).compile(
  configSchema.$defs.singleProjectDocument.properties.checks.properties.uiTokens,
);

test('默认生成扁平 CSS Token 配置且保持关闭', () => {
  const config = validateUiTokenConfiguration({}, CONFIG_PATH);
  assert.deepEqual(config, {
    enabled: false,
    languages: ['css'],
    manifestFile: 'ui-tokens.manifest.json',
    include: ['src/**/*.{vue,css,scss,sass,less}'],
    exclude: ['**/generated/**', '**/dist/**', '**/coverage/**', '**/reports/**'],
    iconSelectors: ['svg', '.icon', '.ui-icon', '.svg-icon'],
  });
  assert.equal(validateSchema(config), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateUiTokenConfiguration({ uiTokens: { enabled: true } }, CONFIG_PATH).languages, ['css']);
});

test('使用显式语言列表和图标选择器启用样式 Token 检查', () => {
  const value = {
    enabled: true,
    languages: ['css', 'sass', 'less'],
    manifestFile: 'design/ui-tokens.manifest.json',
    include: ['src/**/*.{vue,css,scss,sass,less}'],
    exclude: ['src/generated/**'],
    iconSelectors: ['.app-icon'],
  };
  const config = validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH);
  assert.deepEqual(config, value);
  assert.notEqual(config.languages, value.languages);
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors));
});

test('运行时与 Schema 拒绝空、重复或未支持的语言列表', () => {
  for (const languages of [[], ['css', 'css'], ['stylus'], ['unocss'], ['scss'], [null], null, 'css']) {
    const value = { enabled: true, languages };
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH), /languages/);
    assert.equal(validateSchema(value), false, JSON.stringify(value));
  }
});

test('运行时与 Schema 拒绝旧适配器和嵌套图标字段而不改写输入', () => {
  for (const value of [
    { adapters: { sass: { enabled: true } } },
    { adapters: { unocss: { enabled: true } } },
    { icon: { sassSelectors: ['.icon'] } },
  ]) {
    const original = structuredClone(value);
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH), /包含不支持的属性/);
    assert.equal(validateSchema(value), false);
    assert.deepEqual(value, original);
  }
});

test('拒绝不确定的清单路径与空或重复图标选择器', () => {
  assert.throws(() => validateUiTokenConfiguration({
    uiTokens: { manifestFile: 'design/*.json' },
  }, CONFIG_PATH), /不得包含 glob/);
  for (const iconSelectors of [[], ['.icon', ' .icon '], [null], null]) {
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: { iconSelectors } }, CONFIG_PATH), /iconSelectors/);
  }
});

test('显式空值不按缺省值放行，运行时与 Schema 一致', () => {
  for (const field of ['enabled', 'languages', 'manifestFile', 'include', 'exclude', 'iconSelectors']) {
    const value = { [field]: null };
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH));
    assert.equal(validateSchema(value), false, field);
  }
});

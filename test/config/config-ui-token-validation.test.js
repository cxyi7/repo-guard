import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateUiTokenConfiguration } from '../../src/config/ui-token-validation.js';
import { validateUiTokenManifest } from '../../src/config/ui-token-manifest-validation.js';

test('运行时和清单 Schema 拒绝已移除的图标尺寸类别', () => {
  const manifest = { version: 2, sources: [{path:'styles/tokens.css',sha256:'a'.repeat(64)}], tokens: [{id:'icon.small',category:'icon-size',aliases:{css:['var(--icon-small)']}}] };
  const schema = JSON.parse(readFileSync(new URL('../../ui-token-manifest.schema.json', import.meta.url), 'utf8'));
  assert.equal(new Ajv2020({strict:false}).compile(schema)(manifest), false);
  assert.throws(() => validateUiTokenManifest(manifest), error => error.kind === 'configuration');
});

const CONFIG_PATH = 'repo-guard.config.json';
const configSchema = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv2020({ strict: false }).compile(
  configSchema.$defs.singleProjectDocument.properties.checks.properties.stylelint.properties.uiTokens,
);

test('指定值与产物配置的开关、空值和必要映射由运行时及 Schema 共同验证', () => {
  const entry = { token: 'color.brand', source: 'styles/tokens.css', language: 'css', alias: 'var(--brand)', selector: ':root', value: '#fff', outputs: [{ selector: ':root', property: '--brand' }] };
  const valid = { values: { enabled: true, definitions: [entry] }, artifacts: { enabled: true, patterns: ['assets/**/*.css'] } };
  assert.equal(validateSchema(valid), true);
  assert.equal(validateUiTokenConfiguration({ uiTokens: valid }, CONFIG_PATH).values.definitions[0].value, '#fff');
  for (const value of [
    { values: null }, { artifacts: null }, { values: { enabled: true } },
    { values: { definitions: null } }, { values: { enabled: null } },
    { values: { definitions: [{ ...entry, conditions: null }] } },
    { values: { definitions: [{ ...entry, outputs: null }] } },
    { artifacts: { enabled: true } },
    { values: { enabled: true, definitions: [{ ...entry, outputs: [] }] }, artifacts: { enabled: true } },
  ]) {
    assert.equal(validateSchema(value), false, JSON.stringify(value));
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH), error => error.kind === 'configuration');
  }
  const disabled = validateUiTokenConfiguration({ uiTokens: { ...valid, enabled: false } }, CONFIG_PATH);
  assert.equal(disabled.values.enabled, true);
  assert.equal(disabled.artifacts.enabled, true);
});

test('默认生成扁平 CSS Token 配置且保持关闭', () => {
  const config = validateUiTokenConfiguration({}, CONFIG_PATH);
  assert.deepEqual(config, {
    enabled: false,
    languages: ['css'],
    manifestFile: 'ui-tokens.manifest.json',
    values: { enabled: false, definitions: [] },
    artifacts: { enabled: false, patterns: ['**/*.css'] },
    include: ['src/**/*.{vue,css,scss,sass,less}', 'styles/**/*.{css,scss,sass,less}'],
    exclude: ['**/generated/**', '**/dist/**', '**/coverage/**', '**/reports/**'],
  });
  assert.equal(validateSchema(config), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateUiTokenConfiguration({ uiTokens: { enabled: true } }, CONFIG_PATH).languages, ['css']);
});

test('使用显式语言列表启用样式 Token 检查', () => {
  const value = {
    enabled: true,
    languages: ['css', 'sass', 'less'],
    manifestFile: 'design/ui-tokens.manifest.json',
    include: ['src/**/*.{vue,css,scss,sass,less}'],
    exclude: ['src/generated/**'],
  };
  const config = validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH);
  assert.deepEqual(config, { ...value, values: { enabled: false, definitions: [] }, artifacts: { enabled: false, patterns: ['**/*.css'] } });
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
    { iconSelectors: ['.ui-icon'] },
  ]) {
    const original = structuredClone(value);
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH), /包含不支持的属性/);
    assert.equal(validateSchema(value), false);
    assert.deepEqual(value, original);
  }
});

test('拒绝不确定的清单路径及已移除图标配置', () => {
  assert.throws(() => validateUiTokenConfiguration({
    uiTokens: { manifestFile: 'design/*.json' },
  }, CONFIG_PATH), /不得包含 glob/);
  for (const iconSelectors of [[], ['.icon', ' .icon '], [null], null]) {
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: { iconSelectors } }, CONFIG_PATH), /iconSelectors/);
  }
});

test('显式空值不按缺省值放行，运行时与 Schema 一致', () => {
  for (const field of ['enabled', 'languages', 'manifestFile', 'include', 'exclude']) {
    const value = { [field]: null };
    assert.throws(() => validateUiTokenConfiguration({ uiTokens: value }, CONFIG_PATH));
    assert.equal(validateSchema(value), false, field);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateCiConfiguration } from '../../src/config/ci-validation.js';
import { validateUiTokenManifest } from '../../src/config/ui-token-manifest-validation.js';

function schemaValidator(file) {
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return ajv.compile(JSON.parse(
    readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'),
  ));
}

test('外部门禁报告 Schema 仅接受 schemaVersion 2', () => {
  const validate = schemaValidator('external-report.schema.json');
  const report = {
    schemaVersion: 2,
    gateId: 'project.contract',
    status: 'passed',
    summary: '契约检查通过',
    findings: [],
    metrics: {},
    artifacts: [],
  };
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  for (const schemaVersion of [1, '2', 3, null, undefined]) {
    assert.equal(validate({ ...report, schemaVersion }), false);
  }
  assert.match(validate.schema.$id, /repo-guard-json-v2\.schema\.json$/);
});

test('外部门禁配置仅声明 repo-guard-json-v2，不转换旧协议别名', () => {
  const gate = {
    id: 'project.contract', enabled: true, environments: ['manual'],
    script: 'test:contract', timeoutMs: 30000,
    report: { format: 'repo-guard-json-v2', path: 'reports/contract.json' },
  };
  assert.equal(validateCiConfiguration({ externalGates: [gate] }, 'repo-guard.config.json').externalGates[0].report.format, 'repo-guard-json-v2');
  const oldGate = { ...gate, report: { ...gate.report, format: 'repo-guard-json-v1' } };
  assert.throws(() => validateCiConfiguration({ externalGates: [oldGate] }, 'repo-guard.config.json'), /必须为 repo-guard-json-v2/);
  const validate = schemaValidator('config.schema.json');
  for (const identity of [
    { project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' } },
  ]) {
    const document = { version: 2, ...identity, ci: { externalGates: [gate] } };
    assert.equal(validate(document), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...document, ci: { externalGates: [oldGate] } }), false);
  }
  assert.equal(validate({ version: 2, projects: [{ id: 'web', root: 'apps/web' }], ci: { externalGates: [gate] } }), false);
});

test('UI Token Manifest 的 Schema 与运行时统一只接受 version 2', () => {
  const validate = schemaValidator('ui-token-manifest.schema.json');
  const manifest = {
    version: 2,
    sources: [{ path: 'design/tokens.scss', sha256: 'a'.repeat(64) }],
    tokens: [{ id: 'color.brand', category: 'color', aliases: { sass: ['$brand'] } }],
  };
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.equal(validateUiTokenManifest(manifest).version, 2);
  for (const version of [1, '2', 3, null, undefined]) {
    assert.equal(validate({ ...manifest, version }), false);
    assert.throws(() => validateUiTokenManifest({ ...manifest, version }), /version.*2/);
  }
});

function tokenManifest(tokens) {
  return {
    version: 2,
    sources: [{ path: 'design/tokens.css', sha256: 'a'.repeat(64) }],
    tokens,
  };
}

test('Manifest 支持三种语言并补齐缺失别名列表，CSS 断点只接受正长度', () => {
  const validate = schemaValidator('ui-token-manifest.schema.json');
  const manifest = tokenManifest([
    { id: 'color.brand', category: 'color', aliases: { css: ['var(--brand)'], sass: ['theme.$brand'], less: ['@brand'] } },
    { id: 'spacing.base', category: 'spacing', aliases: { sass: ['space(2)'] } },
    { id: 'breakpoint.medium', category: 'breakpoint', aliases: { css: ['768px', '48em', '48rem', '.5rem', '0.5px'] } },
  ]);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  const result = validateUiTokenManifest(manifest);
  assert.deepEqual(result.tokens[1].aliases, { css: [], sass: ['space(2)'], less: [] });
  assert.equal(Object.hasOwn(result, 'shortcuts'), false);
  assert.notEqual(result.tokens, manifest.tokens);
});

test('Manifest 运行时与 Schema 拒绝 CSS 字面量、回退值及无效断点', () => {
  const validate = schemaValidator('ui-token-manifest.schema.json');
  const invalidAliases = [
    ['color', '#123456'],
    ['color', 'var(--brand, red)'],
    ['color', 'var(--brand) solid'],
    ['color', 'var(brand)'],
    ['breakpoint', 'var(--medium)'],
    ['breakpoint', '0px'],
    ['breakpoint', '0.0rem'],
    ['breakpoint', '-1em'],
    ['breakpoint', '50%'],
    ['breakpoint', 'calc(48rem + 1px)'],
  ];
  for (const [category, alias] of invalidAliases) {
    const manifest = tokenManifest([{ id: 'sample.value', category, aliases: { css: [alias] } }]);
    assert.equal(validate(manifest), false, alias);
    assert.throws(() => validateUiTokenManifest(manifest), /CSS/);
  }
});

test('Manifest 严格拒绝 UnoCSS 与 shortcuts 字段及空语言别名', () => {
  const validate = schemaValidator('ui-token-manifest.schema.json');
  const token = { id: 'color.brand', category: 'color', aliases: { css: ['var(--brand)'] } };
  const rejected = [
    { ...tokenManifest([token]), shortcuts: [] },
    tokenManifest([{ ...token, aliases: { unocss: ['text-brand'] } }]),
    tokenManifest([{ ...token, aliases: { stylus: ['brand'] } }]),
    tokenManifest([{ ...token, aliases: {} }]),
    tokenManifest([{ ...token, aliases: { css: [], sass: [], less: [] } }]),
    tokenManifest([{ ...token, aliases: { css: null } }]),
  ];
  for (const manifest of rejected) {
    const original = structuredClone(manifest);
    assert.equal(validate(manifest), false);
    assert.throws(() => validateUiTokenManifest(manifest), /不支持的属性|至少要声明|字符串数组/);
    assert.deepEqual(manifest, original);
  }
});

test('Manifest 拒绝同语言跨 Token 的别名冲突和非应用内来源路径', () => {
  const manifest = tokenManifest([
    { id: 'color.brand', category: 'color', aliases: { css: ['var(--brand)'] } },
    { id: 'spacing.brand', category: 'spacing', aliases: { css: ['var(--brand)'] } },
  ]);
  assert.throws(() => validateUiTokenManifest(manifest), /css 别名 不得包含重复值/);
  assert.throws(() => validateUiTokenManifest({
    ...tokenManifest([manifest.tokens[0]]),
    sources: [{ path: '../tokens.css', sha256: 'a'.repeat(64) }],
  }), /path/);
});

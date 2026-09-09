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
    { projects: [{ id: 'web', root: 'apps/web' }] },
  ]) {
    const document = { version: 2, ...identity, ci: { externalGates: [gate] } };
    assert.equal(validate(document), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...document, ci: { externalGates: [oldGate] } }), false);
  }
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const configurationSchema = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const projectSchema = JSON.parse(readFileSync(new URL('../../project.schema.json', import.meta.url), 'utf8'));

for (const definition of ['singleProjectDocument', 'workspaceDocument']) {
  test(`${definition} 的 CI 说明只描述工程质量和交付复核，运维独立配置`, () => {
    const ci = configurationSchema.$defs[definition].properties.ci;
    assert.match(ci.description, /质量 CI/);
    assert.match(ci.description, /repo-guard\.ops\.json/);
    assert.match(ci.description, /不生成应用部署或流水线通知作业/);
    assert.match(ci.properties.profile.description, /policy.*full.*release-ready/);
    assert.match(ci.properties.profile.description, /release-ready.*通用工程检查.*交付证据/);
    assert.match(ci.properties.profile.description, /不执行发布或部署/);
    for (const description of [ci.description, ci.properties.profile.description]) {
      assert.doesNotMatch(description, /managed application-delivery|delivery jobs only invoke|package release conditions/i);
    }
  });
}

test('子应用 Schema 继续引用统一工程定义，不能重新接受根 CI 策略', () => {
  assert.deepEqual(projectSchema.properties.version, {
    $ref: './config.schema.json#/$defs/singleProjectDocument/properties/version',
  });
  assert.deepEqual(projectSchema.properties.project, {
    $ref: './config.schema.json#/$defs/projectDescriptor',
  });
  assert.deepEqual(projectSchema.properties.checks, {
    $ref: './config.schema.json#/$defs/singleProjectDocument/properties/checks',
  });
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  ajv.addSchema(configurationSchema, 'config.schema.json');
  const validate = ajv.compile(projectSchema);
  const document = {
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' },
    checks: { unitTest: { enabled: true } },
  };
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...document, ci: { profile: 'release-ready' } }), false);
});

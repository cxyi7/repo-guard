import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { createProjectDocument, normalizeProjectDocument, serializeProjectConfig } from '../../src/config/project-configuration.js';

const descriptor = (preset) => ({ id: 'api', role: 'backend', stack: 'node', preset });
const enabledChecks = ['build', 'unitTest', 'coverage', 'mutationTest', 'architecture', 'deadCode', 'pathNaming', 'functionDocs', 'fileHeader'];
const schema = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);

for (const preset of ['node-javascript', 'node-typescript']) {
  test(`${preset} 新建工程检查开启，前端能力隔离且 Schema 可用`, () => {
    const config = createProjectDocument(descriptor(preset));
    for (const feature of enabledChecks) assert.equal(config.checks[feature].enabled, true, feature);
    assert.equal(config.checks.typeCheck.enabled, preset === 'node-typescript');
    for (const feature of ['stylelint', 'imageAssets', 'unusedImageAssets', 'lighthouse', 'asyncResourceCleanup']) {
      assert.equal(config.checks[feature].enabled, false, feature);
    }
    assert.equal(config.repository.codePlacement.enabled, false);
    assert.equal(config.checks.stylelint.uiTokens.enabled, false);
    assert.equal(config.checks.stylelint.governance.enabled, false);
    assert.equal(validate(config), true, JSON.stringify(validate.errors));
    assert.deepEqual(serializeProjectConfig(normalizeProjectDocument(config)), serializeProjectConfig(config));
  });
}

test('已有 Node 配置的省略值、关闭值、目录和阈值不被新建预设覆盖', () => {
  const config = normalizeProjectDocument({ version: 2, project: descriptor('node-typescript'), checks: {
    unitTest: { enabled: false, sourcePatterns: ['server/**/*.ts'] },
    coverage: { enabled: false, thresholds: { lines: 91 } },
  } });
  for (const feature of enabledChecks) assert.equal(config.checks[feature].enabled, false, feature);
  assert.equal(config.checks.typeCheck.enabled, false);
  assert.deepEqual(config.checks.unitTest.sourcePatterns, ['server/**/*.ts']);
  assert.equal(config.checks.coverage.thresholds.lines, 91);
});

test('Node 初始化结果独立，Java 已有配置不被 Node 预设开启', () => {
  const first = createProjectDocument(descriptor('node-typescript'));
  first.checks.coverage.thresholds.lines = 1;
  assert.equal(createProjectDocument(descriptor('node-typescript')).checks.coverage.thresholds.lines, 80);
  const java = normalizeProjectDocument({ version: 2, project: { id: 'java-api', role: 'backend', stack: 'java', preset: 'java-maven' } });
  for (const [feature, check] of Object.entries(java.checks)) {
    if (feature.startsWith('java')) assert.equal(check.enabled, false, feature);
  }
});

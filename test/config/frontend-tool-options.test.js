import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { createProjectDocument, normalizeProjectDocument, serializeProjectConfig } from '../../src/config/project-configuration.js';
import { setFeaturesEnabled } from '../../src/orchestration/setup/config-management.js';
import { TOOL_OPTIONS_SCHEMAS } from '../../src/config/tool-options-schema.js';
import { validateToolOptions } from '../../src/config/tool-options.js';
import { frontendToolOptions } from '../../src/profiles/frontend-tool-presets.js';
import { getFrontendToolRequirements } from '../../src/profiles/frontend-tool-requirements.js';

const project = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };

test('新前端项目保存已开启检查的完整预设，读取既有配置不暗中新增规则', () => {
  const generated = createProjectDocument(project);
  assert.equal(generated.checks.eslint.options.vueRules['vue/component-api-style'][1][0], 'script-setup');
  assert.equal(generated.checks.eslint.options.typeAware, true);
  assert.equal(generated.checks.prettier.options.printWidth, 100);
  assert.deepEqual(generated.checks.stylelint.options, frontendToolOptions('stylelint', project));
  const existing = normalizeProjectDocument({ version: 2, project });
  assert.equal(existing.checks.eslint.options, undefined);
  const java = createProjectDocument({ id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' });
  assert.equal(java.checks.eslint.options, undefined);
});

test('工具预设通过同一 Schema，非法选项、类型和原型属性被拒绝', () => {
  const ajv = new Ajv2020({ strict: false });
  for (const feature of Object.keys(TOOL_OPTIONS_SCHEMAS)) {
    const options = frontendToolOptions(feature, project);
    assert.equal(ajv.compile(TOOL_OPTIONS_SCHEMAS[feature])(options), true);
    assert.deepEqual(validateToolOptions(feature, options, 'config').options, options);
    assert.throws(() => validateToolOptions(feature, { ...options, typo: true }, 'config'));
  }
  for (const bad of [null, { printWidth: -1 }, { semi: 'true' }]) assert.throws(() => validateToolOptions('prettier', bad, 'config'));
  assert.throws(() => validateToolOptions('eslint', JSON.parse('{"rules":{"__proto__":{}}}'), 'config'));
});

test('启用补齐默认项，重复启用和关闭保留修改，不生成原生工具文件', (t) => {
  const parent = path.join(process.cwd(), 'test/.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'tool-options-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  const file = path.join(root, 'repo-guard.config.json');
  writeFileSync(file, JSON.stringify(serializeProjectConfig(normalizeProjectDocument({ version: 2, project }))));
  const enabled = setFeaturesEnabled(root, ['eslint', 'prettier', 'stylelint', 'typeCheck'], true);
  assert.deepEqual(enabled.changed, ['eslint', 'prettier', 'stylelint', 'typeCheck']);
  const document = JSON.parse(readFileSync(file));
  assert.equal(document.checks.stylelint.options.rules['no-descending-specificity'], null);
  assert.ok(document.checks.typeCheck.options.compilerOptions.strict);
  document.checks.prettier.options.printWidth = 140;
  document.checks.eslint.options.rules['no-warning-comments'] = 'off';
  writeFileSync(file, JSON.stringify(document));
  const before = readFileSync(file, 'utf8');
  assert.equal(setFeaturesEnabled(root, ['eslint', 'prettier'], true).changed.length, 0);
  assert.equal(readFileSync(file, 'utf8'), before);
  setFeaturesEnabled(root, ['prettier'], false);
  assert.equal(JSON.parse(readFileSync(file)).checks.prettier.options.printWidth, 140);
  const requirements = getFrontendToolRequirements(normalizeProjectDocument(document));
  assert.ok(requirements.some(({ name }) => name === 'stylelint-order'));
  assert.ok(requirements.some(({ name }) => name === 'vue-tsc'));
});

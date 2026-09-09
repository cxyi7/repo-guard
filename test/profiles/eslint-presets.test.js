import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveRepoGuardEslintPreset } from '../../src/gates/quality/eslint-gate.js';

function fixture(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-preset-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), '{"name":"preset-fixture"}');
  function install(name, source) {
    const directory = path.join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '9.19.0', type: 'module', main: 'index.js' }));
    writeFileSync(path.join(directory, 'index.js'), source);
  }
  install('@eslint/js', 'export default { configs: { recommended: { rules: {} } } };');
  return { root, install };
}

test('Node JavaScript 按声明加载预设，已有 Vue 和 TS 包也不影响规则', async (context) => {
  const { root, install } = fixture(context);
  install('eslint-plugin-vue', '此包不应被加载');
  install('typescript-eslint', '此包不应被加载');
  const result = await resolveRepoGuardEslintPreset(root, '9.19.0', {
    id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript',
  });
  assert.deepEqual(result.integrations, ['@eslint/js 9.19.0']);
  assert.equal(result.configs.some(({ name }) => /ai-vue|ai-typescript/.test(name)), false);
});

test('Node TypeScript 必须准备 TS 插件但不加载 Vue，配置中保留 TS 规则', async (context) => {
  const { root, install } = fixture(context);
  const descriptor = { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' };
  await assert.rejects(resolveRepoGuardEslintPreset(root, '9.19.0', descriptor), /typescript-eslint/);
  install('typescript-eslint', 'export default { configs: { recommended: {}, stylistic: {} }, plugin: {}, parser: {} };');
  install('eslint-plugin-vue', '此包不应被加载');
  const result = await resolveRepoGuardEslintPreset(root, '9.19.0', descriptor);
  assert.deepEqual(result.integrations, ['@eslint/js 9.19.0', 'typescript-eslint 9.19.0']);
  assert.ok(result.configs.some(({ name }) => name === 'repo-guard/ai-typescript'));
  assert.equal(result.configs.some(({ name }) => name === 'repo-guard/ai-vue'), false);
});

test('Vue 前端显式要求 Vue 插件，JavaScript 预设不要求 TS 插件', async (context) => {
  const { root, install } = fixture(context);
  const descriptor = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' };
  await assert.rejects(resolveRepoGuardEslintPreset(root, '9.19.0', descriptor), /eslint-plugin-vue/);
  install('eslint-plugin-vue', 'export default { configs: { "flat/recommended": [] } };');
  const result = await resolveRepoGuardEslintPreset(root, '9.19.0', descriptor);
  assert.deepEqual(result.integrations, ['@eslint/js 9.19.0', 'eslint-plugin-vue 9.19.0']);
  assert.ok(result.configs.some(({ name }) => name === 'repo-guard/ai-vue'));
});

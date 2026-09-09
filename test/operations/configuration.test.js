import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  loadOperationsConfig,
  validateOperationsConfig,
  writeOperationsConfig,
} from '../../src/operations/config/configuration.js';

function fixture(context) {
  const directory = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(path.join(directory, 'operations-config-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('缺失配置时运维保持关闭，重复归一化保持一致', (context) => {
  const config = loadOperationsConfig(fixture(context));
  assert.equal(config.enabled, false);
  assert.equal(config.notifications.enabled, false);
  assert.deepEqual(validateOperationsConfig(config), config);
  const disabled = validateOperationsConfig({ version: 2, projects: { api: { enabled: false } } });
  assert.deepEqual(validateOperationsConfig(disabled), disabled);
});

test('拒绝未知字段、隐式开启和不受支持的运维平台', () => {
  assert.throws(() => validateOperationsConfig({ version: 2, deploy: {} }), /未知字段/);
  assert.throws(() => validateOperationsConfig({ version: 2, enabled: 'true' }), /布尔值/);
  assert.throws(() => validateOperationsConfig({ version: 2, provider: 'github' }), /gitlab/);
  assert.throws(() => validateOperationsConfig({ version: 2, projects: { api: { allow_failure: true } } }), /未知字段/);
  assert.throws(() => validateOperationsConfig({ version: 2, notifications: true }), /必须是对象/);
  assert.throws(() => validateOperationsConfig({ version: 2, notifications: { enabled: 'true' } }), /布尔值/);
  assert.throws(() => validateOperationsConfig({ version: 2, notifications: { webhook: 'secret' } }), /未知字段/);
  assert.equal(validateOperationsConfig({ version: 2, notifications: { enabled: true } }).notifications.enabled, true);
});

test('拒绝越界产物、命令注入、通配分支和弱化质量档位', () => {
  const unit = { enabled: true, buildScript: 'build', artifactPaths: ['dist/'] };
  const make = (extra) => ({ version: 2, enabled: true, projects: { api: { ...unit, ...extra } } });
  assert.throws(() => validateOperationsConfig(make({ artifactPaths: ['../web/dist'] })), /相对路径/);
  assert.throws(() => validateOperationsConfig(make({ buildScript: 'build && echo done' })), /脚本名/);
  assert.throws(() => validateOperationsConfig(make({ qualityProfile: 'policy' })), /full/);
  assert.throws(() => validateOperationsConfig(make({ environments: { production: { script: 'deploy', branches: ['*'] } } })), /允许部署的分支/);
});

test('生产环境默认手动对应的生产标志，必须明确允许分支', () => {
  const config = validateOperationsConfig({
    version: 2,
    projects: { api: { environments: { production: { script: 'deploy', branches: ['main'] } } } },
  });
  assert.equal(config.projects.api.environments.production.production, true);
});

test('写入配置不覆盖现有文件，显式内容比对后才更新', (context) => {
  const root = fixture(context);
  writeOperationsConfig(root, { version: 2, enabled: false });
  const file = path.join(root, 'repo-guard.ops.json');
  const original = readFileSync(file, 'utf8');
  assert.throws(() => writeOperationsConfig(root, { version: 2, enabled: true }), /拒绝覆盖/);
  assert.equal(readFileSync(file, 'utf8'), original);
  writeOperationsConfig(root, { version: 2, enabled: true }, { expectedContent: original });
  assert.equal(loadOperationsConfig(root).enabled, true);
  writeFileSync(file, '{ invalid json');
  assert.throws(() => loadOperationsConfig(root), /有效的 JSON/);
});

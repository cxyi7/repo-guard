import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureCi, ensureProjectConfig, migrateProjectConfig, setFeaturesEnabled } from '../../src/orchestration/setup/config-management.js';
import { loadConfig, loadWorkspace } from '../../src/config/configuration-loader.js';

const project = { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' };
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-v2-management-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, document) { writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify(document)); }
function read(root) { return JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8')); }

test('初始化必须明确项目身份且只生成 v2', (t) => {
  const root = fixture(t);
  assert.throws(() => ensureProjectConfig(root), { code: 'project/descriptor-required' });
  assert.equal(existsSync(path.join(root, 'repo-guard.config.json')), false);
  assert.equal(ensureProjectConfig(root, { project }).created, true);
  assert.equal(read(root).version, 2);
  assert.equal(ensureProjectConfig(root, { project }).created, false);
});

test('显式迁移先验证且保留原始字节备份，禁止覆盖已有备份', (t) => {
  const root = fixture(t);
  const old = { version: 1, rules: [{ pattern: 'secret.js', category: '保护', level: 'block' }] };
  write(root, old);
  const original = readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8');
  assert.throws(() => setFeaturesEnabled(root, ['eslint'], false), { code: 'config/migration-required' });
  assert.equal(read(root).version, 1);
  const result = migrateProjectConfig(root, { project });
  assert.equal(result.config.configVersion, 2);
  assert.equal(read(root).version, 2);
  assert.equal(readFileSync(result.backupPath, 'utf8'), original);
  write(root, old);
  assert.throws(() => migrateProjectConfig(root, { project }), { code: 'config/backup-failed' });
  assert.equal(read(root).version, 1);
});

test('旧运维定制不能在迁移时丢失或静默启用新版发布', (t) => {
  const root = fixture(t);
  write(root, { version: 1, rules: [{ pattern: '*', category: '保护', level: 'notify' }], ci: { pipeline: { enabled: true } } });
  assert.throws(() => migrateProjectConfig(root, { project }), { code: 'config/operations-migration-required' });
  assert.equal(read(root).version, 1);
  assert.equal(existsSync(path.join(root, 'repo-guard.config.v1.backup.json')), false);
});

test('旧配置迁移为已启用的构建基线补充仓库保护且保留更强规则', (t) => {
  const root = fixture(t);
  const rule = { pattern: 'critical.js', category: '必要实现', level: 'block' };
  write(root, { version: 1, rules: [rule], build: { enabled: true, artifactBudget: {
    enabled: true, platform: 'pc', mode: 'baseline', baselineFile: '.repo-guard/custom-budget.json',
    pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
  } } });
  migrateProjectConfig(root, { project });
  assert.deepEqual(read(root).repository.rules, [rule, {
    pattern: '.repo-guard/custom-budget.json', category: '构建产物历史债务基线', level: 'notify',
  }]);
});

test('功能启停写入正确层级并维护子能力联动，禁止后端前端专用项', (t) => {
  const root = fixture(t);
  write(root, { version: 2, project, checks: { unitTest: { script: 'test:backend' } } });
  setFeaturesEnabled(root, ['coverage'], true);
  const document = read(root);
  assert.equal(document.checks.unitTest.script, 'test:backend');
  assert.equal(document.checks.unitTest.enabled, true);
  assert.equal(document.checks.coverage.enabled, true);
  assert.equal(Object.hasOwn(document.checks.unitTest, 'coverage'), false);
  setFeaturesEnabled(root, ['unitTest'], false);
  assert.equal(loadConfig(root).unitTest.coverage.enabled, false);
  const before = readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8');
  assert.throws(() => setFeaturesEnabled(root, ['lighthouse'], true));
  assert.equal(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'), before);
  setFeaturesEnabled(root, ['notification', 'dependencies'], false);
  assert.equal(read(root).reporting.notification.enabled, false);
  assert.equal(read(root).repository.dependencyPolicy.enabled, false);
});

test('多应用只改所选应用，公共 CI 独立写根且不触发旧配置迁移', (t) => {
  const root = fixture(t);
  for (const id of ['api', 'worker']) {
    mkdirSync(path.join(root, id));
    write(path.join(root, id), { version: 2, project: { ...project, id } });
  }
  write(root, { version: 2, projects: [{ id: 'api', root: 'api' }, { id: 'worker', root: 'worker' }] });
  assert.throws(() => setFeaturesEnabled(root, ['unitTest'], true), { code: 'project/selection-required' });
  setFeaturesEnabled(root, ['unitTest'], true, { projectId: 'api' });
  assert.equal(read(path.join(root, 'api')).checks.unitTest.enabled, true);
  assert.equal(read(path.join(root, 'worker')).checks, undefined);
  setFeaturesEnabled(root, ['notification'], false);
  assert.equal(read(root).reporting.notification.enabled, false);
  assert.equal(read(path.join(root, 'api')).reporting, undefined);
  configureCi(root, { profile: 'full' });
  assert.equal(loadWorkspace(root).repositoryConfig.ci.profile, 'full');
  assert.equal(read(root).ci.pipeline, undefined);
});

test('多应用 UI 契约与构建基线保护写入仓库公共规则并使用应用相对路径', (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'apps/web'), { recursive: true });
  write(path.join(root, 'apps/web'), {
    version: 2,
    project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' },
    checks: {
      uiTokens: { enabled: false, manifestFile: 'design/tokens.json', adapters: { sass: { enabled: true } } },
      build: { enabled: true, artifactBudget: {
        enabled: true, platform: 'pc', mode: 'baseline', baselineFile: '.repo-guard/budget.json',
        pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
      } },
    },
  });
  const existing = { pattern: 'apps/web/.repo-guard/budget.json', category: '必要基线', level: 'block' };
  write(root, { version: 2, projects: [{ id: 'web', root: 'apps/web' }], repository: { rules: [existing] } });
  setFeaturesEnabled(root, ['uiTokens'], true, { projectId: 'web' });
  assert.deepEqual(read(root).repository.rules, [existing, {
    pattern: 'apps/web/design/tokens.json', category: 'UI Token 契约', level: 'notify',
  }]);
  assert.equal(read(path.join(root, 'apps/web')).repository, undefined);
  setFeaturesEnabled(root, ['uiTokens'], false, { projectId: 'web' });
  assert.equal(read(root).repository.rules.length, 2);
});

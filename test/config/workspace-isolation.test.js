import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';
import { loadConfig, loadWorkspace } from '../../src/config/configuration-loader.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { createWorkspaceTargets, workspaceStepTargets, scopeRepositoryProtectionChanges } from '../../src/orchestration/workspace/targets.js';
import { repairRepository } from '../../src/orchestration/setup/repository-repair.js';
import { setFeaturesEnabled } from '../../src/orchestration/setup/config-management.js';
import { runDoctor } from '../../src/orchestration/doctor/runner.js';

function fixture(t) {
  const document = { version: 2, projects: [{ id: 'web', root: 'web' }, { id: 'api', root: 'api' }],
    repository: { rules: [{ pattern: '.githooks/**', category: '仓库基础文件', level: 'block' }] },
    ci: { enabled: true, profile: 'full' } };
  const files = { 'repo-guard.config.json': JSON.stringify(document) };
  for (const id of ['web', 'api']) files[`${id}/repo-guard.config.json`] = JSON.stringify({ version: 2,
    project: { id, role: id === 'web' ? 'frontend' : 'backend', stack: 'node', preset: id === 'web' ? 'vue-javascript' : 'node-javascript' },
    repository: { rules: [{ pattern: `${id}.txt`, category: '应用独立保护', level: 'block' }], dependencyPolicy: { enabled: id === 'api' } } });
  return createGitProjectFixture(t, files);
}
test('应用保护与依赖配置独立，根保护不继承到应用', (t) => {
  const root = fixture(t);
  const workspace = loadWorkspace(root);
  assert.equal(workspace.projects[0].config.repository.rules[0].pattern, 'web.txt');
  assert.equal(workspace.projects[1].config.repository.rules[0].pattern, 'api.txt');
  assert.equal(workspace.projects[0].config.repository.dependencyPolicy.enabled, false);
  assert.equal(workspace.projects[1].config.repository.dependencyPolicy.enabled, true);
  assert.equal(workspace.repositoryConfig.repository.dependencyPolicy.enabled, false);
});
test('只修改前端不读取损坏的后端配置，但命中后端或根入口时必须阻断', (t) => {
  const root = fixture(t);
  writeProjectFile(root, 'api/repo-guard.config.json', '{无效配置');
  const workspace = loadWorkspace(root, { lazyProjects: true });
  const targets = (file) => createWorkspaceTargets({ workspace, environment: 'pre-commit', changes: createChangeSet({ source: 'pre-commit', changes: [{ status: 'M', path: file }] }) });
  assert.deepEqual(targets('web/src/file.js').projects.map(({ project }) => project.id), ['web']);
  assert.throws(() => targets('api/src/file.js'));
  assert.throws(() => targets('repo-guard.config.json'));
  assert.equal(loadConfig(root, { projectId: 'web' }).project.id, 'web');
});
test('外部门禁只属于对应应用，共享目录显式触发声明的应用', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.sharedPaths = [{ path: 'shared', projects: ['api'] }];
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(document));
  const workspace = loadWorkspace(root);
  const targets = createWorkspaceTargets({ workspace, environment: 'pre-commit', changes: createChangeSet({ source: 'pre-commit', changes: [{ status: 'M', path: 'shared/util.js' }] }) });
  assert.deepEqual(targets.projects.map(({ project }) => project.id), ['api']);
  assert.deepEqual(workspaceStepTargets(targets, { gateId: 'dependencies.policy' }).map(({ project }) => project.id), ['api']);
  assert.equal(workspaceStepTargets(targets, { gateId: 'repository.protected-files' }).length, 2);
  document.ci.externalGates = [];
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(document));
  assert.throws(() => loadWorkspace(root), /外部门禁必须配置在所属应用/);
});

test('单独修改和修复前端不读取损坏的后端配置', (t) => {
  const root = fixture(t);
  writeProjectFile(root, 'package.json', JSON.stringify({ name: 'workspace', version: '1.0.0' }));
  writeProjectFile(root, 'web/package.json', JSON.stringify({ name: 'web', version: '1.0.0' }));
  writeProjectFile(root, 'api/repo-guard.config.json', '{无效配置');
  fixtureGit(root, ['config', '--unset', 'core.hooksPath']);
  const result = setFeaturesEnabled(root, ['eslint'], false, { projectId: 'web' });
  assert.deepEqual(result.changed, ['eslint']);
  const repair = repairRepository(root, { projectId: 'web' });
  assert.deepEqual(repair.repairErrors, []);
  assert.equal(readFileSync(path.join(root, 'api/repo-guard.config.json'), 'utf8'), '{无效配置');
});

test('仓库保护过滤应用文件且跨边界重命名保留仓库一侧', (t) => {
  const workspace = loadWorkspace(fixture(t));
  const changes = [{ status: 'M', path: 'web/src/value.js' }, { status: 'M', path: '.githooks/pre-commit' },
    { status: 'R100', oldPath: 'shared/tool.js', path: 'api/tool.js' },
    { status: 'R100', oldPath: 'web/readme.md', path: 'docs/readme.md' }];
  assert.deepEqual(scopeRepositoryProtectionChanges(workspace, changes), [
    { status: 'M', path: '.githooks/pre-commit' },
    { status: 'D', oldPath: null, path: 'shared/tool.js' },
    { status: 'A', oldPath: null, path: 'docs/readme.md' },
  ]);
  const targets = createWorkspaceTargets({ workspace, environment: 'pre-commit', changes: createChangeSet({ source: 'test', changes }) });
  assert.deepEqual(workspaceStepTargets(targets, { gateId: 'repository.protected-files' }).at(-1).changes.entries,
    scopeRepositoryProtectionChanges(workspace, changes));
});

test('根目录应用只允许仓库保护共享基础设施，应用源码保护自行配置', (t) => {
  const root = fixture(t);
  writeProjectFile(root, 'root-project.json', readFileSync(path.join(root, 'web/repo-guard.config.json'), 'utf8'));
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify({ version: 2, projects: [{ id: 'web', root: '.', config: 'root-project.json' }] }));
  const changes = ['src/value.js', 'package.json', 'AGENTS.md', 'repo-guard.config.json', '.github/workflows/ci.yml'].map((file) => ({ status: 'M', path: file }));
  assert.deepEqual(scopeRepositoryProtectionChanges(loadWorkspace(root), changes).map(({ path: file }) => file),
    ['AGENTS.md', 'repo-guard.config.json', '.github/workflows/ci.yml']);
});

test('Doctor 汇总所选应用的过期例外和通知需要，不读取其他应用', async (t) => {
  const root = fixture(t);
  const messages = [];
  t.mock.method(console, 'log', (...items) => messages.push(items.join(' ')));
  t.mock.method(console, 'error', (...items) => messages.push(items.join(' ')));
  const file = path.join(root, 'web/repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.repository.rules = [{ pattern: 'web.txt', category: '前端必要文件', level: 'notify' }];
  document.repository.exceptions = { entries: [{ id: 'expired-web-exception', rule: 'security/no-unsafe-html',
    path: 'src/Legacy.vue', line: 1, column: 1, reason: '历史遗留规则需要人工重新审核', owner: 'web-owner', approvedBy: 'reviewer',
    ticket: 'SEC-1', createdOn: '2020-01-01', expiresOn: '2020-01-31' }] };
  writeProjectFile(root, 'web/repo-guard.config.json', JSON.stringify(document));
  writeProjectFile(root, 'api/repo-guard.config.json', '{无效配置');
  assert.equal(await runDoctor(root, { projectId: 'web' }), 1);
  const output = messages.join('\n');
  assert.match(output, /应用 web：[\s\S]*expired-web-exception/);
  assert.match(output, /缺少本地通知模板/);
  assert.doesNotMatch(output, /api.*无法读取配置|无法读取配置.*api/);
});

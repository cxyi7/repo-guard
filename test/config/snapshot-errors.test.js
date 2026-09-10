import assert from 'node:assert/strict';
import { unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStagedWorkspace, loadWorkspaceSnapshot } from '../../src/orchestration/workspace/configuration-snapshot.js';
import { resolvePushConfig } from '../../src/orchestration/pre-push/push-configuration.js';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';

const CONFIG_PATH = 'repo-guard.config.json';
const CONFIG = JSON.stringify({
  version: 2,
  project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
});

function fixture(context) {
  return createGitProjectFixture(context, { [CONFIG_PATH]: CONFIG, 'src/index.js': 'export const value = 1;\n' });
}

function removeFixtureBlob(root) {
  const hash = fixtureGit(root, ['rev-parse', `HEAD:${CONFIG_PATH}`]);
  const objects = path.resolve(root, '.git', 'objects');
  const target = path.resolve(objects, hash.slice(0, 2), hash.slice(2));
  assert.ok(target.startsWith(`${objects}${path.sep}`));
  unlinkSync(target);
}

function isGitExecutionFailure(error) {
  assert.equal(error.kind, 'execution');
  assert.match(error.code, /^git\//);
  assert.ok(error.details?.evidence?.length > 0);
  return true;
}

test('暂存配置对象无法读取时保留 Git 执行失败，不能报告配置被删除', (context) => {
  const root = fixture(context);
  removeFixtureBlob(root);
  assert.throws(() => loadStagedWorkspace(root), isGitExecutionFailure);
});

test('提交快照中的配置对象无法读取时不能报告快照缺失', (context) => {
  const root = fixture(context);
  removeFixtureBlob(root);
  assert.throws(() => loadWorkspaceSnapshot(root, 'HEAD'), isGitExecutionFailure);
});

test('待推送配置读取异常不能误报删除或跳过检查', (context) => {
  const root = fixture(context);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  removeFixtureBlob(root);
  const input = `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`;
  assert.throws(() => resolvePushConfig(root, input), isGitExecutionFailure);
});

test('损坏的暂存索引不能回退到磁盘配置', (context) => {
  const root = fixture(context);
  writeFileSync(path.join(root, '.git', 'index'), '损坏的索引');
  assert.throws(() => loadStagedWorkspace(root), isGitExecutionFailure);
});

test('真正删除已接入的暂存配置仍按配置错误阻断', (context) => {
  const root = fixture(context);
  fixtureGit(root, ['rm', '--cached', CONFIG_PATH]);
  assert.throws(() => loadStagedWorkspace(root), (error) => error.code === 'config/staged-root-missing');
});

test('初始无提交的分支仍可使用尚未暂存的首次接入配置', (context) => {
  const root = fixture(context);
  fixtureGit(root, ['checkout', '--orphan', 'initial-setup']);
  fixtureGit(root, ['rm', '-r', '--cached', '.']);
  assert.equal(loadStagedWorkspace(root).projects[0].id, 'api');
});

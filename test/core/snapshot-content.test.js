import assert from 'node:assert/strict';
import test from 'node:test';
import { readOptionalSnapshotFile } from '../../src/git/snapshot-content.js';
import { runGitBinary } from '../../src/git/execution.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

test('索引和提交树读取各自文件对象，不使用工作树文本', (context) => {
  const file = 'apps/api/配置 [审查].json';
  const root = createGitProjectFixture(context, { [file]: '已提交\n' });
  writeProjectFile(root, file, '已暂存\n');
  fixtureGit(root, ['add', '--', file]);
  writeProjectFile(root, file, '未暂存\n');
  assert.equal(readOptionalSnapshotFile(root, '', file), '已暂存\n');
  assert.equal(readOptionalSnapshotFile(root, 'HEAD', file), '已提交\n');
});

test('成功检查快照后才能将不存在的文件返回为空', (context) => {
  const root = createGitProjectFixture(context, { 'src/index.js': 'export {};\n' });
  assert.equal(readOptionalSnapshotFile(root, '', 'missing.json'), null);
  assert.equal(readOptionalSnapshotFile(root, 'HEAD', 'missing.json'), null);
  assert.throws(() => readOptionalSnapshotFile(root, 'missing-revision', 'missing.json'),
    (error) => error.kind === 'execution' && error.code.startsWith('git/'));
});

test('目录对象不能被当作缺失或可读取的配置文件', (context) => {
  const root = createGitProjectFixture(context, { 'config/project.json': '{}\n' });
  assert.throws(() => readOptionalSnapshotFile(root, 'HEAD', 'config'),
    (error) => error.code === 'git/snapshot-entry-unreadable');
  assert.throws(() => readOptionalSnapshotFile(root, '', 'config'),
    (error) => error.code === 'git/snapshot-entry-unreadable');
});

test('未解决合并冲突的配置条目不能当作缺失或任意选取一方', (context) => {
  const file = 'config.json';
  const root = createGitProjectFixture(context, { [file]: '{}\n' });
  const objectId = fixtureGit(root, ['rev-parse', `HEAD:${file}`]);
  runGitBinary(['update-index', '--index-info'], {
    cwd: root,
    input: Buffer.from([
      `0 ${'0'.repeat(objectId.length)}\t${file}`,
      ...[1, 2, 3].map((stage) => `100644 ${objectId} ${stage}\t${file}`),
      '',
    ].join('\n')),
  });
  assert.throws(() => readOptionalSnapshotFile(root, '', file),
    (error) => error.kind === 'execution' && error.code === 'git/snapshot-entry-unreadable');
});

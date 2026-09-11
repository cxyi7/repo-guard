import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executionError } from '../../src/core/error/repo-guard-error.js';
import { runGitBinary } from '../../src/git/execution.js';
import { collectRepositoryFilePaths } from '../../src/git/repository-file-paths.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

test('完整索引同时覆盖历史路径和新增暂存路径，不读取未暂存新增或工作区删除', (t) => {
  const root = createGitProjectFixture(t, { 'old.js': '旧文件', 'deleted.js': '删除文件' });
  writeProjectFile(root, 'new.js', '新增暂存');
  writeProjectFile(root, 'untracked.js', '未暂存');
  fixtureGit(root, ['add', '--', 'new.js']);
  fixtureGit(root, ['rm', '--', 'deleted.js']);
  rmSync(path.join(root, 'old.js'));
  const facts = collectRepositoryFilePaths({ root, environment: 'pre-commit' });
  assert.deepEqual(facts.paths.sort(), ['new.js', 'old.js']);
  assert.equal(facts.source, 'index');
  assert.equal(facts.revision, null);
});

test('仅登记新增意向的文件不进入提交检查，手动检查仍覆盖其工作区文件', (t) => {
  const root = createGitProjectFixture(t, {
    'existing-empty.sql': '', 'deleted-empty.sql': '',
    'recreated.sql': '旧文件', 'recreated-empty.sql': '',
  });
  fixtureGit(root, ['rm', '--', 'recreated.sql', 'recreated-empty.sql']);
  writeProjectFile(root, 'recreated.sql', '重新登记意向');
  writeProjectFile(root, 'recreated-empty.sql', '');
  writeProjectFile(root, 'intent.sql', '尚未暂存的 SQL');
  writeProjectFile(root, 'intent-empty.sql', '');
  writeProjectFile(root, 'intent-deleted.sql', '之后删除的文件');
  writeProjectFile(root, 'staged-empty.sql', '');
  fixtureGit(root, ['add', '-N', '--', 'intent.sql', 'intent-empty.sql', 'intent-deleted.sql', 'recreated.sql', 'recreated-empty.sql']);
  fixtureGit(root, ['add', '--', 'staged-empty.sql']);
  fixtureGit(root, ['rm', '--', 'deleted-empty.sql']);
  rmSync(path.join(root, 'intent-deleted.sql'));
  fixtureGit(root, ['config', 'diff.renames', 'copies']);
  const staged = collectRepositoryFilePaths({ root, environment: 'pre-commit' });
  assert.deepEqual(staged.paths, ['existing-empty.sql', 'staged-empty.sql']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'manual' }).paths.sort(),
    ['existing-empty.sql', 'intent-empty.sql', 'intent.sql', 'recreated-empty.sql', 'recreated.sql', 'staged-empty.sql']);
  fixtureGit(root, ['commit', '-m', 'test: 仅提交实际暂存的空文件']);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'ci-full', revision: { head } }).paths, staged.paths);
});

test('未产生首个提交的分支同样区分真实暂存空文件与新增意向', (t) => {
  const root = createGitProjectFixture(t, { 'staged-empty.sql': '', 'staged-delete.sql': '' });
  fixtureGit(root, ['rm', '--', 'staged-delete.sql']);
  fixtureGit(root, ['symbolic-ref', 'HEAD', 'refs/heads/unborn-fixture']);
  writeProjectFile(root, 'intent.sql', '新增意向');
  writeProjectFile(root, 'intent-deleted.sql', '删除意向文件');
  fixtureGit(root, ['add', '-N', '--', 'intent.sql', 'intent-deleted.sql']);
  rmSync(path.join(root, 'intent-deleted.sql'));
  const staged = collectRepositoryFilePaths({ root, environment: 'pre-commit' });
  assert.deepEqual(staged.paths, ['staged-empty.sql']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'manual' }).paths.sort(), ['intent.sql', 'staged-empty.sql']);
  fixtureGit(root, ['commit', '-m', 'test: 首次提交实际暂存文件']);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'ci-full', revision: { head } }).paths, staged.paths);
});

test('手动检查覆盖所有未忽略新文件，排除工作区已删除文件并从子目录回到仓库根', (t) => {
  const root = createGitProjectFixture(t, { 'old.js': '旧文件', '.gitignore': 'ignored/\n', 'apps/web/main.js': '应用文件' });
  writeProjectFile(root, '新增 [审查].md', '新文件');
  writeProjectFile(root, 'ignored/skip.md', '忽略文件');
  rmSync(path.join(root, 'old.js'));
  const facts = collectRepositoryFilePaths({ root: path.join(root, 'apps', 'web'), environment: 'manual' });
  assert.equal(facts.root.toLowerCase(), root.toLowerCase());
  assert.deepEqual(facts.paths.sort(), ['.gitignore', 'apps/web/main.js', '新增 [审查].md']);
  assert.equal(facts.source, 'worktree');
});

test('提交检查绑定解析后的 head，不受更新后的 HEAD、索引或工作区影响', (t) => {
  const root = createGitProjectFixture(t, { 'old.js': '旧路径' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  fixtureGit(root, ['mv', 'old.js', 'new.js']);
  fixtureGit(root, ['commit', '-m', 'test: 移动文件']);
  fixtureGit(root, ['rm', 'new.js']);
  writeProjectFile(root, 'workspace.js', '工作区');
  for (const environment of ['pre-push', 'ci-policy', 'ci-full', 'release-ready']) {
    const facts = collectRepositoryFilePaths({ root, environment, revision: { head } });
    assert.deepEqual(facts.paths, ['old.js']);
    assert.equal(facts.source, 'revision');
    assert.equal(facts.revision, head);
  }
});

test('提交快照禁用 Git replace 对象替换，保留指定提交的真实文件树', (t) => {
  const root = createGitProjectFixture(t, { 'original.js': '原始路径' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  fixtureGit(root, ['mv', 'original.js', 'replacement.js']);
  fixtureGit(root, ['commit', '-m', 'test: 替换文件']);
  fixtureGit(root, ['replace', head, 'HEAD']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'ci-full', revision: { head } }).paths, ['original.js']);
});

test('Git 子模块入口及内部文件不作为普通仓库文件检查，符号链接路径本身保留', (t) => {
  const root = createGitProjectFixture(t, { 'base.js': '样例' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  const blob = fixtureGit(root, ['rev-parse', 'HEAD:base.js']);
  fixtureGit(root, ['update-index', '--add', '--cacheinfo', `160000,${head},vendor/child`]);
  fixtureGit(root, ['update-index', '--add', '--cacheinfo', `120000,${blob},link.js`]);
  fixtureGit(root, ['commit', '-m', 'test: 子模块和链接']);
  writeProjectFile(root, 'vendor/child/hidden.js', '子模块内部');
  for (const environment of ['pre-commit', 'ci-full']) {
    const facts = collectRepositoryFilePaths({ root, environment, revision: { head: fixtureGit(root, ['rev-parse', 'HEAD']) } });
    assert.deepEqual(facts.paths, ['base.js', 'link.js']);
    assert.equal(facts.gitlinks, 1);
  }
  const manual = collectRepositoryFilePaths({ root, environment: 'manual' });
  assert.deepEqual(manual.paths, ['base.js']);
  assert.equal(manual.gitlinks, 1);
});

test('暂存区未解决冲突不能被当作完整可信文件清单', (t) => {
  const root = createGitProjectFixture(t, { 'conflict.js': '冲突文件' });
  const blob = fixtureGit(root, ['rev-parse', 'HEAD:conflict.js']);
  runGitBinary(['update-index', '--index-info'], {
    cwd: root,
    input: Buffer.from(`0 ${'0'.repeat(blob.length)}\tconflict.js\n100644 ${blob} 1\tconflict.js\n100644 ${blob} 2\tconflict.js\n`),
  });
  assert.throws(() => collectRepositoryFilePaths({ root, environment: 'pre-commit' }),
    (error) => error.kind === 'range' && error.code === 'git/repository-index-unmerged');
});

test('成功读取空索引可返回真正的零文件清单', (t) => {
  const root = createGitProjectFixture(t, { 'base.js': '样例' });
  fixtureGit(root, ['rm', 'base.js']);
  assert.deepEqual(collectRepositoryFilePaths({ root, environment: 'pre-commit' }).paths, []);
});

test('缺失、可变、短提交或标签对象均不能代替已解析的提交 head', (t) => {
  const root = createGitProjectFixture(t, { 'base.js': '样例' });
  fixtureGit(root, ['tag', '-a', 'fixture', '-m', '标签']);
  const tag = fixtureGit(root, ['rev-parse', 'fixture']);
  for (const head of [undefined, 'HEAD', 'main', 'abcd1234', 'a'.repeat(40), tag]) {
    assert.throws(() => collectRepositoryFilePaths({ root, environment: 'ci-full', revision: { head } }),
      (error) => error.kind === 'range');
  }
});

function fakeGit(output, status = 0) {
  return (args) => args.includes('--show-toplevel')
    ? { status: 0, stdout: Buffer.from(`${process.cwd()}\n`) }
    : { status, stdout: args.includes('diff') ? Buffer.alloc(0) : Buffer.isBuffer(output) ? output : Buffer.from(output), stderr: Buffer.from('') };
}

test('新增意向对比读取失败或协议不一致不能当作没有新增意向', () => {
  const base = fakeGit(`100644 ${'a'.repeat(40)} 0\tfile.sql\0`);
  const success = (output) => ({ status: 0, stdout: Buffer.from(output) });
  for (const visibility of ['--ita-visible-in-index', '--ita-invisible-in-index']) {
    for (const failure of [
      { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('模拟读取失败') },
      success('file.sql'),
      success('A\0../outside.sql\0'),
      success('A\0not-in-index.sql\0'),
      success('A\0file.sql\0A\0file.sql\0'),
      success('M\0file.sql\0'),
    ]) {
      const run = (args) => args.includes(visibility) ? failure : base(args);
      assert.throws(() => collectRepositoryFilePaths({ root: process.cwd(), environment: 'pre-commit', run }),
        (error) => error.kind === 'execution');
    }
  }
  for (const [visibility, output] of [
    ['--ita-invisible-in-index', 'A\0file.sql\0'],
    ['--ita-visible-in-index', 'D\0file.sql\0'],
    ['--ita-invisible-in-index', 'D\0outside-index.sql\0'],
  ]) {
    const inconsistent = (args) => args.includes(visibility) ? success(output) : base(args);
    assert.throws(() => collectRepositoryFilePaths({ root: process.cwd(), environment: 'pre-commit', run: inconsistent }),
      (error) => error.kind === 'execution');
  }
});

test('工具执行失败、输出截断、未知条目和非法路径都不能降级为空清单', () => {
  const object = 'a'.repeat(40);
  const cases = [
    fakeGit('', 1),
    fakeGit(`100644 ${object} 0\tfile.js`),
    fakeGit(`100644 ${object} 0\t../outside.js\0`),
    fakeGit(`100644 ${object} 0\tpath\\ambiguous.js\0`),
    fakeGit(`040000 ${object} 0\tdirectory\0`),
    fakeGit(`100644 ${object} 0\tfile.js\0\0`),
    fakeGit(`100644 ${object} 0\tfile.js\0`.repeat(2)),
    fakeGit(Buffer.from([0xff, 0, 0])),
    () => ({ status: 0 }),
    () => ({ status: 0, stdout: Buffer.alloc(0), signal: 'SIGTERM' }),
    () => { throw executionError('git/test-process-failed', '模拟 Git 启动失败'); },
  ];
  for (const run of cases) assert.throws(() => collectRepositoryFilePaths({ root: process.cwd(), environment: 'pre-commit', run }),
    (error) => error.kind === 'execution');
});

test('文件名含空格、制表符及中文仍作为一个精确路径处理', () => {
  const file = 'docs/说明 [样例]\t记录.md';
  const run = fakeGit(`100644 ${'a'.repeat(40)} 0\t${file}\0`);
  assert.deepEqual(collectRepositoryFilePaths({ root: process.cwd(), environment: 'pre-commit', run }).paths, [file]);
});
